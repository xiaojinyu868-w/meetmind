/**
 * token-refresh-scheduler 单测 —— 访问令牌主动续期调度
 *
 * 覆盖：
 * - readTokenExpMs：合法 JWT 解析 exp / 非法 token 返回 null
 * - computeRefreshDelayMs：提前 5 分钟的时点 / 已过期立即刷新 / 无 exp 不调度
 * - scheduleTokenRefresh：到点触发 refresh、失败退避重试一次、取消后不再触发
 */

import { describe, expect, it, vi } from 'vitest';
import {
  computeRefreshDelayMs,
  readTokenExpMs,
  scheduleTokenRefresh,
} from '@/lib/hooks/token-refresh-scheduler';

/** 构造带指定 exp（秒）的 JWT 形状字符串（不签名，调度器只读 payload） */
function fakeJwt(expSeconds?: number): string {
  const payload = expSeconds === undefined ? '{}' : JSON.stringify({ exp: expSeconds });
  return `header.${btoa(payload)}.signature`;
}

describe('readTokenExpMs', () => {
  it('解析合法 JWT 的 exp（秒 → 毫秒）', () => {
    expect(readTokenExpMs(fakeJwt(1_800_000_000))).toBe(1_800_000_000_000);
  });

  it('非法 token / 无 exp → null', () => {
    expect(readTokenExpMs('not-a-jwt')).toBeNull();
    expect(readTokenExpMs('a.b')).toBeNull();
    expect(readTokenExpMs('a.!!!.c')).toBeNull();
    expect(readTokenExpMs(fakeJwt())).toBeNull();
  });
});

describe('computeRefreshDelayMs', () => {
  it('返回 exp - 5min - now 的毫秒数', () => {
    const nowMs = 1_000_000_000_000;
    const token = fakeJwt((nowMs + 10 * 60_000) / 1000);
    expect(computeRefreshDelayMs(token, nowMs)).toBe(5 * 60_000);
  });

  it('已越过刷新时点 → 0（立即刷新）；无 exp → null', () => {
    const nowMs = 1_000_000_000_000;
    const expired = fakeJwt((nowMs - 60_000) / 1000);
    expect(computeRefreshDelayMs(expired, nowMs)).toBe(0);
    expect(computeRefreshDelayMs('bad', nowMs)).toBeNull();
  });
});

describe('scheduleTokenRefresh', () => {
  function fakeTimers() {
    const timers: Array<{ delay: number; fire: () => void }> = [];
    const setTimeoutFn = ((fn: () => void, delay: number) => {
      const entry = { delay, fire: fn };
      timers.push(entry);
      return entry;
    }) as unknown as typeof setTimeout;
    const clearTimeoutFn = ((entry: { delay: number; fire: () => void }) => {
      const index = timers.indexOf(entry);
      if (index >= 0) timers.splice(index, 1);
    }) as unknown as typeof clearTimeout;
    return { timers, setTimeoutFn, clearTimeoutFn };
  }

  it('到点触发 refresh', async () => {
    const { timers, setTimeoutFn, clearTimeoutFn } = fakeTimers();
    const token = fakeJwt((Date.now() + 10 * 60_000) / 1000);
    const refresh = vi.fn(async () => true);
    scheduleTokenRefresh(token, refresh, setTimeoutFn, clearTimeoutFn);
    expect(timers).toHaveLength(1);
    expect(timers[0].delay).toBeLessThanOrEqual(5 * 60_000);
    timers[0].fire();
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it('refresh 失败退避重试一次，再失败放弃', async () => {
    const { timers, setTimeoutFn, clearTimeoutFn } = fakeTimers();
    const token = fakeJwt((Date.now() + 10 * 60_000) / 1000);
    const refresh = vi.fn(async () => false);
    scheduleTokenRefresh(token, refresh, setTimeoutFn, clearTimeoutFn);
    timers[0].fire();
    await vi.waitFor(() => expect(timers).toHaveLength(2));
    expect(timers[1].delay).toBe(30_000);
    timers[1].fire();
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    expect(timers).toHaveLength(2); // 不再排第三次
  });

  it('无 exp 的 token 不调度；取消后不再触发', async () => {
    const { timers, setTimeoutFn, clearTimeoutFn } = fakeTimers();
    const refresh = vi.fn(async () => true);
    scheduleTokenRefresh('no-exp', refresh, setTimeoutFn, clearTimeoutFn);
    expect(timers).toHaveLength(0);

    const token = fakeJwt((Date.now() + 10 * 60_000) / 1000);
    const cancel = scheduleTokenRefresh(token, refresh, setTimeoutFn, clearTimeoutFn);
    cancel();
    expect(timers).toHaveLength(0);
    expect(refresh).not.toHaveBeenCalled();
  });
});
