import { NextRequest, NextResponse } from 'next/server';
import { authService } from '@/lib/services/auth-service';
import workspaceAccountService from '@/lib/services/workspace-account-service';
import type { LocalWorkspaceMigrationPayload } from '@/lib/services/workspace-context-types';
import { createLogger } from '@/lib/logger';
const log = createLogger('workspace/local-migration');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getAuthPayload(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }

  return authService.verifyToken(authHeader.slice(7));
}

function unauthorizedResponse() {
  return NextResponse.json({ success: false, error: '未授权' }, { status: 401 });
}

export async function POST(request: NextRequest) {
  try {
    const payload = getAuthPayload(request);
    if (!payload) {
      return unauthorizedResponse();
    }

    const body = (await request.json()) as Partial<LocalWorkspaceMigrationPayload>;
    const sessions = Array.isArray(body.sessions) ? body.sessions : [];

    const result = await workspaceAccountService.migrateLocalWorkspaceData(payload.sub, {
      sessions,
    });

    return NextResponse.json({
      success: true,
      workspace: result.workspace,
      summary: result.summary,
    });
  } catch (error) {
    log.error('workspace local migration error:', error);
    return NextResponse.json({ success: false, error: '同步本地学习历史失败' }, { status: 500 });
  }
}
