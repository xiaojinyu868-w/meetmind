/**
 * POST /api/points/precheck-asr —— ASR 录课前服务端额度预检（内部接口）
 *
 * 调用方：server.js 的 /api/asr-stream WS 代理 —— 客户端连接建立、
 * 上游 DashScope 尚未拨号前调用；拒绝则直接给客户端发错误帧并关连接。
 * 鉴权：`x-internal-secret`（与 settle-asr 同款）；env 未配置时 503，
 * server.js 侧 fail-open（不阻塞 ASR），与结算路径行为一致。
 *
 * 请求体：{ token?: string, guestKey?: string }
 * - token 有效（登录用户）：当月 600 分钟免费额度 > 0 → allowed；
 *   免费用尽 → 余额够 1 分钟价也 allowed（付费继续）；都不够 → allowed:false
 * - 匿名：按 guestKey（guest_<ip>）当日影子分钟 < 日上限 → allowed
 */

import { NextRequest, NextResponse } from 'next/server';
import authService from '@/lib/services/auth-service';
import {
  getAsrFreeMinutesRemaining,
  getGuestDailyAsrMinutes,
  getOrCreateWithGrants,
} from '@/lib/services/point-account-service';
import { POINTS_CONFIG } from '@/lib/config/pricing';
import { createLogger } from '@/lib/logger';

const log = createLogger('points/precheck-asr');

export const dynamic = 'force-dynamic';

interface PrecheckBody {
  token?: unknown;
  guestKey?: unknown;
}

export async function POST(request: NextRequest) {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'precheck_disabled' }, { status: 503 });
  }
  if (request.headers.get('x-internal-secret') !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: PrecheckBody;
  try {
    body = (await request.json()) as PrecheckBody;
  } catch {
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }

  const token = typeof body.token === 'string' ? body.token.trim() : '';
  const payload = token ? authService.verifyToken(token) : null;

  try {
    if (payload?.sub) {
      // 登录用户：先吃当月免费分钟；用尽后余额够 1 分钟价即可继续（付费）
      const [freeRemaining, account] = await Promise.all([
        getAsrFreeMinutesRemaining(payload.sub),
        getOrCreateWithGrants(payload.sub),
      ]);
      if (freeRemaining > 0) {
        return NextResponse.json({ allowed: true, tier: 'free', freeMinutesRemaining: freeRemaining });
      }
      if (account.balance >= POINTS_CONFIG.asrPricePerMinute) {
        return NextResponse.json({ allowed: true, tier: 'paid', freeMinutesRemaining: 0 });
      }
      return NextResponse.json({
        allowed: false,
        reason: 'asr_quota_exhausted',
        balance: account.balance,
        pricePerMinute: POINTS_CONFIG.asrPricePerMinute,
      });
    }

    const guestKey = typeof body.guestKey === 'string' && body.guestKey.trim()
      ? body.guestKey.trim()
      : 'anonymous';
    const usedMinutes = await getGuestDailyAsrMinutes(guestKey);
    if (usedMinutes >= POINTS_CONFIG.guestDailyAsrMinutes) {
      return NextResponse.json({
        allowed: false,
        reason: 'guest_daily_asr_cap',
        usedMinutes,
        dailyCap: POINTS_CONFIG.guestDailyAsrMinutes,
      });
    }
    return NextResponse.json({
      allowed: true,
      tier: 'guest',
      usedMinutes,
      dailyCap: POINTS_CONFIG.guestDailyAsrMinutes,
    });
  } catch (error) {
    log.error('precheck-asr failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'internal server error' }, { status: 500 });
  }
}
