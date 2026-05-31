/**
 * GET /api/share/me — 列出当前用户创建的所有 SharedAgent（v3.0 管理面）
 *
 * 鉴权：必须登录。返回最近 50 条，含撤销状态 + 计数器。
 */

import { NextRequest, NextResponse } from 'next/server';
import { authService } from '@/lib/services/auth-service';
import { listSharedAgentsByOwner } from '@/lib/services/share-agent-service';
import { applyRateLimit } from '@/lib/utils/rate-limit';
import { createLogger } from '@/lib/logger';

const log = createLogger('api/share/me');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getAuthPayload(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  return authService.verifyToken(token);
}

export async function GET(request: NextRequest) {
  const rateLimit = await applyRateLimit(request, 'tutor');
  if (rateLimit) return rateLimit;

  const payload = getAuthPayload(request);
  if (!payload) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }

  try {
    const shares = await listSharedAgentsByOwner(payload.sub);
    return NextResponse.json({ success: true, shares });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('list failed', { ownerId: payload.sub, msg });
    return NextResponse.json({ error: '加载失败', detail: msg }, { status: 500 });
  }
}
