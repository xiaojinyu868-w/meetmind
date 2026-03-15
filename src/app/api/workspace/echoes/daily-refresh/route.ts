import { NextRequest, NextResponse } from 'next/server';
import { authService } from '@/lib/services/auth-service';
import workspaceEchoService from '@/lib/services/workspace-echo-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getAuthPayload(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice(7);
  return authService.verifyToken(token);
}

function canUseManualTrigger(): boolean {
  return process.env.NODE_ENV !== 'production' || String(process.env.ENABLE_ECHO_MANUAL_TRIGGER || '').toLowerCase() === 'true';
}

export async function POST(request: NextRequest) {
  try {
    const payload = getAuthPayload(request);
    if (!payload) {
      return NextResponse.json({ success: false, error: '未授权' }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      force?: boolean;
    };
    const force = Boolean(body.force);

    if (force && !canUseManualTrigger()) {
      return NextResponse.json(
        { success: false, error: '当前环境未开启手动触发回声' },
        { status: 403 }
      );
    }

    const result = await workspaceEchoService.refreshDailyEchoForUser(payload.sub, {
      force,
      includeDebug: force,
      trigger: force ? 'manual' : 'capture',
    });

    if (!result.success && result.reason === 'config-missing' && force) {
      return NextResponse.json(
        { success: false, error: 'CommonStack Echo 未配置完成' },
        { status: 503 }
      );
    }

    return NextResponse.json({
      success: result.success,
      skipped: Boolean(result.skipped),
      forced: Boolean(result.forced),
      reason: result.reason,
      echo: result.echo,
      debug: result.debug,
    });
  } catch (error) {
    console.error('workspace daily echo refresh error:', error);
    return NextResponse.json(
      { success: false, error: '刷新今日回声失败' },
      { status: 500 }
    );
  }
}
