import { describe, expect, it } from 'vitest';
import sessionLink from './session-link.js';

const {
  parseTimelineOffsetMessage,
  shiftSpan,
  isClientIdle,
  resolveTurnTuning,
  CLIENT_IDLE_TIMEOUT_MS,
} = sessionLink;

describe('parseTimelineOffsetMessage', () => {
  it('只认 timeline-offset 消息，其他消息返回 null', () => {
    expect(parseTimelineOffsetMessage({ type: 'ping', at: 1 })).toBeNull();
    expect(parseTimelineOffsetMessage(null)).toBeNull();
    expect(parseTimelineOffsetMessage('timeline-offset')).toBeNull();
  });

  it('合法偏移取整返回；负数 / NaN / 缺失落回 0；超过 24h 截断', () => {
    expect(parseTimelineOffsetMessage({ type: 'timeline-offset', offsetMs: 61234.6 })).toBe(61235);
    expect(parseTimelineOffsetMessage({ type: 'timeline-offset', offsetMs: -5 })).toBe(0);
    expect(parseTimelineOffsetMessage({ type: 'timeline-offset', offsetMs: 'abc' })).toBe(0);
    expect(parseTimelineOffsetMessage({ type: 'timeline-offset' })).toBe(0);
    expect(parseTimelineOffsetMessage({ type: 'timeline-offset', offsetMs: 10 ** 12 })).toBe(24 * 60 * 60 * 1000);
  });
});

describe('shiftSpan', () => {
  it('重连后的上游时间戳按偏移平移回课堂时间轴', () => {
    expect(shiftSpan({ beginTime: 1200, endTime: 3400 }, 60_000)).toEqual({ beginTime: 61_200, endTime: 63_400 });
  });

  it('首次连接偏移 0 时原样返回；endTime 不早于 beginTime', () => {
    expect(shiftSpan({ beginTime: 500, endTime: 900 }, 0)).toEqual({ beginTime: 500, endTime: 900 });
    expect(shiftSpan({ beginTime: 900, endTime: 500 }, 0)).toEqual({ beginTime: 900, endTime: 900 });
  });

  it('非法偏移视为 0', () => {
    expect(shiftSpan({ beginTime: 100, endTime: 200 }, Number.NaN)).toEqual({ beginTime: 100, endTime: 200 });
    expect(shiftSpan({ beginTime: 100, endTime: 200 }, -3000)).toEqual({ beginTime: 100, endTime: 200 });
  });
});

describe('isClientIdle', () => {
  it('客户端 15s 一次 ping：60s 内有消息不算死，超过就算半开', () => {
    const now = 1_000_000;
    expect(isClientIdle({ lastClientMessageAt: now - 30_000, now })).toBe(false);
    expect(isClientIdle({ lastClientMessageAt: now - CLIENT_IDLE_TIMEOUT_MS, now })).toBe(false);
    expect(isClientIdle({ lastClientMessageAt: now - CLIENT_IDLE_TIMEOUT_MS - 1, now })).toBe(true);
  });
});

describe('resolveTurnTuning', () => {
  it('没申明就是课堂默认：静音 1000ms 断句、interim 800ms 一发', () => {
    expect(resolveTurnTuning({})).toEqual({ turnSilenceMs: 1000, draftFlushMs: 800 });
    expect(resolveTurnTuning({ query: { token: 'x' } })).toEqual({ turnSilenceMs: 1000, draftFlushMs: 800 });
  });

  it('env 覆盖默认；查询串（讲给同桌听）再覆盖 env', () => {
    const env = { DASHSCOPE_ASR_WS_VAD_SILENCE_MS: '1300', ASR_DRAFT_FLUSH_MS: '600' };
    expect(resolveTurnTuning({ env })).toEqual({ turnSilenceMs: 1300, draftFlushMs: 600 });
    expect(resolveTurnTuning({ env, query: { vadSilenceMs: '500', draftFlushMs: '250' } })).toEqual({ turnSilenceMs: 500, draftFlushMs: 250 });
  });

  it('越界钳进区间、非法值回落', () => {
    expect(resolveTurnTuning({ query: { vadSilenceMs: '50', draftFlushMs: '9999' } })).toEqual({ turnSilenceMs: 200, draftFlushMs: 2500 });
    expect(resolveTurnTuning({ query: { vadSilenceMs: 'abc', draftFlushMs: '' } })).toEqual({ turnSilenceMs: 1000, draftFlushMs: 800 });
    expect(resolveTurnTuning({ query: { vadSilenceMs: ['500'] } })).toEqual({ turnSilenceMs: 1000, draftFlushMs: 800 });
    expect(resolveTurnTuning({ env: { DASHSCOPE_ASR_WS_VAD_SILENCE_MS: 'nope' } })).toEqual({ turnSilenceMs: 1000, draftFlushMs: 800 });
  });
});
