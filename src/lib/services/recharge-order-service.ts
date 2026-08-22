/**
 * recharge-order-service — 积分充值订单编排（微信 Native 扫码支付）
 *
 * 职责：
 * - createRechargeOrder：校验充值包 → 落 pending 订单（金额/积分快照，+30min 过期）
 *   → 微信 Native 下单 → 返回 codeUrl；微信支付未配置或下单失败抛 PayUnavailableError
 * - getOrderForUser：查单（仅限本人），超期 pending 惰性置 expired
 * - markOrderPaidAndGrant：支付回调到账——单事务内校验订单状态/金额快照 → 置 paid
 *   → 写 earn 流水（幂等键 recharge:{outTradeNo}）→ 加余额；重复回调幂等成功
 * - notifyRechargePaidBestEffort：到账后客服消息通知（48h 窗口外静默失败）
 *
 * 铁律（与 point-account-service 一致）：
 * - 余额变动全部经 PointTransaction 留痕（balanceAfter），杜绝直接 update 账户
 * - 金额以回调原文与本地快照比对为准，不一致拒绝到账（防伪造）
 */

import crypto from 'node:crypto';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import {
  getMembershipPlanByPackKey,
  getPayableItem,
  type MembershipTier,
} from '@/lib/config/pricing';
import { grantMembershipInTx } from '@/lib/services/membership-service';
import {
  createNativeOrder,
  isWechatPayConfigured,
  queryNativeOrder,
} from '@/lib/services/wechat-pay-service';
import { pushWechatCustomerText } from '@/lib/services/wechat-agent-service';
import { COPY } from '@/lib/ui/copy';
import { createLogger } from '@/lib/logger';

const log = createLogger('recharge-order');

/** 订单有效期：下单后 30 分钟 */
const ORDER_TTL_MS = 30 * 60_000;

function isP2002(error: unknown): boolean {
  return (error as { code?: string })?.code === 'P2002';
}

// ==================== 错误类型 ====================

/** 微信支付不可用（env 未配置 / 无公网回调地址 / 微信下单失败）→ 路由归一 503 */
export class PayUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayUnavailableError';
  }
}

/** packKey 非法 → 路由归一 400 */
export class InvalidRechargePackError extends Error {
  constructor(public readonly packKey: string) {
    super(`unknown recharge pack: ${packKey}`);
    this.name = 'InvalidRechargePackError';
  }
}

/** 订单不存在 → 回调路由 404（微信会继续重试） */
export class OrderNotFoundError extends Error {
  constructor(public readonly outTradeNo: string) {
    super(`recharge order not found: ${outTradeNo}`);
    this.name = 'OrderNotFoundError';
  }
}

/** 订单不可支付（下单失败终态 failed）→ 回调路由 400 */
export class OrderNotPayableError extends Error {
  constructor(public readonly outTradeNo: string, public readonly status: string) {
    super(`recharge order not payable: ${outTradeNo} (${status})`);
    this.name = 'OrderNotPayableError';
  }
}

/** 回调金额与本地快照不一致 → 拒绝到账（防伪造），回调路由 400 */
export class AmountMismatchError extends Error {
  constructor(public readonly outTradeNo: string) {
    super(`recharge amount mismatch: ${outTradeNo}`);
    this.name = 'AmountMismatchError';
  }
}

// ==================== 创建订单 ====================

export interface CreateRechargeOrderResult {
  outTradeNo: string;
  codeUrl: string;
  amountFen: number;
  points: number;
  /** 会员档订单带档位信息（积分包订单无此字段） */
  membership?: { tier: MembershipTier; days: number };
}

/** 商户订单号：R + 毫秒时间戳 + 16 hex，共 30 字符（微信要求 ≤32） */
function generateOutTradeNo(): string {
  return `R${Date.now()}${crypto.randomBytes(8).toString('hex')}`;
}

/** 支付回调地址：WECHAT_PAY_NOTIFY_URL 优先，缺省用公众号公网 base + 固定路径 */
function resolveNotifyUrl(): string {
  const explicit = (process.env.WECHAT_PAY_NOTIFY_URL ?? '').trim();
  if (explicit) return explicit;
  const base = (process.env.WECHAT_MP_PUBLIC_BASE_URL ?? '').trim().replace(/\/+$/, '');
  return base ? `${base}/api/wechat/pay-notify` : '';
}

