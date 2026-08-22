/**
 * point-account-service — 积分机制 Phase 2：真扣费账户服务
 *
 * 职责（与 point-meter 影子计量互补，meter 继续只记真实成本不动余额）：
 * - getOrCreateWithGrants：懒建账户 + 两档发放（欢迎 +500 一次性、每月活跃 +800）
 * - checkCanSpend：扣费预检（余额校验 + 月成本熔断），402 契约的统一来源
 * - spendPoints：原子结算（余额校验 + 扣减 + 写流水含 balanceAfter），幂等键防重
 * - settleAsrMinutes：ASR 分钟结算（先扣当月免费额度，超出按价目扣分）
 * - adjustPoints：管理端调账（kind='adjust'，留痕）
 * - getSummary：/api/points/summary 的账户视图
 *
 * 铁律：
 * - 余额变动全部经 PointTransaction 留痕（balanceAfter），杜绝直接 update 账户
 * - 月度窗口一律用本地时区（new Date(y, m, 1)），与 grant 幂等键的 YYYY-MM 一致
 * - 本服务只面向已登录用户；guest 由调用方跳过（维持现有 rate-limit 行为）
 */

import prisma from '@/lib/prisma';
import { getMembershipPlan, POINTS_CONFIG, type MembershipTier } from '@/lib/config/pricing';
import { getActiveMembership } from '@/lib/services/membership-service';
import { syncOrderFromWeChat } from '@/lib/services/recharge-order-service';
import { createLogger } from '@/lib/logger';

const log = createLogger('point-account');

// ==================== 月度窗口 ====================

