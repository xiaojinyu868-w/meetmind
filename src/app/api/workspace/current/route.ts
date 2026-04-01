import { NextRequest, NextResponse } from 'next/server';
import { authService } from '@/lib/services/auth-service';
import workspaceAccountService from '@/lib/services/workspace-account-service';
import workspaceContextService from '@/lib/services/workspace-context-service';
import { createLogger } from '@/lib/logger';
const log = createLogger('workspace/current');


export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getAuthPayload(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }

  return authService.verifyToken(authHeader.slice(7));
}

export async function GET(request: NextRequest) {
  try {
    const payload = getAuthPayload(request);

    if (!payload) {
      return NextResponse.json({ success: false, error: '未授权' }, { status: 401 });
    }

    const includeArchived = ['1', 'true', 'yes'].includes(
      (request.nextUrl.searchParams.get('includeArchived') || '').toLowerCase()
    );

    await workspaceAccountService.ensureAccountDataOwnership(payload.sub);

    const context = await workspaceContextService.getCurrentWorkspaceContext(payload.sub, {
      includeArchived,
    });

    return NextResponse.json({
      success: true,
      ...context,
    });
  } catch (error) {
    log.error('workspace current context error:', error);
    return NextResponse.json({ success: false, error: '读取当前工作区失败' }, { status: 500 });
  }
}