/**
 * 创建充值订单并调用微信 Native 下单。
 * 积分包与会员档共用同一订单表：会员档 points 快照记 0，权益到账写 Membership。
 * 订单先落库再下单：下单失败把订单置 failed（留痕便于排查），再抛 PayUnavailableError。
 */
export async function createRechargeOrder(
  userId: string,
  packKey: string,
): Promise<CreateRechargeOrderResult> {
  const item = getPayableItem(packKey);
  if (!item) throw new InvalidRechargePackError(packKey);
  if (!isWechatPayConfigured()) {
    throw new PayUnavailableError('wechat pay not configured');
  }
  const notifyUrl = resolveNotifyUrl();
  if (!notifyUrl) {
    throw new PayUnavailableError('wechat pay notify url not configured');
  }

  const amountFen = item.kind === 'points' ? item.pack.amountFen : item.plan.amountFen;
  const points = item.kind === 'points' ? item.pack.points : 0;
  const description =
    item.kind === 'points'
      ? `MeetMind 积分充值-${item.pack.points}积分`
      : `MeetMind 会员-${item.plan.tier} ${item.plan.days}天`;

  const outTradeNo = generateOutTradeNo();
  const now = new Date();
  await prisma.rechargeOrder.create({
    data: {
      outTradeNo,
      userId,
      packKey,
      amountFen,
      points,
      status: 'pending',
      expiredAt: new Date(now.getTime() + ORDER_TTL_MS),
    },
  });

  try {
    const { codeUrl } = await createNativeOrder({ outTradeNo, amountFen, description, notifyUrl });
    return {
      outTradeNo,
      codeUrl,
      amountFen,
      points,
      ...(item.kind === 'membership'
        ? { membership: { tier: item.plan.tier as MembershipTier, days: item.plan.days } }
        : {}),
    };
  } catch (error) {
    await prisma.rechargeOrder.update({
      where: { outTradeNo },
      data: { status: 'failed' },
    }).catch(() => undefined);
    log.error('wechat native order failed', {
      outTradeNo,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new PayUnavailableError('wechat native order failed');
  }
}

// ==================== 查询订单 ====================

export interface RechargeOrderView {
  status: string;
  points: number;
  amountFen: number;
  packKey: string;
}

/** 查单（仅限本人）；超期 pending 惰性置 expired 后返回 expired 视图 */
export async function getOrderForUser(
  outTradeNo: string,
  userId: string,
): Promise<RechargeOrderView | null> {
  const order = await prisma.rechargeOrder.findUnique({ where: { outTradeNo } });
  if (!order || order.userId !== userId) return null;

  if (order.status === 'pending' && order.expiredAt.getTime() <= Date.now()) {
    await prisma.rechargeOrder.update({
      where: { outTradeNo },
      data: { status: 'expired' },
    }).catch(() => undefined);
    return { status: 'expired', points: order.points, amountFen: order.amountFen, packKey: order.packKey };
  }
  return { status: order.status, points: order.points, amountFen: order.amountFen, packKey: order.packKey };
}

// ==================== 到账 ====================

export interface MarkOrderPaidInput {
  outTradeNo: string;
  wxTransactionId: string;
  /** 回调原文 amount.total（分） */
  amountFen: number;
  /** 回调原文 success_time（RFC3339），缺省取当前时间 */
  transactionTime?: string;
}

export type MarkOrderPaidResult =
  | {
      ok: true;
      duplicate?: boolean;
      userId: string;
      points: number;
      balanceAfter: number | null;
      /** 会员档订单到账结果（积分包订单无此字段） */
      membership?: { tier: MembershipTier; expiresAt: Date };
    };

/**
 * 事务内「占位 + 发放」核心（回调与主动查单共用）：
 * updateMany 原子推进 pending/expired→paid（并发/重推只有一个成功；expired 是本地状态，
 * 微信侧确认已付的订单必须能兑账），再按 packKey 分发——
 * 积分包加余额写流水；会员档 upsert Membership。撞零 = 已被并发处理，返回 duplicate。
 */
async function claimAndGrantInTx(
  tx: Prisma.TransactionClient,
  input: {
    order: { outTradeNo: string; userId: string; packKey: string; points: number };
    wxTransactionId: string;
    paidAt: Date;
    idempotencyKey: string;
  },
): Promise<MarkOrderPaidResult> {
  const { order, wxTransactionId, paidAt, idempotencyKey } = input;
  const claimed = await tx.rechargeOrder.updateMany({
    where: { outTradeNo: order.outTradeNo, status: { in: ['pending', 'expired'] } },
    data: { status: 'paid', wxTransactionId, paidAt },
  });
  if (claimed.count === 0) {
    return { ok: true, duplicate: true, userId: order.userId, points: order.points, balanceAfter: null };
  }

  const plan = getMembershipPlanByPackKey(order.packKey);
  if (plan) {
    const expiresAt = await grantMembershipInTx(tx, {
      userId: order.userId,
      plan,
      outTradeNo: order.outTradeNo,
    });
    return {
      ok: true,
      userId: order.userId,
      points: 0,
      balanceAfter: null,
      membership: { tier: plan.tier, expiresAt },
    };
  }

  // 账户可能尚未懒建（用户第一次接触积分体系就是充值），事务内 upsert 兜底
  const account = await tx.pointAccount.upsert({
    where: { userId: order.userId },
    create: { userId: order.userId },
    update: {},
  });
  const balanceAfter = account.balance + order.points;
  await tx.pointTransaction.create({
    data: {
      userId: order.userId,
      delta: order.points,
      kind: 'earn',
      reason: 'recharge',
      refType: 'recharge',
      refId: order.outTradeNo,
      points: order.points,
      balanceAfter,
      idempotencyKey,
    },
  });
  await tx.pointAccount.update({
    where: { userId: order.userId },
    data: { balance: balanceAfter, totalEarned: { increment: order.points } },
  });

  return { ok: true, userId: order.userId, points: order.points, balanceAfter };
}

/**
 * 支付回调到账（单事务）：
 * 订单 pending/expired（微信确认 SUCCESS 即放行，expired 只是本地二维码有效期）
 * → 金额与快照一致 → 置 paid → 按 packKey 类型分发：
 * 积分包 → 写 earn 流水 + 加余额；会员档 → upsert Membership（续期叠加）。
 * 幂等：订单已 paid / 流水幂等键 P2002 / 状态推进 updateMany 撞零 → duplicate 成功（微信重推安全）。
 */
export async function markOrderPaidAndGrant(input: MarkOrderPaidInput): Promise<MarkOrderPaidResult> {
  const idempotencyKey = `recharge:${input.outTradeNo}`;
  try {
    return await prisma.$transaction(async (tx) => {
      const order = await tx.rechargeOrder.findUnique({ where: { outTradeNo: input.outTradeNo } });
      if (!order) throw new OrderNotFoundError(input.outTradeNo);

      // 微信重推：已 paid 直接幂等成功，不重复加分
      if (order.status === 'paid') {
        return { ok: true, duplicate: true, userId: order.userId, points: order.points, balanceAfter: null };
      }

      // failed 是下单失败终态（微信侧根本没建成单），拒付；
      // pending/expired 都放行——expired 约束的只是本地二维码有效期，
      // 微信已验签确认 SUCCESS（且 mchid/金额快照比对通过）的订单必须兑账，
      // 语义与主动查单路径 syncOrderFromWeChat 一致，用户的钱不能丢
      if (order.status !== 'pending' && order.status !== 'expired') {
        throw new OrderNotPayableError(input.outTradeNo, order.status);
      }

      if (order.amountFen !== input.amountFen) {
        log.error('recharge amount mismatch, reject grant', {
          outTradeNo: input.outTradeNo,
          expectedFen: order.amountFen,
          notifiedFen: input.amountFen,
        });
        throw new AmountMismatchError(input.outTradeNo);
      }

      const paidAt = input.transactionTime ? new Date(input.transactionTime) : new Date();
      return claimAndGrantInTx(tx, {
        order,
        wxTransactionId: input.wxTransactionId,
        paidAt,
        idempotencyKey,
      });
    });
  } catch (error) {
    if (isP2002(error)) {
      // 并发重推撞上流水幂等键：已到账过，按 duplicate 成功处理。
      // 会员档订单没有 PointTransaction 流水，流水查不到时回查订单拿 userId，
      // 保证到账通知（notifyRechargePaidBestEffort）不因空 userId 静默丢失
      const existing = await prisma.pointTransaction.findUnique({ where: { idempotencyKey } });
      const fallbackOrder = existing
        ? null
        : await prisma.rechargeOrder.findUnique({ where: { outTradeNo: input.outTradeNo } });
      return {
        ok: true,
        duplicate: true,
        userId: existing?.userId ?? fallbackOrder?.userId ?? '',
        points: existing?.points ?? 0,
        balanceAfter: null,
      };
    }
    throw error;
  }
}

/**
 * 主动查单兑账（回调之外的第二通道）：订单 pending 时向微信查单，
 * 确认 SUCCESS 且金额/mchid 与快照一致 → 直接发放（绕过本地 30 分钟过期——
 * 过期约束的是二维码有效期，微信确认已付必须到账，用户的钱不能丢）。
 * 返回 null = 未支付/查单失败/状态终态，调用方按原流程继续。
 */
export async function syncOrderFromWeChat(outTradeNo: string): Promise<MarkOrderPaidResult | null> {
  const order = await prisma.rechargeOrder.findUnique({ where: { outTradeNo } });
  if (!order) throw new OrderNotFoundError(outTradeNo);
  if (order.status === 'paid') {
    return { ok: true, duplicate: true, userId: order.userId, points: order.points, balanceAfter: null };
  }
  if (order.status !== 'pending' && order.status !== 'expired') return null;

  const query = await queryNativeOrder(outTradeNo);
  if (!query || query.tradeState !== 'SUCCESS') return null;
  if (query.mchid !== (process.env.WECHAT_PAY_MCHID ?? '').trim() || query.amountFen !== order.amountFen) {
    log.error('wechat order query mismatch, reject sync', {
      outTradeNo,
      expectedFen: order.amountFen,
      queriedFen: query.amountFen,
      queriedMchid: query.mchid,
    });
    return null;
  }

  const idempotencyKey = `recharge:${outTradeNo}`;
  try {
    return await prisma.$transaction((tx) =>
      claimAndGrantInTx(tx, {
        order,
        wxTransactionId: query.transactionId,
        paidAt: query.successTime ? new Date(query.successTime) : new Date(),
        idempotencyKey,
      }),
    );
  } catch (error) {
    if (isP2002(error)) {
      return { ok: true, duplicate: true, userId: order.userId, points: order.points, balanceAfter: null };
    }
    throw error;
  }
}

// ==================== 到账通知（best-effort） ====================

/**
 * 到账后给绑定了公众号的用户推客服消息。
 * 48h 窗口外（45015）/未绑定 openid/推送失败都静默跳过——到账以回调为准，通知只是锦上添花。
 * 积分包推积分到账文案；会员档推会员开通文案。
 */
export async function notifyRechargePaidBestEffort(result: MarkOrderPaidResult): Promise<void> {
  try {
    const binding = await prisma.authProvider.findFirst({
      where: { userId: result.userId, provider: 'wechat' },
      select: { providerId: true },
    });
    if (!binding?.providerId) return;
    const text = result.membership
      ? COPY.membership.paidText(
          COPY.membership.tierName[result.membership.tier] ?? result.membership.tier,
          formatLocalDate(result.membership.expiresAt),
        )
      : COPY.points.rechargePaidText(result.points, result.balanceAfter);
    const pushed = await pushWechatCustomerText(binding.providerId, text);
    if (!pushed) {
      log.warn('recharge paid push rejected (likely outside 48h window)', { userId: result.userId });
    }
  } catch (error) {
    log.warn('recharge paid push failed', {
      userId: result.userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** 本地日期 YYYY-MM-DD（到账通知展示用） */
function formatLocalDate(date: Date): string {
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const d = date.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
}