/** 当月 1 号 0 点（本地时区） */
export function currentMonthStart(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/** 当日 0 点（本地时区），guest 日闸门用 */
export function currentDayStart(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** 当月 key，格式 YYYY-MM（本地时区），用于月度发放幂等键 */
export function currentMonthKey(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${now.getFullYear()}-${month}`;
}

function isP2002(error: unknown): boolean {
  return (error as { code?: string })?.code === 'P2002';
}

// ==================== 懒建 + 发放 ====================

export interface PointAccountView {
  balance: number;
  totalEarned: number;
  totalSpent: number;
}

/**
 * 单笔发放：事务内读余额 → 写 earn 流水（含 balanceAfter）→ 加余额。
 * 幂等键冲突（P2002）整体回滚并静默跳过，返回 false。
 */
async function grantOnce(
  userId: string,
  idempotencyKey: string,
  points: number,
  reason: string,
): Promise<boolean> {
  try {
    await prisma.$transaction(async (tx) => {
      const account = await tx.pointAccount.findUnique({ where: { userId } });
      if (!account) throw new Error(`point account missing for ${userId}`);
      const balanceAfter = account.balance + points;
      await tx.pointTransaction.create({
        data: {
          userId,
          delta: points,
          kind: 'earn',
          reason,
          refType: 'grant',
          points,
          balanceAfter,
          idempotencyKey,
        },
      });
      await tx.pointAccount.update({
        where: { userId },
        data: { balance: balanceAfter, totalEarned: { increment: points } },
      });
    });
    return true;
  } catch (error) {
    if (isP2002(error)) return false;
    throw error;
  }
}

/**
 * 获取或懒建账户，并落实两档发放：
 * - 欢迎积分（幂等键 grant:welcome:{userId}，一次性，面额 POINTS_CONFIG.welcomeGrant）
 * - 每月活跃发放（幂等键 grant:monthly:{userId}:{tier}:{YYYY-MM}，面额按会员档位：
 *   free 取 POINTS_CONFIG.monthlyGrant，pro/max 取 MEMBERSHIP_PLANS.monthlyGrant。
 *   键带 tier 段 → 月中升档按新档全额再发一笔，不做补差——简单且对付费用户友好）
 * 天然覆盖新注册与存量用户，无需迁移脚本。
 */
export async function getOrCreateWithGrants(userId: string): Promise<PointAccountView> {
  await prisma.pointAccount.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });

  const welcomeGranted = await grantOnce(
    userId,
    `grant:welcome:${userId}`,
    POINTS_CONFIG.welcomeGrant,
    'welcome',
  );
  if (welcomeGranted) log.info('welcome grant issued', { userId });

  const membership = await getActiveMembership(userId);
  const monthlyGranted = await grantOnce(
    userId,
    `grant:monthly:${userId}:${membership.tier}:${currentMonthKey()}`,
    getMembershipPlan(membership.tier)?.monthlyGrant ?? POINTS_CONFIG.monthlyGrant,
    'monthly',
  );
  if (monthlyGranted) log.info('monthly grant issued', { userId, tier: membership.tier });

  const account = await prisma.pointAccount.findUnique({ where: { userId } });
  if (!account) throw new Error(`point account missing after upsert for ${userId}`);
  return { balance: account.balance, totalEarned: account.totalEarned, totalSpent: account.totalSpent };
}

// ==================== 熔断与免费额度 ====================

/** 单用户当月真实成本累计（毫元）：全部 kind='spend' 流水（含影子流水）求和 */
export async function getMonthlyCostMilliYuan(userId: string): Promise<number> {
  const result = await prisma.pointTransaction.aggregate({
    _sum: { costMilliYuan: true },
    where: { userId, kind: 'spend', createdAt: { gte: currentMonthStart() } },
  });
  return result._sum.costMilliYuan ?? 0;
}

/** ASR 当月已用分钟数（免费 + 付费都计，量纲在 quantity 列） */
export async function getMonthlyAsrUsedMinutes(userId: string): Promise<number> {
  const result = await prisma.pointTransaction.aggregate({
    _sum: { quantity: true },
    where: { userId, kind: 'spend', refType: 'asr', createdAt: { gte: currentMonthStart() } },
  });
  return result._sum.quantity ?? 0;
}

/** 当月免费 ASR 剩余分钟：额度按会员档位（pro/max 覆盖 POINTS_CONFIG 免费档默认值） */
export async function getAsrFreeMinutesRemaining(userId: string): Promise<number> {
  const [used, membership] = await Promise.all([
    getMonthlyAsrUsedMinutes(userId),
    getActiveMembership(userId),
  ]);
  const quota =
    getMembershipPlan(membership.tier)?.asrFreeMinutesPerMonth ??
    POINTS_CONFIG.asrFreeMinutesPerMonth;
  return Math.max(0, quota - used);
}

// ==================== guest 日闸门 ====================

export type GuestDailyCostCheck =
  | { ok: true; usedMilliYuan: number }
  | { ok: false; error: 'guest_daily_cap'; usedMilliYuan: number };

/**
 * guest（未登录）当日 LLM 成本闸门。影子流水的 userId 是 `guest_<ip>`
 * （见 point-meter.meterUserIdFromRequest），这里按当日窗口累计，
 * 达到上限后调用方返回 402 guest_daily_cap 引导登录。
 */
export async function checkGuestDailyCost(guestKey: string): Promise<GuestDailyCostCheck> {
  const result = await prisma.pointTransaction.aggregate({
    _sum: { costMilliYuan: true },
    where: { userId: guestKey, kind: 'spend', createdAt: { gte: currentDayStart() } },
  });
  const used = result._sum.costMilliYuan ?? 0;
  return used >= POINTS_CONFIG.guestDailyCostCapMilliYuan
    ? { ok: false, error: 'guest_daily_cap', usedMilliYuan: used }
    : { ok: true, usedMilliYuan: used };
}

// ==================== 预检 ====================

export type SpendCheck =
  | { ok: true; balance: number }
  | { ok: false; error: 'insufficient_points' | 'monthly_cost_cap'; balance: number; required: number };

/**
 * 扣费预检：先懒建/发放（首次访问积分体系的定义入口之一），再熔断、再余额。
 * 熔断优先于余额校验；触发熔断时 required 按契约回 0。
 */
export async function checkCanSpend(userId: string, required: number): Promise<SpendCheck> {
  const account = await getOrCreateWithGrants(userId);
  const monthCost = await getMonthlyCostMilliYuan(userId);
  if (monthCost >= POINTS_CONFIG.monthlyCostCapMilliYuan) {
    return { ok: false, error: 'monthly_cost_cap', balance: account.balance, required: 0 };
  }
  if (account.balance < required) {
    return { ok: false, error: 'insufficient_points', balance: account.balance, required };
  }
  return { ok: true, balance: account.balance };
}

// ==================== 结算 ====================

export interface SpendPointsInput {
  userId: string;
  /** 扣减积分数（正数） */
  points: number;
  reason: string;
  refType: string;
  refId?: string | null;
  /** 本次行为对应的真实成本（毫元，计入熔断累计）；ASR 分钟暂无定价传 0 */
  costMilliYuan?: number;
  /** 量纲（ASR 分钟数）；普通扣费不传 */
  quantity?: number | null;
  idempotencyKey: string;
}

export type SpendResult =
  | { ok: true; balanceAfter: number; duplicate?: boolean }
  | { ok: false; error: 'insufficient_points'; balance: number; required: number };

class InsufficientBalanceError extends Error {
  constructor(public readonly balance: number) {
    super('insufficient points balance');
  }
}

/**
 * 原子结算：事务内余额校验 + 扣减 + 写流水（含 balanceAfter）。
 * 预检通过后并发透支由这里的二次校验兜底；余额不足整体回滚。
 * 幂等键冲突 → duplicate（已扣过，不重复扣）。
 */
export async function spendPoints(input: SpendPointsInput): Promise<SpendResult> {
  const points = Math.max(0, Math.round(input.points));
  try {
    const balanceAfter = await prisma.$transaction(async (tx) => {
      const account = await tx.pointAccount.findUnique({ where: { userId: input.userId } });
      if (!account) throw new InsufficientBalanceError(0);
      if (account.balance < points) throw new InsufficientBalanceError(account.balance);
      const nextBalance = account.balance - points;
      await tx.pointTransaction.create({
        data: {
          userId: input.userId,
          delta: -points,
          kind: 'spend',
          reason: input.reason,
          refType: input.refType,
          refId: input.refId ?? null,
          points,
          costMilliYuan: input.costMilliYuan ?? 0,
          quantity: input.quantity ?? null,
          balanceAfter: nextBalance,
          idempotencyKey: input.idempotencyKey,
        },
      });
      await tx.pointAccount.update({
        where: { userId: input.userId },
        data: { balance: nextBalance, totalSpent: { increment: points } },
      });
      return nextBalance;
    });
    return { ok: true, balanceAfter };
  } catch (error) {
    if (error instanceof InsufficientBalanceError) {
      return {
        ok: false,
        error: 'insufficient_points',
        balance: error.balance,
        required: points,
      };
    }
    if (isP2002(error)) {
      const existing = await prisma.pointTransaction.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      return { ok: true, balanceAfter: existing?.balanceAfter ?? 0, duplicate: true };
    }
    throw error;
  }
}

// ==================== ASR 分钟结算 ====================

export interface SettleAsrResult {
  settled: boolean;
  duplicate?: boolean;
  minutes: number;
  freeMinutesApplied: number;
  paidMinutes: number;
  pointsCharged: number;
  balanceAfter: number | null;
}

/**
 * ASR 转写分钟结算（录课 WS 由 /api/points/settle-asr 调用；播客/视频导入由
 * /api/video/import 成功转写后调用，reason='asr:import'）：
 * - 每次来源只记一条量纲流水（quantity=分钟数，幂等键 asr:{userId}:{connectionId}）
 * - 先吃当月免费额度（600 分钟，录课与导入共享）；免费部分 delta=0
 * - 超出部分按 asrPricePerMinute 扣分；余额不足按可用余额截断
 *   （音频已经转完，无法撤回——服务端只留痕并 warn，预检由前端 asr-quota 负责）
 * - 实时 ASR 暂无成本定价，costMilliYuan 记 0，不进入月成本熔断
 */
export async function settleAsrMinutes(
  userId: string,
  connectionId: string,
  minutes: number,
  reason = 'asr',
): Promise<SettleAsrResult> {
  const billedMinutes = Math.max(0, Math.ceil(minutes));
  if (billedMinutes <= 0) {
    return {
      settled: false,
      minutes: 0,
      freeMinutesApplied: 0,
      paidMinutes: 0,
      pointsCharged: 0,
      balanceAfter: null,
    };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const monthStart = currentMonthStart();
      const usedAgg = await tx.pointTransaction.aggregate({
        _sum: { quantity: true },
        where: { userId, kind: 'spend', refType: 'asr', createdAt: { gte: monthStart } },
      });
      const freeRemaining = Math.max(
        0,
        POINTS_CONFIG.asrFreeMinutesPerMonth - (usedAgg._sum.quantity ?? 0),
      );
      const freeMinutesApplied = Math.min(billedMinutes, freeRemaining);
      const paidMinutes = billedMinutes - freeMinutesApplied;
      const requestedPoints = paidMinutes * POINTS_CONFIG.asrPricePerMinute;

      const account = await tx.pointAccount.findUnique({ where: { userId } });
      if (!account) throw new Error(`point account missing for ${userId}`);
      const pointsCharged = Math.min(requestedPoints, account.balance);
      if (pointsCharged < requestedPoints) {
        log.warn('asr settle clamped by balance', {
          userId,
          connectionId,
          requestedPoints,
          pointsCharged,
        });
      }
      const balanceAfter = account.balance - pointsCharged;

      await tx.pointTransaction.create({
        data: {
          userId,
          delta: -pointsCharged,
          kind: 'spend',
          reason,
          refType: 'asr',
          refId: connectionId,
          points: pointsCharged,
          costMilliYuan: 0,
          quantity: billedMinutes,
          balanceAfter,
          idempotencyKey: `asr:${userId}:${connectionId}`,
        },
      });
      if (pointsCharged > 0) {
        await tx.pointAccount.update({
          where: { userId },
          data: { balance: balanceAfter, totalSpent: { increment: pointsCharged } },
        });
      }

      return {
        settled: true,
        minutes: billedMinutes,
        freeMinutesApplied,
        paidMinutes,
        pointsCharged,
        balanceAfter,
      };
    });
  } catch (error) {
    if (isP2002(error)) {
      return {
        settled: true,
        duplicate: true,
        minutes: billedMinutes,
        freeMinutesApplied: 0,
        paidMinutes: 0,
        pointsCharged: 0,
        balanceAfter: null,
      };
    }
    throw error;
  }
}

/** 匿名连接的 ASR 影子流水：只记量纲不扣分（free 额度也不扣，保持 guest 现状） */
export async function recordAnonymousAsrMinutes(
  connectionId: string,
  minutes: number,
  reason = 'asr',
  /** L1 堵漏：按 guest_<ip> 归属后可做 per-guest 日限额；缺省保持旧的共享 anonymous 桶 */
  guestKey?: string,
): Promise<boolean> {
  const billedMinutes = Math.max(0, Math.ceil(minutes));
  if (billedMinutes <= 0) return false;
  const userId = guestKey || 'anonymous';
  try {
    await prisma.pointTransaction.create({
      data: {
        userId,
        delta: 0,
        kind: 'spend',
        reason,
        refType: 'asr',
        refId: connectionId,
        points: 0,
        costMilliYuan: 0,
        quantity: billedMinutes,
        idempotencyKey: `asr:${userId}:${connectionId}`,
      },
    });
    return true;
  } catch (error) {
    if (isP2002(error)) return false;
    log.warn('record anonymous asr minutes failed', {
      connectionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/** guest 当日 ASR 已用分钟数（按 guest_<ip> 影子流水的量纲累计，日闸门用） */
export async function getGuestDailyAsrMinutes(guestKey: string): Promise<number> {
  const result = await prisma.pointTransaction.aggregate({
    _sum: { quantity: true },
    where: { userId: guestKey, kind: 'spend', refType: 'asr', createdAt: { gte: currentDayStart() } },
  });
  return result._sum.quantity ?? 0;
}

// ==================== 管理端调账 ====================

export type AdjustResult =
  | { ok: true; balanceAfter: number }
  | { ok: false; error: 'negative_balance'; balance: number };

/** 管理端调账：正负皆可，但不允许把余额调成负数；kind='adjust' 留痕 */
export async function adjustPoints(userId: string, delta: number, reason: string): Promise<AdjustResult> {
  const amount = Math.round(delta);
  if (amount === 0) {
    const account = await getOrCreateWithGrants(userId);
    return { ok: true, balanceAfter: account.balance };
  }
  await getOrCreateWithGrants(userId);
  try {
    const balanceAfter = await prisma.$transaction(async (tx) => {
      const account = await tx.pointAccount.findUnique({ where: { userId } });
      if (!account) throw new Error(`point account missing for ${userId}`);
      const nextBalance = account.balance + amount;
      if (nextBalance < 0) {
        throw new InsufficientBalanceError(account.balance);
      }
      await tx.pointTransaction.create({
        data: {
          userId,
          delta: amount,
          kind: 'adjust',
          reason,
          refType: 'admin',
          points: Math.abs(amount),
          balanceAfter: nextBalance,
          idempotencyKey: `adjust:${userId}:${crypto.randomUUID()}`,
        },
      });
      await tx.pointAccount.update({
        where: { userId },
        data: {
          balance: nextBalance,
          ...(amount > 0
            ? { totalEarned: { increment: amount } }
            : { totalSpent: { increment: -amount } }),
        },
      });
      return nextBalance;
    });
    return { ok: true, balanceAfter };
  } catch (error) {
    if (error instanceof InsufficientBalanceError) {
      return { ok: false, error: 'negative_balance', balance: error.balance };
    }
    throw error;
  }
}

// ==================== Summary ====================

/**
 * 惰性对账（best-effort）：summary 是用户回到应用后的必经取数点，
 * 顺带把"微信回调没到/被丢"的卡单兑掉——查该用户最近 2 小时内
 * pending/expired 且未带微信交易号的订单，逐笔向微信查单兑账
 * （微信 Native code_url 2 小时有效，超出窗口的订单不可能再被支付）。
 * 正常情况下卡单为零、不发任何外部请求；任何失败都不阻塞 summary。
 */
async function reconcileRecentOrdersBestEffort(userId: string): Promise<void> {
  try {
    const stuckOrders = await prisma.rechargeOrder.findMany({
      where: {
        userId,
        status: { in: ['pending', 'expired'] },
        wxTransactionId: null,
        createdAt: { gte: new Date(Date.now() - 2 * 60 * 60_000) },
      },
      select: { outTradeNo: true },
    });
    for (const order of stuckOrders) {
      const result = await syncOrderFromWeChat(order.outTradeNo).catch(() => null);
      if (result && !result.duplicate) {
        log.info('lazy reconcile granted stuck order', { userId, outTradeNo: order.outTradeNo });
      }
    }
  } catch (error) {
    log.warn('lazy reconcile failed', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export interface PointsSummary {
  balance: number;
  totalEarned: number;
  totalSpent: number;
  asrFreeMinutesRemaining: number;
  asrPricePerMinute: number;
  monthCostMilliYuan: number;
  monthCostCapMilliYuan: number;
  /** 当前会员档位（free 档 expiresAt 为 null） */
  membership: { tier: MembershipTier; expiresAt: string | null };
  /** 当月免费 ASR 总额度（按档位；前端进度条分母） */
  asrFreeMinutesPerMonth: number;
  recentTransactions: Array<{
    delta: number;
    kind: string;
    reason: string | null;
    createdAt: string;
    balanceAfter: number | null;
  }>;
}

/** /api/points/summary 契约视图（含懒建与发放） */
export async function getSummary(userId: string): Promise<PointsSummary> {
  await reconcileRecentOrdersBestEffort(userId);
  const account = await getOrCreateWithGrants(userId);
  const [asrFreeMinutesRemaining, monthCostMilliYuan, membership, recent] = await Promise.all([
    getAsrFreeMinutesRemaining(userId),
    getMonthlyCostMilliYuan(userId),
    getActiveMembership(userId),
    prisma.pointTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { delta: true, kind: true, reason: true, createdAt: true, balanceAfter: true },
    }),
  ]);
  return {
    ...account,
    asrFreeMinutesRemaining,
    asrPricePerMinute: POINTS_CONFIG.asrPricePerMinute,
    monthCostMilliYuan,
    monthCostCapMilliYuan: POINTS_CONFIG.monthlyCostCapMilliYuan,
    membership: {
      tier: membership.tier,
      expiresAt: membership.expiresAt ? membership.expiresAt.toISOString() : null,
    },
    asrFreeMinutesPerMonth:
      getMembershipPlan(membership.tier)?.asrFreeMinutesPerMonth ??
      POINTS_CONFIG.asrFreeMinutesPerMonth,
    recentTransactions: recent.map((tx) => ({
      delta: tx.delta,
      kind: tx.kind,
      reason: tx.reason,
      createdAt: tx.createdAt.toISOString(),
      balanceAfter: tx.balanceAfter,
    })),
  };
}
