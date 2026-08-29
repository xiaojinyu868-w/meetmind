import { describe, expect, it } from 'vitest';
import {
  publishFenshenEvent,
  subscribeFenshenEgo,
  fenshenSubscriberCount,
  type FenshenStreamEvent,
} from './event-bus';

describe('fenshen event-bus', () => {
  it('按分身扇出，取消订阅后不再收到', () => {
    const received: FenshenStreamEvent[] = [];
    const unsub = subscribeFenshenEgo('e1', (e) => received.push(e));
    publishFenshenEvent('e1', { type: 'text-delta', text: 'a' });
    publishFenshenEvent('e2', { type: 'text-delta', text: 'b' });
    publishFenshenEvent('e1', { type: 'distill-progress', note: '执行命令：ls' });
    expect(received).toEqual([
      { type: 'text-delta', text: 'a' },
      { type: 'distill-progress', note: '执行命令：ls' },
    ]);
    expect(fenshenSubscriberCount('e1')).toBe(1);
    unsub();
    expect(fenshenSubscriberCount('e1')).toBe(0);
    publishFenshenEvent('e1', { type: 'text-delta', text: 'c' });
    expect(received).toHaveLength(2);
  });

  it('单个订阅者抛异常不影响其他订阅者', () => {
    const received: FenshenStreamEvent[] = [];
    subscribeFenshenEgo('e3', () => {
      throw new Error('boom');
    });
    subscribeFenshenEgo('e3', (e) => received.push(e));
    publishFenshenEvent('e3', { type: 'ego-ready', skillPath: 'skills/kongzi-perspective' });
    expect(received).toEqual([{ type: 'ego-ready', skillPath: 'skills/kongzi-perspective' }]);
  });
});
