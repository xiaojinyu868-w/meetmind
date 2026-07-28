/**
 * POST /api/classroom/understanding
 *
 * 课后理解（一次 LLM 调用，多个产物）：定稿后由客户端触发，
 * 输入带时间锚点的转录样本，输出标题（用户锁保护）+ 课堂摘要 + 精选片段，
 * 一次落齐。替代过去定稿后 3-4 次全文级重复调用（审计 2026-07-28）。
 */

import { NextRequest, NextResponse } from 'next/server';
import { authService } from '@/lib/services/auth-service';
import {
  applyLessonUnderstanding,
  generateLessonUnderstanding,
} from '@/lib/services/lesson-understanding-service';
import { createLogger } from '@/lib/logger';

const log = createLogger('classroom/understanding');

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
      sessionId?: string;
      transcriptSample?: string;
      courseTitle?: string;
      occurredAt?: string;
    } | null;
    if (!body?.captureId || !body.sessionId || typeof body.transcriptSample !== 'string') {
      return NextResponse.json(
        { success: false, error: '缺少 captureId / sessionId / 转录样本' },
        { status: 400 },
      );
    }

    const understanding = await generateLessonUnderstanding({
      transcriptSample: body.transcriptSample,
      courseTitle: body.courseTitle,
    });
    if (!understanding) {
      // 宁缺毋滥：本次理解不达标，什么都不写，客户端保留现状
      return NextResponse.json({ success: true, skipped: true });
    }

    const occurredAt = body.occurredAt ? new Date(body.occurredAt) : new Date();
    const applied = await applyLessonUnderstanding({
      userId: auth.sub,
      captureId: body.captureId,
      sessionId: body.sessionId,
      understanding,
      courseTitle: body.courseTitle,
      occurredAt: Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt,
    });

    return NextResponse.json({ success: true, skipped: false, ...applied });
  } catch (error) {
    log.error('lesson understanding failed:', error);
    return NextResponse.json({ success: false, error: '课后理解失败' }, { status: 500 });
  }
}
