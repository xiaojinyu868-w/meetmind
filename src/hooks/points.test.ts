import { describe, expect, it, vi } from 'vitest';
import { fetchPointsSummary } from './points-api';
import { fetchAsrQuota } from './useAsrQuotaPrecheck';
import { parsePointsBlock, describePointsBlock } from './points-guard';
import { parseChatErrorPointsBlock } from './usePaywall';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('fetchPointsSummary', () => {
  it('returns normalized summary on success and sends the Bearer token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        balance: 500,
        totalEarned: 500,
        totalSpent: 0,
        asrFreeMinutesRemaining: 600,
        asrPricePerMinute: 2,
        monthCostMilliYuan: 1234,
        monthCostCapMilliYuan: 20000,
        recentTransactions: [
          { delta: 500, kind: 'earn', reason: 'welcome', createdAt: '2026-08-01T00:00:00Z', balanceAfter: 500 },
        ],
      }),
    );

    const summary = await fetchPointsSummary('token-1', fetchImpl as unknown as typeof fetch);

    expect(fetchImpl).toHaveBeenCalledWith('/api/points/summary', {
      headers: { Authorization: 'Bearer token-1' },
    });
    expect(summary?.balance).toBe(500);
    expect(summary?.asrFreeMinutesRemaining).toBe(600);
    expect(summary?.recentTransactions).toHaveLength(1);
  });

  it('returns null on 401 (logged-out / expired token)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, { error: 'unauthorized' }));
    expect(await fetchPointsSummary('bad', fetchImpl as unknown as typeof fetch)).toBeNull();
  });

  it('returns null on malformed body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    expect(await fetchPointsSummary('token', fetchImpl as unknown as typeof fetch)).toBeNull();
  });

  it('returns null on network failure instead of throwing', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
    expect(await fetchPointsSummary('token', fetchImpl as unknown as typeof fetch)).toBeNull();
  });
});

describe('fetchAsrQuota', () => {
  it('returns the quota on success', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { asrFreeMinutesRemaining: 0, balance: 12, asrPricePerMinute: 2 }),
    );
    const quota = await fetchAsrQuota('token', fetchImpl as unknown as typeof fetch);
    expect(quota).toEqual({ asrFreeMinutesRemaining: 0, balance: 12, asrPricePerMinute: 2 });
  });

  it('returns null when the request fails', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, {}));
    expect(await fetchAsrQuota('token', fetchImpl as unknown as typeof fetch)).toBeNull();
  });
});

describe('parsePointsBlock', () => {
  it('recognizes insufficient_points with balance', () => {
    expect(parsePointsBlock(402, { error: 'insufficient_points', balance: 3, required: 5 })).toEqual({
      kind: 'insufficient_points',
      balance: 3,
      required: 5,
    });
  });

  it('recognizes monthly_cost_cap', () => {
    expect(parsePointsBlock(402, { error: 'monthly_cost_cap', balance: 100, required: 0 })?.kind).toBe(
      'monthly_cost_cap',
    );
  });

  it('ignores non-402 statuses and foreign error bodies', () => {
    expect(parsePointsBlock(429, { error: 'insufficient_points' })).toBeNull();
    expect(parsePointsBlock(402, { error: 'CONTENT_NOT_READY' })).toBeNull();
    expect(parsePointsBlock(402, null)).toBeNull();
  });
});

describe('describePointsBlock', () => {
  it('includes the current balance for insufficient_points', () => {
    expect(describePointsBlock({ kind: 'insufficient_points', balance: 3 })).toContain('3');
    expect(describePointsBlock({ kind: 'insufficient_points', balance: 3 })).toContain('每月初');
  });

  it('falls back gracefully when balance is missing', () => {
    expect(describePointsBlock({ kind: 'insufficient_points' })).not.toContain('undefined');
  });

  it('uses the monthly-cap wording for monthly_cost_cap', () => {
    expect(describePointsBlock({ kind: 'monthly_cost_cap' })).toContain('上限');
  });
});

describe('parseChatErrorPointsBlock', () => {
  it('parses the 402 JSON body that DefaultChatTransport puts in Error.message', () => {
    const error = new Error(JSON.stringify({ error: 'insufficient_points', balance: 3, required: 5 }));
    expect(parseChatErrorPointsBlock(error)).toEqual({ kind: 'insufficient_points', balance: 3, required: 5 });
  });

  it('parses membership_required with requiredTier', () => {
    const error = new Error(JSON.stringify({ error: 'membership_required', requiredTier: 'pro' }));
    expect(parseChatErrorPointsBlock(error)).toEqual({
      kind: 'membership_required',
      balance: undefined,
      required: undefined,
      requiredTier: 'pro',
    });
  });

  it('returns null for non-JSON messages, foreign bodies and missing errors', () => {
    expect(parseChatErrorPointsBlock(new Error('Network Error'))).toBeNull();
    expect(parseChatErrorPointsBlock(new Error(JSON.stringify({ error: 'TUTOR_FATAL' })))).toBeNull();
    expect(parseChatErrorPointsBlock(undefined)).toBeNull();
    expect(parseChatErrorPointsBlock(null)).toBeNull();
  });
});
