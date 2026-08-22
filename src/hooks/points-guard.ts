/**
 * points-guard — 积分扣费拦截（HTTP 402）的统一识别与文案
 *
 * 后端契约：扣费类接口（/api/tutor/agent、/api/apps/execute 等）在积分不足
 * 或本月成本到顶时返回：
 *   HTTP 402 { "error": "insufficient_points" | "monthly_cost_cap" | "guest_daily_cap"
 *              | "membership_required", "balance": number, "required": number,
 *              "requiredTier"?: string }
 * guest_daily_cap：未登录用户的日试用成本到顶，引导登录（balance/required 缺省）。
 * membership_required：会员专属能力（global deep），requiredTier 给最低档位。
 *
 * 所有前端入口（Tutor 面板、应用矩阵 SkillChip/窗口、Workshop 黄页）走这里
 * 统一识别，文案统一从 COPY.points 取——不在组件里散落字符串。
 */

import { COPY } from '@/lib/ui/copy';

export interface PointsBlockInfo {
  kind: 'insufficient_points' | 'monthly_cost_cap' | 'guest_daily_cap' | 'membership_required';
  balance?: number;
  required?: number;
  requiredTier?: string;
}

/**
 * 识别一次响应是不是积分拦截。body 允许为 null/undefined（解析失败的容错）。
 * 返回 null 表示这不是 402 积分拦截，调用方走原有错误路径。
 */
export function parsePointsBlock(status: number, body: unknown): PointsBlockInfo | null {
  if (status !== 402 || !body || typeof body !== 'object') return null;
  const payload = body as { error?: unknown; balance?: unknown; required?: unknown; requiredTier?: unknown };
  if (
    payload.error !== 'insufficient_points'
    && payload.error !== 'monthly_cost_cap'
    && payload.error !== 'guest_daily_cap'
    && payload.error !== 'membership_required'
  ) return null;
  return {
    kind: payload.error,
    balance: typeof payload.balance === 'number' ? payload.balance : undefined,
    required: typeof payload.required === 'number' ? payload.required : undefined,
    requiredTier: typeof payload.requiredTier === 'string' ? payload.requiredTier : undefined,
  };
}

/** 积分拦截对应的用户面文案（安静、说明下月发放/恢复，不喊口号）。 */
export function describePointsBlock(info: PointsBlockInfo): string {
  if (info.kind === 'guest_daily_cap') return COPY.points.blockedGuestDailyCap;
  if (info.kind === 'monthly_cost_cap') return COPY.points.blockedMonthlyCap;
  if (info.kind === 'membership_required') {
    return COPY.membership.blockedMembershipRequired(
      COPY.membership.tierName[info.requiredTier ?? 'pro'] ?? 'Pro',
    );
  }
  return typeof info.balance === 'number'
    ? COPY.points.blockedInsufficient(info.balance)
    : COPY.points.blockedInsufficientUnknown;
}
