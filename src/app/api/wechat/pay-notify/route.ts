/**
 * POST /api/wechat/pay-notify —— 微信支付结果回调（积分充值到账）
 *
 * 链路：raw body → APIv3 验签（平台证书）→ AES-256-GCM 解密 resource
 *   → 校验 out_trade_no / mchid / amount.total 与本地订单快照一致
 *   → markOrderPaidAndGrant（单事务到账，幂等）→ best-effort 客服消息通知
 *
 * 契约（微信支付平台约定）：
 *   成功：HTTP 200 { code: 'SUCCESS', message: '成功' }
 *   失败：HTTP 4xx/5xx（微信会按策略重推，幂等键保证重复回调不重复到账）
 *   验签失败：401
 *
 * 该路径在 public-routes 白名单里（微信服务器回调无 Bearer），验签是唯一防线。
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  decryptNotifyResource,
  verifyNotifySignature,
} from '@/lib/services/wechat-pay-service';
import {
  AmountMismatchError,
  markOrderPaidAndGrant,
  notifyRechargePaidBestEffort,
  OrderNotFoundError,
  OrderNotPayableError,
} from '@/lib/services/recharge-order-service';
import { createLogger } from '@/lib/logger';

const log = createLogger('wechat/pay-notify');

export const dynamic = 'force-dynamic';

/** 回调外层信封（加密资源在 resource 里，验签针对整个 rawBody） */
interface NotifyEnvelope {
  id?: string;
  event_type?: string;
  resource_type?: string;
  summary?: string;
  resource?: { ciphertext: string; nonce: string; associated_data?: string };
}

/** 解密后的交易对象（只取本链路关心的字段） */
interface NotifyTransaction {
  out_trade_no?: string;
  transaction_id?: string;
  mchid?: string;
  trade_state?: string;
  success_time?: string;
  amount?: { total?: number };
}

function fail(status: number, message: string) {
  return NextResponse.json({ code: 'FAIL', message }, { status });
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  if (!verifyNotifySignature(request.headers, rawBody)) {
    log.warn('pay-notify signature rejected');
    return fail(401, 'SIGN_ERROR');
  }

  let envelope: NotifyEnvelope;
  try {
    envelope = JSON.parse(rawBody) as NotifyEnvelope;
  } catch {
    return fail(400, 'BAD_REQUEST');
  }
  if (!envelope.resource?.ciphertext || !envelope.resource.nonce) {
    return fail(400, 'BAD_REQUEST');
  }

  let transaction: NotifyTransaction;
  try {
    transaction = decryptNotifyResource(envelope.resource) as NotifyTransaction;
  } catch (error) {
    log.error('pay-notify decrypt failed', {
      eventId: envelope.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return fail(400, 'DECRYPT_ERROR');
  }

  // 只处理支付成功事件；其他 trade_state 直接确认，不再重推
  if (transaction.trade_state !== 'SUCCESS') {
    log.info('pay-notify non-success trade state, acked', {
      eventId: envelope.id,
      tradeState: transaction.trade_state,
      outTradeNo: transaction.out_trade_no,
    });
    return NextResponse.json({ code: 'SUCCESS', message: '成功' });
  }

  const outTradeNo = typeof transaction.out_trade_no === 'string' ? transaction.out_trade_no : '';
  const wxTransactionId = typeof transaction.transaction_id === 'string' ? transaction.transaction_id : '';
  const amountFen = transaction.amount?.total;
  if (!outTradeNo || !wxTransactionId || typeof amountFen !== 'number') {
    return fail(400, 'BAD_REQUEST');
  }

  // 商户号必须是自己（验签已过，但仍按字段比对，防平台侧串号）
  const mchid = (process.env.WECHAT_PAY_MCHID ?? '').trim();
  if (!mchid || transaction.mchid !== mchid) {
    log.error('pay-notify mchid mismatch', { outTradeNo, notifiedMchid: transaction.mchid });
    return fail(400, 'MCHID_MISMATCH');
  }

  try {
    const result = await markOrderPaidAndGrant({
      outTradeNo,
      wxTransactionId,
      amountFen,
      transactionTime: transaction.success_time,
    });
    if (!result.duplicate) {
      log.info('recharge order paid', { outTradeNo, points: result.points, tier: result.membership?.tier });
      // 客服消息通知（48h 窗口外静默失败），不阻塞回执
      await notifyRechargePaidBestEffort(result);
    }
    return NextResponse.json({ code: 'SUCCESS', message: '成功' });
  } catch (error) {
    if (error instanceof OrderNotFoundError) {
      log.warn('pay-notify order not found', { outTradeNo });
      return fail(404, 'ORDER_NOT_FOUND');
    }
    if (error instanceof OrderNotPayableError) {
      log.warn('pay-notify order not payable', { outTradeNo, status: error.status });
      return fail(400, 'ORDER_NOT_PAYABLE');
    }
    if (error instanceof AmountMismatchError) {
      // markOrderPaidAndGrant 内部已 log.error 留痕
      return fail(400, 'AMOUNT_MISMATCH');
    }
    log.error('pay-notify grant failed', {
      outTradeNo,
      error: error instanceof Error ? error.message : String(error),
    });
    return fail(500, 'INTERNAL_ERROR');
  }
}
