/**
 * 学习记忆事件 API（P0 事件化）
 * POST /api/memory/events — 登录用户追加学习事件；落库后 fire-and-forget
 * 触发服务端蒸馏合并（learning-event-service），立即返回 { ok, eventId }。
 * 访客一期不进服务端记忆：未登录 401，客户端维持本地 IndexedDB 流程。
 */

import { NextRequest, NextResponse } from 'next/server';
import { authService } from '@/lib/services/auth-service';
import {
  appendLearningEvent,
  triggerLearningEventProcessing,
} from '@/lib/services/learning-event-service';
import { applyRateLimit } from '@/lib/utils/rate-limit';
import { createLogger } from '@/lib/logger';
import type { LearningEventInput } from '@/types/learning-event';

const log = createLogger('memory/events');

function getAuthPayload(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  return authService.verifyToken(authHeader.slice(7));
}

export async function POST(request: NextRequest) {
  const rateLimit = await applyRateLimit(request, 'tutor');
  if (rateLimit) return rateLimit;

  try {
    const payload = getAuthPayload(request);
    if (!payload) {
      return NextResponse.json({ ok: false, error: '未授权' }, { status: 401 });
    }

    const body = await request.json() as LearningEventInput;
    const event = await appendLearningEvent(payload.sub, body);
    if (!event) {
      return NextResponse.json({ ok: false, error: '事件内容不完整' }, { status: 400 });
    }

    // 蒸馏合并收归服务端：异步处理，失败只记日志，事件仍在表内可回放
    void triggerLearningEventProcessing(event);

    return NextResponse.json({ ok: true, eventId: event.id });
  } catch (error) {
    log.error('append learning event failed', error);
    return NextResponse.json({ ok: false, error: '这次没有形成新的理解' }, { status: 500 });
  }
}
