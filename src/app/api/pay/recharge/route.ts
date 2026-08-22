/**
 * POST /api/pay/recharge —— 创建积分充值订单（微信 Native 扫码）
 *
 * 契约（前端按此开发，不得偏离）：
 *   请求：{ packKey: 'starter' | 'standard' | 'scholar' | 'pro-monthly' | 'max-monthly' }
 *   200：{ outTradeNo, codeUrl, amountFen, points, membership? }  —— codeUrl 渲染二维码，outTradeNo 轮询用；
 *         会员档订单 points=0 且带 membership: { tier, days }
 *   400：{ error: 'invalid_pack' }                    —— packKey 非法
 *   401：{ error: 'unauthorized' }                    —— 未登录
 *   503：{ error: 'pay_unavailable' }                 —— 微信支付未配置 / 下单失败
 *
 * 需登录（Bearer）；限流走 wechatQr 同档（下单会消耗微信接口配额）。
 */

import { NextRequest, NextResponse } from 'next/server';
import { applyRateLimit, getUserIdFromRequest } from '@/lib/utils/rate-limit';
import {
  createRechargeOrder,
  InvalidRechargePackError,
  PayUnavailableError,
} from '@/lib/services/recharge-order-service';
import { createLogger } from '@/lib/logger';

const log = createLogger('pay/recharge');

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const rateLimitResponse = await applyRateLimit(request, 'wechatQr');
  if (rateLimitResponse) return rateLimitResponse;

  const userId = getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let packKey: string;
  try {
    const body = (await request.json()) as { packKey?: unknown };
    packKey = typeof body.packKey === 'string' ? body.packKey.trim() : '';
  } catch {
    return NextResponse.json({ error: 'invalid_pack' }, { status: 400 });
  }
  if (!packKey) {
    return NextResponse.json({ error: 'invalid_pack' }, { status: 400 });
  }

  try {
    const result = await createRechargeOrder(userId, packKey);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof InvalidRechargePackError) {
      return NextResponse.json({ error: 'invalid_pack' }, { status: 400 });
    }
    if (error instanceof PayUnavailableError) {
      log.warn('pay unavailable', { userId, packKey, reason: error.message });
      return NextResponse.json({ error: 'pay_unavailable' }, { status: 503 });
    }
    log.error('recharge create failed', {
      userId,
      packKey,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'internal server error' }, { status: 500 });
  }
}
