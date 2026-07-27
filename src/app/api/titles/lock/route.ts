/**
 * POST /api/titles/lock
 *
 * 用户手动改名时调用：写入新标题并加锁（metadata.titleSource='user'），
 * 自动标题系统从此不再碰这条 capture——用户编辑权高于一切自动行为。
 */

import { NextRequest, NextResponse } from 'next/server';
import { authService } from '@/lib/services/auth-service';
import { lockCaptureTitleByUser } from '@/lib/services/lesson-title-service';
import { createLogger } from '@/lib/logger';

const log = createLogger('titles/lock');

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
      sessionId?: string;
      title?: string;
    } | null;
    const title = body?.title?.trim();
    if (!body?.sessionId || !title) {
      return NextResponse.json({ success: false, error: '缺少 sessionId 或标题' }, { status: 400 });
    }

    const locked = await lockCaptureTitleByUser({
      userId: auth.sub,
      sessionId: body.sessionId,
      title: title.slice(0, 80),
    });
    return NextResponse.json({ success: true, locked });
  } catch (error) {
    log.error('lock capture title failed:', error);
    return NextResponse.json({ success: false, error: '锁定标题失败' }, { status: 500 });
  }
}
