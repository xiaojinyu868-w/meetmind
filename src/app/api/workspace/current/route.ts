import { NextRequest, NextResponse } from 'next/server';
import { authService } from '@/lib/services/auth-service';
import workspaceContextService from '@/lib/services/workspace-context-service';

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

export async function GET(request: NextRequest) {
  try {
    const payload = getAuthPayload(request);

    if (!payload) {
      return NextResponse.json(
        { success: false, error: '未授权' },
        { status: 401 }
      );
    }

    const context = await workspaceContextService.getCurrentWorkspaceContext(payload.sub);

    return NextResponse.json({
      success: true,
      ...context,
    });
  } catch (error) {
    console.error('workspace current context error:', error);
    return NextResponse.json(
      { success: false, error: '读取当前工作区失败' },
      { status: 500 }
    );
  }
}
