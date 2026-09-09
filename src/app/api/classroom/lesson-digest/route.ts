import { NextRequest, NextResponse } from 'next/server';
import { generateLessonDigest, type DigestImageRef } from '@/lib/services/lesson-digest-service';
import { createLogger } from '@/lib/logger';
import type { TranscriptSegment } from '@/types';

const log = createLogger('api/classroom/lesson-digest');

/**
 * POST /api/classroom/lesson-digest
 *
 * 生成一节课的结构化分段总结（飞书妙记形态）。
 *
 * 入参：
 *   segments: TranscriptSegment[] — 转录分段（有 startMs/endMs/text）
 *   images: DigestImageRef[] — 课中拍的照片（有 capturedAtMs 锚点）
 *   lessonTitle?: string — 课程标题
 *
 * 出参：
 *   { digest: LessonDigest }
 *   digest = { title, overview, sections: [{ heading, text, imageId?, startMs, endMs }], extras }
 */
interface RequestBody {
  segments?: TranscriptSegment[];
  images?: DigestImageRef[];
  lessonTitle?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RequestBody;
    const { segments = [], images = [], lessonTitle } = body;

    if (!Array.isArray(segments) || segments.length === 0) {
      return NextResponse.json(
        { error: 'segments is required and must be non-empty' },
        { status: 400 },
      );
    }

    const validSegments = segments.filter(
      (s) => s && typeof s.text === 'string' && typeof s.startMs === 'number',
    );

    if (validSegments.length === 0) {
      return NextResponse.json(
        { error: 'no valid segments found' },
        { status: 400 },
      );
    }

    const validImages: DigestImageRef[] = Array.isArray(images)
      ? images.filter((img) => img && typeof img.imageId === 'string')
      : [];

    const digest = await generateLessonDigest(validSegments, validImages, lessonTitle);

    return NextResponse.json({ digest });
  } catch (error) {
    if (error instanceof Error && error.message === 'GENERATION_FAILED') {
      // 模型两次都没整理出可用分段：诚实失败，客户端给失败态 + 再试一次，不落缓存
      log.warn('[lesson-digest] generation failed after retry');
      return NextResponse.json({ error: 'GENERATION_FAILED' }, { status: 502 });
    }
    log.error('[lesson-digest] Request error:', error);
    return NextResponse.json(
      { error: 'Failed to generate lesson digest' },
      { status: 500 },
    );
  }
}
