/**
 * POST /api/titles/lesson
 *
 * 为一节课生成并重命名标题（`主题 · 课程 · M-D` 契约）。
 * 用户锁保护：capture metadata.titleSource === 'user' 时跳过。
 * 宁缺毋滥：生成失败/不达标时 skipped=true，调用方保留旧标题。
 */

import { NextRequest, NextResponse } from 'next/server';
import { authService } from '@/lib/services/auth-service';
import {
  composeLessonTitle,
  generateLessonTopic,
  retitleCaptureIfUnlocked,
} from '@/lib/services/lesson-title-service';
import { createLogger } from '@/lib/logger';

const log = createLogger('titles/lesson');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getAuthPayload(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  return authService.verifyToken(authHeader.slice(7));
}

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (!auth) {
      return NextResponse.json({ success: false, error: '未授权' }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as {
      captureId?: string;
      transcriptSample?: string;
      courseTitle?: string;
      occurredAt?: string;
    } | null;
    if (!body || typeof body.transcriptSample !== 'string') {
      return NextResponse.json({ success: false, error: '缺少转录样本' }, { status: 400 });
    }

    const topic = await generateLessonTopic({
      transcriptSample: body.transcriptSample,
      courseTitle: body.courseTitle,
    });
    if (!topic) {
      return NextResponse.json({ success: true, skipped: true });
    }

    const occurredAt = body.occurredAt ? new Date(body.occurredAt) : new Date();
    const title = composeLessonTitle({
      topic,
      courseTitle: body.courseTitle,
      date: Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt,
    });

    let retitled: 'retitled' | 'locked' | 'not_found' | undefined;
    if (body.captureId) {
      retitled = await retitleCaptureIfUnlocked({
        userId: auth.sub,
        captureId: body.captureId,
        newTitle: title,
      });
    }

    return NextResponse.json({ success: true, skipped: false, title, topic, retitled });
  } catch (error) {
    log.error('retitle lesson failed:', error);
    return NextResponse.json({ success: false, error: '生成标题失败' }, { status: 500 });
  }
}
