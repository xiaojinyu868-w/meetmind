/**
 * POST /api/share/[token]/claim — 把 SharedAgent 领取到访问者的 workspace（v3.0）
 *
 * 鉴权：必须登录。
 *
 * 流程：
 *   1. 找到 SharedAgent
 *   2. 找到访问者的默认 workspace（没有就先 ensureDefaultWorkspace）
 *   3. claimSharedAgent 写 ShareClaim + 创建 WorkspaceCapture（幂等）
 *   4. 返回 captureId
 *
 * 失败：
 *   - 401 未登录
 *   - 404 share 不存在 / 已撤销
 */

import { NextRequest, NextResponse } from 'next/server';
import { authService } from '@/lib/services/auth-service';
import workspaceService from '@/lib/services/workspace-service';
import { claimSharedAgent } from '@/lib/services/share-agent-service';
import { applyRateLimit } from '@/lib/utils/rate-limit';
import { createLogger } from '@/lib/logger';

const log = createLogger('api/share/[token]/claim');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getAuthPayload(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  return authService.verifyToken(token);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const rateLimit = await applyRateLimit(request, 'tutor');
  if (rateLimit) return rateLimit;

  const { token } = await params;
  const payload = getAuthPayload(request);
  if (!payload) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }

  try {
    let workspace = await workspaceService.getDefaultWorkspace(payload.sub);
    if (!workspace) {
      workspace = await workspaceService.ensureDefaultWorkspace(payload.sub);
    }
    if (!workspace) {
      return NextResponse.json({ error: '无法定位领取者的 workspace' }, { status: 500 });
    }

    const result = await claimSharedAgent({
      token,
      claimerUserId: payload.sub,
      claimerWorkspaceId: workspace.id,
    });

    return NextResponse.json({
      success: true,
      captureId: result.captureId,
      alreadyClaimed: result.alreadyClaimed,
      workspaceId: workspace.id,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'SHARE_NOT_FOUND') {
      return NextResponse.json({ error: '分享不存在或已撤销' }, { status: 404 });
    }
    log.error('claim failed', { token, claimerUserId: payload.sub, msg });
    return NextResponse.json({ error: '领取失败', detail: msg }, { status: 500 });
  }
}
