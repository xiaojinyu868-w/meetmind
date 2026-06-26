/**
 * 信息流 API — M15
 *
 * POST /api/feed
 * 基于个人上下文（转录 + 画像 + 笔记 + 困惑）生成信息流，替代笔记总结。
 *
 * 请求体：
 *   sessionId, transcript, learnerProfile?, notes?, confusions?, sessionInfo?
 *
 * 响应：
 *   { success: true, items: FeedItem[] }
 */

import { NextRequest, NextResponse } from 'next/server';
import { feedService } from '@/lib/services/feed-service';
import { applyRateLimit } from '@/lib/utils/rate-limit';
import { createLogger } from '@/lib/logger';

const log = createLogger('api/feed');

interface FeedRequest {
  sessionId: string;
  transcript: Array<{
    id?: string;
    text: string;
    startMs: number;
    endMs: number;
  }>;
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

    // 转换转录格式（复用 summary route 的模式）
    const segments = body.transcript.map((seg, index) => ({
      id: seg.id ? parseInt(seg.id) : index,
      sessionId: body.sessionId,
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

    return NextResponse.json({
      success: true,
      items: result.items,
    });
  } catch (error) {
    log.error('生成信息流失败:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '生成失败',
      },
      { status: 500 },
    );
  }
}
