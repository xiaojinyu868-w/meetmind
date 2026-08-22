/**
 * POST /api/points/settle-asr —— ASR 录课分钟结算（内部接口，Phase 2：真扣费）
 *
 * 调用方：server.js 的 /api/asr-stream WS 代理 —— 连接关闭时按连接时长打到这里。
 * 鉴权：`x-internal-secret` 头必须等于 env INTERNAL_API_SECRET；
 * env 未配置时本路由直接 503（server.js 侧同样跳过，不阻塞 ASR）。
 * 该路径在 public-routes 白名单里（无 Bearer），所以 secret 是唯一防线。
 *
 * 请求体：{ connectionId: string, durationMs?: number, minutes?: number, token?: string }
 * - 分钟数向上取整（durationMs 优先，minutes 兜底）
 * - token 为客户端 WS URL 携带的 JWT：有效 → 按用户结算（先吃当月 600 分钟免费额度，
 *   超出 2 积分/分钟）；无效/缺失 → 匿名影子流水（只记量纲不扣分，保持 guest 现状）
 * - 幂等键 asr:{userId}:{connectionId}，重复结算安全
 */

import { NextRequest, NextResponse } from 'next/server';
import authService from '@/lib/services/auth-service';
import { recordAnonymousAsrMinutes, settleAsrMinutes } from '@/lib/services/point-account-service';
import { createLogger } from '@/lib/logger';

const log = createLogger('points/settle-asr');

export const dynamic = 'force-dynamic';

interface SettleBody {
  connectionId?: unknown;
  durationMs?: unknown;
  minutes?: unknown;
  token?: unknown;
  /** 匿名连接的 guest 归属（guest_<ip>），用于 per-guest 日限额统计 */
  guestKey?: unknown;
}

export async function POST(request: NextRequest) {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'settle_disabled' }, { status: 503 });
  }
  if (request.headers.get('x-internal-secret') !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: SettleBody;
  try {
    body = (await request.json()) as SettleBody;
  } catch {
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }

  const connectionId = typeof body.connectionId === 'string' ? body.connectionId.trim() : '';
  if (!connectionId) {
    return NextResponse.json({ error: 'missing connectionId' }, { status: 400 });
  }

  const rawMinutes =
    typeof body.durationMs === 'number' && Number.isFinite(body.durationMs)
      ? body.durationMs / 60_000
      : typeof body.minutes === 'number' && Number.isFinite(body.minutes)
        ? body.minutes
        : 0;
  const minutes = Math.max(0, Math.ceil(rawMinutes));
  if (minutes <= 0) {
    return NextResponse.json({ settled: false, minutes: 0 });
  }

  const token = typeof body.token === 'string' ? body.token.trim() : '';
  const payload = token ? authService.verifyToken(token) : null;

  try {
    if (!payload?.sub) {
      // 匿名连接：只记影子流水（quantity 量纲），不扣分、不吃免费额度；
      // 带 guestKey 时按 guest_<ip> 归属，支撑 per-guest 日限额（L1 堵漏）
      const guestKey = typeof body.guestKey === 'string' && body.guestKey.trim() ? body.guestKey.trim() : undefined;
      const recorded = await recordAnonymousAsrMinutes(connectionId, minutes, 'asr', guestKey);
      return NextResponse.json({ settled: true, anonymous: true, recorded, minutes });
    }

    const result = await settleAsrMinutes(payload.sub, connectionId, minutes);
    return NextResponse.json(result);
  } catch (error) {
    log.error('settle-asr failed', {
      connectionId,
      minutes,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'internal server error' }, { status: 500 });
  }
}
