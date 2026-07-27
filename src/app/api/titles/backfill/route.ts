/**
 * POST /api/titles/backfill
 *
 * 存量回填：把当前用户零信息默认标题（录音 HH:MM / 屏幕截图…）的 capture
 * 静默重命名为「主题 · 课程 · M-D」。单次最多 10 条，前端每次进入应用
 * 静默调一次，几次会话内自然追平历史存量。
 */

import { NextRequest, NextResponse } from 'next/server';
import { authService } from '@/lib/services/auth-service';
import { backfillGenericLessonTitles } from '@/lib/services/lesson-title-service';
import { createLogger } from '@/lib/logger';

const log = createLogger('titles/backfill');

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
    const result = await backfillGenericLessonTitles({ userId: auth.sub, limit: 10 });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    log.error('backfill lesson titles failed:', error);
    return NextResponse.json({ success: false, error: '回填标题失败' }, { status: 500 });
  }
}
