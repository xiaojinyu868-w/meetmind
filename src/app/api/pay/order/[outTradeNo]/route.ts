/**
 * GET /api/pay/order/[outTradeNo] —— 充值订单状态轮询
 *
 * 契约（前端按此开发，不得偏离）：
 *   200：{ status, points, amountFen, packKey }  —— status: pending|paid|expired|failed
 *   401：{ error: 'unauthorized' }                —— 未登录
 *   404：{ error: 'not_found' }                   —— 订单不存在或不属于当前用户
 *
 * 需登录（Bearer）且只能查自己的订单；超期 pending 由服务层惰性置 expired。
 * 轮询频率高，限流走 wechatQrPoll 同档。
 * 回调冗余：pending 时先主动向微信查单兑账（syncOrderFromWeChat，best-effort），
 * 回调丢失/延迟时用户付款也能即时到账——这是"充完马上有反馈"的第二通道。
 */

import { NextRequest, NextResponse } from 'next/server';
import { applyRateLimit, getUserIdFromRequest } from '@/lib/utils/rate-limit';
import {
  getOrderForUser,
  notifyRechargePaidBestEffort,
  syncOrderFromWeChat,
  type MarkOrderPaidResult,
} from '@/lib/services/recharge-order-service';
import { createLogger } from '@/lib/logger';

const log = createLogger('pay/order');

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ outTradeNo: string }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const rateLimitResponse = await applyRateLimit(request, 'wechatQrPoll');
  if (rateLimitResponse) return rateLimitResponse;

  const userId = getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { outTradeNo } = await context.params;
  if (!outTradeNo) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  try {
    let order = await getOrderForUser(outTradeNo, userId);
    if (!order) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    // pending/expired 时主动向微信查单兑账（回调可能丢失/延迟；expired 是本地状态，
    // 微信确认已付的必须能兑回来）；查单失败静默降级为本地状态
    if (order.status === 'pending' || order.status === 'expired') {
      try {
        const synced = await syncOrderFromWeChat(outTradeNo);
        if (synced && !synced.duplicate) {
          log.info('order synced from wechat query', { outTradeNo, userId });
          void notifyAfterSync(synced);
        }
        if (synced) order = await getOrderForUser(outTradeNo, userId) ?? order;
      } catch (syncError) {
        log.warn('wechat order sync failed, fall back to local status', {
          outTradeNo,
          error: syncError instanceof Error ? syncError.message : String(syncError),
        });
      }
    }
    return NextResponse.json(order);
  } catch (error) {
    log.error('order query failed', {
      userId,
      outTradeNo,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'internal server error' }, { status: 500 });
  }
}

/** 查单兑账成功后的客服消息通知（与回调路径同款，best-effort 不阻塞响应） */
async function notifyAfterSync(result: MarkOrderPaidResult): Promise<void> {
  try {
    await notifyRechargePaidBestEffort(result);
  } catch {
    // notifyRechargePaidBestEffort 内部已静默，这里兜底
  }
}
