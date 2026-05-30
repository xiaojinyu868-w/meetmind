/**
 * POST /api/share/[token]/track — 记录 SharedAgent 的访问 / 对话 / 转发事件（v3.0）
 *
 * 公开接口（不需鉴权，但已登录会带 userId）。
 *
 * 请求体：
 *   { eventType: 'view' | 'chat' | 'reshare', metadata?: object }
 *
 * 'claim' 事件由 /api/share/[token]/claim 内部触发，不接受外部直接传。
 * 'view' 事件 GET 路由会自动触发，这里也允许显式调用（比如停留时长写回）。
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authService } from '@/lib/services/auth-service';
import { trackShareInteraction } from '@/lib/services/share-agent-service';
import { applyRateLimit } from '@/lib/utils/rate-limit';
import { createLogger } from '@/lib/logger';

const log = createLogger('api/share/[token]/track');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  eventType: z.enum(['view', 'chat', 'reshare']),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

function getOptionalAuthUserId(request: NextRequest): string | null {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  const payload = authService.verifyToken(token);
  return payload?.sub ?? null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const rateLimit = await applyRateLimit(request, 'tutor');
  if (rateLimit) return rateLimit;

  const { token } = await params;
  if (!token || token.length > 32) {
    return NextResponse.json({ error: 'token 不合法' }, { status: 400 });
  }

  let parsed: z.infer<typeof BodySchema>;
  try {
    const raw = (await request.json()) as unknown;
    parsed = BodySchema.parse(raw);
  } catch (err) {
    return NextResponse.json({ error: '请求格式错误', detail: (err as Error).message }, { status: 400 });
  }

  try {
    const visitorUserId = getOptionalAuthUserId(request);
    await trackShareInteraction({
      token,
      visitorUserId,
      eventType: parsed.eventType,
      metadata: parsed.metadata,
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn('track failed', { token, msg });
    // 埋点失败不应该阻塞用户操作，仍然返回 200
    return NextResponse.json({ success: false, detail: msg }, { status: 200 });
  }
}
