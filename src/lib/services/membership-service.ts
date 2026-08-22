/**
 * membership-service — 订阅会员权益的唯一读写口
 *
 * 模型：Membership 表（userId 唯一）；无记录或 expiresAt 已过 = 免费档，
 * 读时判断，无需定时任务/到期脚本。
 *
 * 职责：
 * - getActiveMembership：查当前有效档位（消费点只读这个，不直接碰表）
 * - grantMembershipInTx：支付到账时 upsert（在 markOrderPaidAndGrant 的事务里调用，
 *   续期从 max(now, 现有 expiresAt) 叠加天数；换档 = 档位覆盖 + 时长叠加）
 * - grantMembershipAdmin：管理端人工发放（留 reason 日志）
 *
 * 铁律：档位数值（天数/配额）只从 pricing.ts MEMBERSHIP_PLANS 取，这里不出现字面量。
 */

import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import {
  getMembershipPlan,
  type MembershipPlan,
  type MembershipTier,
} from '@/lib/config/pricing';
import { createLogger } from '@/lib/logger';

const log = createLogger('membership');

export interface ActiveMembership {
  tier: MembershipTier;
  /** free 档为 null */
  expiresAt: Date | null;
}

const FREE_MEMBERSHIP: ActiveMembership = { tier: 'free', expiresAt: null };

/** 查当前有效档位；无记录 / 已过期 / 未知档位一律按免费处理 */
export async function getActiveMembership(userId: string): Promise<ActiveMembership> {
  const row = await prisma.membership.findUnique({ where: { userId } });
  if (!row) return FREE_MEMBERSHIP;
  if (row.expiresAt.getTime() <= Date.now()) return FREE_MEMBERSHIP;
  if (!getMembershipPlan(row.tier as MembershipTier)) {
    log.warn('unknown membership tier, treat as free', { userId, tier: row.tier });
    return FREE_MEMBERSHIP;
  }
  return { tier: row.tier as MembershipTier, expiresAt: row.expiresAt };
}

/**
 * 支付到账发放会员（须在事务内调用，与订单状态推进同生共死）。
 * 续期语义：现有未到期时长不吞——从 max(now, 现有 expiresAt) 起叠加 plan.days。
 * 返回新的 expiresAt。
 */
export async function grantMembershipInTx(
  tx: Prisma.TransactionClient,
  input: { userId: string; plan: MembershipPlan; outTradeNo: string },
): Promise<Date> {
  const now = new Date();
  const existing = await tx.membership.findUnique({ where: { userId: input.userId } });
  const base = existing && existing.expiresAt.getTime() > now.getTime() ? existing.expiresAt : now;
  const expiresAt = new Date(base.getTime() + input.plan.days * 86_400_000);
  await tx.membership.upsert({
    where: { userId: input.userId },
    create: {
      userId: input.userId,
      tier: input.plan.tier,
      expiresAt,
      sourceOutTradeNo: input.outTradeNo,
    },
    update: { tier: input.plan.tier, expiresAt, sourceOutTradeNo: input.outTradeNo },
  });
  return expiresAt;
}

/** 管理端人工发放（补偿/活动），与支付到账同一语义 */
export async function grantMembershipAdmin(
  userId: string,
  tier: Exclude<MembershipTier, 'free'>,
  days: number,
  reason: string,
): Promise<ActiveMembership> {
  const plan = getMembershipPlan(tier);
  if (!plan) throw new Error(`unknown membership tier: ${tier}`);
  const expiresAt = await prisma.$transaction((tx) =>
    grantMembershipInTx(tx, { userId, plan: { ...plan, days }, outTradeNo: `admin:${reason}` }),
  );
  log.info('admin grant membership', { userId, tier, days, reason });
  return { tier, expiresAt };
}
