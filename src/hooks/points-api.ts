/**
 * points-api — 积分接口的纯取数层（无 React 依赖，node 环境可直接单测）
 *
 * 契约（Bearer 登录）：
 *   GET /api/points/summary →
 *   { balance, totalEarned, totalSpent, asrFreeMinutesRemaining, asrFreeMinutesPerMonth,
 *     asrPricePerMinute, monthCostMilliYuan, monthCostCapMilliYuan,
 *     membership: { tier, expiresAt }, recentTransactions: [...] }
 *
 * 任何失败（未登录 401、网络、畸形响应）都返回 null——积分是辅助信息，
 * 绝不能因为它把主流程弄崩；调用方据 null 静默隐藏积分 UI。
 */

export interface PointsTransaction {
  delta: number;
  kind: string;
  reason: string;
  createdAt: string;
  balanceAfter?: number;
}

export interface PointsSummary {
  balance: number;
  totalEarned: number;
  totalSpent: number;
  asrFreeMinutesRemaining: number;
  /** 当月免费录课总额度（按会员档位；进度条分母） */
  asrFreeMinutesPerMonth: number;
  asrPricePerMinute: number;
  monthCostMilliYuan: number;
  monthCostCapMilliYuan: number;
  membership: { tier: 'free' | 'pro' | 'max'; expiresAt: string | null };
  recentTransactions: PointsTransaction[];
}

const POINTS_CHANGED_EVENT = 'meetmind:points-changed';
const POINTS_CHANNEL_NAME = 'meetmind-points';

/** 跨标签页广播通道（window 事件只覆盖本标签页，付费/扣费可能发生在别的标签页） */
function getPointsChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return null;
  return new BroadcastChannel(POINTS_CHANNEL_NAME);
}

/** 通知所有 usePointsSummary 实例刷新（扣费成功 / 402 拦截后调用）。 */
export function notifyPointsChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(POINTS_CHANGED_EVENT));
  const channel = getPointsChannel();
  channel?.postMessage('changed');
  channel?.close();
}

/** usePointsSummary 内部监听用；测试中不需要。 */
export function onPointsChanged(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(POINTS_CHANGED_EVENT, listener);
  const channel = getPointsChannel();
  if (channel) {
    channel.onmessage = listener;
  }
  return () => {
    window.removeEventListener(POINTS_CHANGED_EVENT, listener);
    channel?.close();
  };
}

/** 拉取积分摘要；失败一律返回 null。 */
export async function fetchPointsSummary(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PointsSummary | null> {
  try {
    const response = await fetchImpl('/api/points/summary', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return null;
    const data = (await response.json().catch(() => null)) as Partial<PointsSummary> | null;
    if (!data || typeof data.balance !== 'number') return null;
    return {
      balance: data.balance,
      totalEarned: typeof data.totalEarned === 'number' ? data.totalEarned : 0,
      totalSpent: typeof data.totalSpent === 'number' ? data.totalSpent : 0,
      asrFreeMinutesRemaining:
        typeof data.asrFreeMinutesRemaining === 'number' ? data.asrFreeMinutesRemaining : 0,
      asrFreeMinutesPerMonth:
        typeof data.asrFreeMinutesPerMonth === 'number' ? data.asrFreeMinutesPerMonth : 0,
      asrPricePerMinute: typeof data.asrPricePerMinute === 'number' ? data.asrPricePerMinute : 0,
      monthCostMilliYuan: typeof data.monthCostMilliYuan === 'number' ? data.monthCostMilliYuan : 0,
      monthCostCapMilliYuan:
        typeof data.monthCostCapMilliYuan === 'number' ? data.monthCostCapMilliYuan : 0,
      membership:
        data.membership && typeof data.membership === 'object'
          ? {
              tier: (['pro', 'max'].includes((data.membership as { tier?: string }).tier ?? '')
                ? (data.membership as { tier: 'pro' | 'max' }).tier
                : 'free') as 'free' | 'pro' | 'max',
              expiresAt:
                typeof (data.membership as { expiresAt?: unknown }).expiresAt === 'string'
                  ? (data.membership as { expiresAt: string }).expiresAt
                  : null,
            }
          : { tier: 'free', expiresAt: null },
      recentTransactions: Array.isArray(data.recentTransactions)
        ? data.recentTransactions.filter(
            (item): item is PointsTransaction =>
              !!item && typeof item === 'object' && typeof (item as PointsTransaction).delta === 'number',
          )
        : [],
    };
  } catch {
    return null;
  }
}
