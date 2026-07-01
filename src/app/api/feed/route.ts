/**
 * 信息流 API — M15
 *
 * POST /api/feed
 * 两种模式：
 *   - mode='cross-course'（默认，M15 起替代笔记总结）：基于 workspace 全部 captures + 画像 + 笔记
 *   - mode='single'（单课复习态遗留）：基于某节课 transcript
 *
 * 请求体（cross-course）：
 *   mode, workspaceId, captures: [{id,title,normalizedText?,contentType?,occurredAt?}],
 *   learnerProfile?, notes?
 *
 * 请求体（single）：
 *   mode, sessionId, transcript, learnerProfile?, notes?, confusions?, sessionInfo?
 *
 * 响应：
 *   { success: true, items: FeedItem[] }
 */

import { NextRequest, NextResponse } from 'next/server';
import { feedService, type CrossCourseCapture } from '@/lib/services/feed-service';
import { applyRateLimit } from '@/lib/utils/rate-limit';
import { createLogger } from '@/lib/logger';

const log = createLogger('api/feed');

interface FeedRequest {
  mode?: 'cross-course' | 'single';
  // cross-course
  workspaceId?: string;
  captures?: CrossCourseCapture[];
  // single
  sessionId?: string;
  transcript?: Array<{
    id?: string;
    text: string;
    startMs: number;
    endMs: number;
  }>;
  // 共享
  learnerProfile?: {
    bio?: { headline: string; detail?: string };
    goals?: Array<{ title: string; summary?: string }>;
  };
  notes?: Array<{ text: string; source: string }>;
  confusions?: Array<{ text: string; timestampLabel?: string }>;
  sessionInfo?: {
    subject?: string;
    topic?: string;
  };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rateLimitResponse = await applyRateLimit(request, 'generateSummary');
  if (rateLimitResponse) return rateLimitResponse as NextResponse;

  try {
    const body: FeedRequest = await request.json();
    const mode = body.mode ?? 'cross-course';

    if (mode === 'cross-course') {
      if (!body.workspaceId) {
        return NextResponse.json(
          { success: false, error: '缺少 workspaceId' },
          { status: 400 },
        );
      }
      if (!body.captures || body.captures.length === 0) {
        return NextResponse.json(
          { success: false, error: '还没有收集内容' },
          { status: 400 },
        );
      }

      const result = await feedService.generateCrossCourseFeed(body.captures, {
        learnerProfile: body.learnerProfile,
        notes: body.notes,
      });

      return NextResponse.json({ success: true, items: result.items });
    }

    // single（单课遗留）
    if (!body.sessionId) {
      return NextResponse.json(
        { success: false, error: '缺少 sessionId' },
        { status: 400 },
      );
    }
    if (!body.transcript || body.transcript.length === 0) {
      return NextResponse.json(
        { success: false, error: '缺少转录内容' },
        { status: 400 },
      );
    }

    const segments = body.transcript.map((seg, index) => ({
      id: seg.id ? parseInt(seg.id) : index,
      sessionId: body.sessionId!,
      userId: 'anonymous',
      text: seg.text,
      startMs: seg.startMs,
      endMs: seg.endMs,
      confidence: 1.0,
      isFinal: true,
    }));

    const result = await feedService.generateFeed(body.sessionId, segments, {
      learnerProfile: body.learnerProfile,
      notes: body.notes,
      confusions: body.confusions,
      sessionInfo: body.sessionInfo,
    });

    return NextResponse.json({ success: true, items: result.items });
  } catch (error) {
    log.error('生成信息流失败:', error);
    const message = error instanceof Error ? error.message : '生成失败';
    log.warn('生成信息流失败详情:', message);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '生成失败',
      },
      { status: 500 },
    );
  }
}
