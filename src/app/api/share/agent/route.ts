/**
 * POST /api/share/agent — 创建一个 SharedAgent（v3.0）
 *
 * 请求体：
 *   {
 *     snapshot: SharedAgentSnapshot,         // 见 share-agent-service.ts
 *     sourceSessionId?: string,              // 来源 IndexedDB session id
 *     conversationEnabled?: boolean,         // 默认 true
 *     visibility?: 'public' | 'unlisted'     // 默认 public
 *   }
 *
 * 响应：
 *   { token, shareUrl, conversationEnabled }
 *
 * 鉴权：必须登录（Authorization: Bearer <token>）。匿名分享暂不开放，
 * 因为没有 ownerId 后续 revoke / 数据归属都会很乱。
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authService } from '@/lib/services/auth-service';
import workspaceService from '@/lib/services/workspace-service';
import {
  createSharedAgent,
  SharedAgentSnapshotSchema,
} from '@/lib/services/share-agent-service';
import { resolvePublicBaseUrl } from '@/lib/services/media-tooling';
import { applyRateLimit } from '@/lib/utils/rate-limit';
import { createLogger, track } from '@/lib/logger';

const log = createLogger('api/share/agent');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  snapshot: SharedAgentSnapshotSchema,
  sourceSessionId: z.string().max(120).optional(),
  conversationEnabled: z.boolean().optional(),
  visibility: z.enum(['public', 'unlisted']).optional(),
});

function getAuthPayload(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  return authService.verifyToken(token);
}

function buildShareUrl(token: string, request: NextRequest): string {
  const resolved = resolvePublicBaseUrl();
  if (resolved.ok) {
    return `${resolved.baseUrl}/share/${token}`;
  }
  // dev / 本地兜底：从请求 host 推断
  const host = request.headers.get('host') ?? 'localhost:3001';
  const proto = request.headers.get('x-forwarded-proto') ?? 'http';
  return `${proto}://${host}/share/${token}`;
}

export async function POST(request: NextRequest) {
  const rateLimit = await applyRateLimit(request, 'tutor');
  if (rateLimit) return rateLimit;

  const payload = getAuthPayload(request);
  if (!payload) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }

  let parsed: z.infer<typeof BodySchema>;
  try {
    const raw = (await request.json()) as unknown;
    parsed = BodySchema.parse(raw);
  } catch (err) {
    track({ kind: 'share.fail', errorCode: 'SHARE_BAD_REQUEST', errorMsg: (err as Error).message });
    return NextResponse.json({ error: '请求格式错误', detail: (err as Error).message }, { status: 400 });
  }

  try {
    const workspace = await workspaceService.getDefaultWorkspace(payload.sub);

    const result = await createSharedAgent({
      ownerId: payload.sub,
      workspaceId: workspace?.id ?? null,
      sourceSessionId: parsed.sourceSessionId,
      snapshot: parsed.snapshot,
      conversationEnabled: parsed.conversationEnabled,
      visibility: parsed.visibility,
    });

    const shareUrl = buildShareUrl(result.token, request);

    return NextResponse.json({
      success: true,
      token: result.token,
      shareUrl,
      conversationEnabled: parsed.conversationEnabled ?? true,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('create failed', { msg, ownerId: payload.sub });
    track({ kind: 'share.fail', errorCode: 'SHARE_CREATE_FAIL', errorMsg: msg });
    return NextResponse.json({ error: '创建分享失败', detail: msg }, { status: 500 });
  }
}
