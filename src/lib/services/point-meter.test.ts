/**
 * point-meter 单测 —— 积分影子计量 Phase 1
 *
 * 覆盖：定价计算（已知模型 / 大小写 / fallback / 异常值）、
 * 影子流水写入字段、幂等冲突跳过、写库失败不抛、guest 归属推导。
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const createMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({
  default: { pointTransaction: { create: createMock } },
}));

import { calcCostMilliYuan } from '@/lib/config/pricing';
import {
  meterUserIdFromRequest,
  recordLLMUsage,
} from '@/lib/services/point-meter';

describe('calcCostMilliYuan', () => {
  it('已知模型按定价表折算（DeepSeek-V4-Flash：1000/2000 毫元每百万）', () => {
    // 100 万输入 + 100 万输出 = 1000 + 2000 = 3000 毫元
    expect(calcCostMilliYuan('DeepSeek-V4-Flash', 1_000_000, 1_000_000)).toBe(3000);
    // 1 万输入 + 2 万输出 = 10 + 40 = 50 毫元
    expect(calcCostMilliYuan('DeepSeek-V4-Flash', 10_000, 20_000)).toBe(50);
  });

  it('模型名大小写不敏感（DeepSeek 官方 API 只接受小写）', () => {
    expect(calcCostMilliYuan('deepseek-v4-flash', 1_000_000, 0)).toBe(1000);
  });

  it('未知模型走 fallback 定价（2000/4000）', () => {
    expect(calcCostMilliYuan('some-unknown-model', 1_000_000, 1_000_000)).toBe(6000);
  });

  it('token 缺失 / 负数按 0 计', () => {
    expect(calcCostMilliYuan('DeepSeek-V4-Flash', Number.NaN, -5)).toBe(0);
  });
});

describe('recordLLMUsage', () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it('写影子流水：delta=0、kind=spend、成本按定价表计算', async () => {
    createMock.mockResolvedValue({ id: 'tx1' });
    const ok = await recordLLMUsage({
      userId: 'user_1',
      feature: 'tutor:review',
      modelId: 'DeepSeek-V4-Flash',
      usage: { promptTokens: 100_000, completionTokens: 50_000 },
      refType: 'tutor',
      refId: 'session_1',
      idempotencyKey: 'k1',
    });
    expect(ok).toBe(true);
    expect(createMock).toHaveBeenCalledTimes(1);
    const data = createMock.mock.calls[0][0].data;
    expect(data).toMatchObject({
      userId: 'user_1',
      delta: 0,
      kind: 'spend',
      points: 0,
      refType: 'tutor',
      refId: 'session_1',
      modelId: 'DeepSeek-V4-Flash',
      promptTokens: 100_000,
      completionTokens: 50_000,
      idempotencyKey: 'k1',
      // 100k 输入 ×1000 + 50k 输出 ×2000 = 100 + 100 = 200 毫元
      costMilliYuan: 200,
    });
  });

  it('userId 缺失时兜底 anonymous', async () => {
    createMock.mockResolvedValue({ id: 'tx2' });
    await recordLLMUsage({
      feature: 'understanding',
      modelId: 'qwen3.7-plus',
      usage: { promptTokens: 1000, completionTokens: 1000 },
    });
    expect(createMock.mock.calls[0][0].data.userId).toBe('anonymous');
  });

  it('零 token 调用不落库', async () => {
    const ok = await recordLLMUsage({
      feature: 'apps:quiz',
      modelId: 'DeepSeek-V4-Flash',
      usage: { promptTokens: 0, completionTokens: 0 },
    });
    expect(ok).toBe(false);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('幂等键冲突（P2002）静默跳过', async () => {
    createMock.mockRejectedValue(Object.assign(new Error('Unique constraint'), { code: 'P2002' }));
    const ok = await recordLLMUsage({
      feature: 'tutor:global',
      modelId: 'DeepSeek-V4-Flash',
      usage: { promptTokens: 100, completionTokens: 100 },
      idempotencyKey: 'dup',
    });
    expect(ok).toBe(false);
  });

  it('写库失败只返回 false，绝不抛异常', async () => {
    createMock.mockRejectedValue(new Error('database is locked'));
    await expect(
      recordLLMUsage({
        feature: 'wechat-agent',
        modelId: 'DeepSeek-V4-Flash',
        usage: { promptTokens: 100, completionTokens: 100 },
      }),
    ).resolves.toBe(false);
  });
});

describe('meterUserIdFromRequest', () => {
  const makeRequest = (headers: Record<string, string>) =>
    new Request('https://example.com/api/x', { headers });

  it('已登录用户直接用 userId', () => {
    expect(meterUserIdFromRequest(makeRequest({}), 'user_42')).toBe('user_42');
  });

  it('未登录用 guest_<ip>（cf-connecting-ip 优先）', () => {
    expect(
      meterUserIdFromRequest(
        makeRequest({ 'cf-connecting-ip': '1.2.3.4', 'x-forwarded-for': '5.6.7.8' }),
        null,
      ),
    ).toBe('guest_1.2.3.4');
    expect(meterUserIdFromRequest(makeRequest({ 'x-forwarded-for': '5.6.7.8, 9.9.9.9' }))).toBe(
      'guest_5.6.7.8',
    );
  });

  it('取不到 IP 兜底 anonymous', () => {
    expect(meterUserIdFromRequest(makeRequest({}))).toBe('anonymous');
  });
});
