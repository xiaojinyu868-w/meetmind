/**
 * useAsrQuotaPrecheck — 录课前 ASR 免费额度预检
 *
 * 契约（Bearer）：GET /api/points/asr-quota →
 *   { asrFreeMinutesRemaining, balance, asrPricePerMinute }
 *
 * 在「开一节新课」时调用一次：免费分钟用完时给一句安静的轻提示
 * （继续录会按积分计），不硬阻断录音。未登录 guest 无积分概念，直接跳过。
 * 任何失败都静默——预检绝不能影响录音主流程。
 */

'use client';

import { toast } from 'sonner';
import { COPY } from '@/lib/ui/copy';
import { openPaywallGlobal } from '@/hooks/usePaywall';

export interface AsrQuota {
  asrFreeMinutesRemaining: number;
  balance: number;
  asrPricePerMinute: number;
}

export async function fetchAsrQuota(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AsrQuota | null> {
  try {
    const response = await fetchImpl('/api/points/asr-quota', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return null;
    const data = (await response.json().catch(() => null)) as Partial<AsrQuota> | null;
    if (!data || typeof data.asrFreeMinutesRemaining !== 'number') return null;
    return {
      asrFreeMinutesRemaining: data.asrFreeMinutesRemaining,
      balance: typeof data.balance === 'number' ? data.balance : 0,
      asrPricePerMinute: typeof data.asrPricePerMinute === 'number' ? data.asrPricePerMinute : 0,
    };
  } catch {
    return null;
  }
}

/**
 * 录课前预检：免费分钟为 0 时 toast 一句轻提示（不阻断）。
 * fire-and-forget；调用方不需要 await。
 */
export function precheckAsrQuota(accessToken: string | null): void {
  if (!accessToken) return;
  void fetchAsrQuota(accessToken).then((quota) => {
    if (quota && quota.asrFreeMinutesRemaining <= 0) {
      // 免费分钟用尽且余额不够按分钟续（服务端预检同样会拒）：高意向截断，直接唤起付费页
      if (quota.balance < quota.asrPricePerMinute) {
        openPaywallGlobal({ reason: 'asr_quota' });
      }
      toast.message(COPY.points.asrQuotaExhausted(quota.asrPricePerMinute));
    }
  });
}
