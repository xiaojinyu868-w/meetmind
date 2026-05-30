/**
 * GET /api/share/[token] — 公开读取一个 SharedAgent 的 snapshot（v3.0）
 *
 * 不需要鉴权。任何人凭 token 都可以读，但只返回 PublicSharedAgent 形状
 * （隐藏 ownerId / workspaceId / interactions / 原作者画像）。
 *
 * 触发副作用：自增 viewCount + 写一条 ShareInteraction（若访问者已登录则带上 userId）。
 *
 * 已撤销 / 过期 / 不存在的 share 一律返回 404，不区分原因，避免泄露存在性。
 */

import { NextRequest, NextResponse } from 'next/server';
import { authService } from '@/lib/services/auth-service';
import {
  getSharedAgentByToken,
  trackShareInteraction,
} from '@/lib/services/share-agent-service';
import { createLogger } from '@/lib/logger';

const log = createLogger('api/share/[token]');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getOptionalAuthUserId(request: NextRequest): string | null {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  const payload = authService.verifyToken(token);
  return payload?.sub ?? null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!token || token.length > 32) {
    return NextResponse.json({ error: 'token 不合法' }, { status: 400 });
  }

  try {
    const share = await getSharedAgentByToken(token);
    if (!share) {
      return NextResponse.json({ error: '分享不存在或已撤销' }, { status: 404 });
    }

    // 异步写埋点 + 计数器，不阻塞响应
    const visitorUserId = getOptionalAuthUserId(request);
    void trackShareInteraction({
      token,
      visitorUserId,
      eventType: 'view',
    }).catch((err) => log.warn('view track failed', { token, err: (err as Error).message }));

    return NextResponse.json({ success: true, share });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('read failed', { token, msg });
    return NextResponse.json({ error: '读取分享失败', detail: msg }, { status: 500 });
  }
}
