import { describe, expect, it } from 'vitest';
import type { AppExecutionContext } from '../types';
import { normalizeTeachBackTargets } from './teach-back.plugin';

function makeContext(): AppExecutionContext {
  return {
    input: {
      sessionId: 's1',
      dataSource: 'live',
      transcript: [
        { text: '三次握手是为了确认双方的发送和接收能力都正常，防止已失效的连接请求突然又传到服务端。', startMs: 0, endMs: 12_000 },
        { text: '流量控制让接收方来得及处理，滑动窗口大小由接收方通告。', startMs: 12_000, endMs: 24_000 },
      ] as never,
      anchors: [],
    },
    memory: {},
    goal: { intent: 'test', appKey: 'teach-back' },
  } as AppExecutionContext;
}

describe('normalizeTeachBackTargets', () => {
  it('正规化目标并用 anchorText 锚定证据', () => {
    const targets = normalizeTeachBackTargets(
      {
        targets: [
          { point: '讲清楚为什么需要三次握手', why: '这是全课的核心机制', anchorText: '三次握手是为了确认双方的发送和接收能力都正常' },
          { point: '讲清楚滑动窗口怎么做流量控制', anchorText: '滑动窗口大小由接收方通告' },
        ],
      },
      makeContext(),
    );
    expect(targets).toHaveLength(2);
    expect(targets[0].id).toBe('target-1');
    expect(targets[0].evidence?.startMs).toBe(0);
    expect(targets[1].evidence?.startMs).toBe(12_000);
  });

  it('锚不住的 anchorText 不伪造时间戳', () => {
    const targets = normalizeTeachBackTargets(
      { targets: [{ point: '讲清楚拥塞控制的四个阶段', anchorText: '原文里完全没有的内容甲乙丙丁' }] },
      makeContext(),
    );
    expect(targets).toHaveLength(1);
    expect(targets[0].evidence).toBeNull();
  });

  it('point 太短或重复被丢弃，最多 5 个', () => {
    const targets = normalizeTeachBackTargets(
      {
        targets: [
          { point: '短' },
          { point: '讲清楚为什么需要三次握手' },
          { point: '讲清楚为什么需要三次握手' },
          { point: '目标点三的内容描述' },
          { point: '目标点四的内容描述' },
          { point: '目标点五的内容描述' },
          { point: '目标点六的内容描述' },
          { point: '目标点七的内容描述' },
        ],
      },
      makeContext(),
    );
    expect(targets).toHaveLength(5);
    expect(targets[0].point).toBe('讲清楚为什么需要三次握手');
  });

  it('raw 不是合法结构时返回空', () => {
    expect(normalizeTeachBackTargets(null, makeContext())).toEqual([]);
    expect(normalizeTeachBackTargets({ targets: 'nope' }, makeContext())).toEqual([]);
  });
});
