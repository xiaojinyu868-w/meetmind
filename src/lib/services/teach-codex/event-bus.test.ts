import { describe, expect, it } from 'vitest';
import {
  publishTeachEvent,
  subscribeTeachThread,
  teachSubscriberCount,
  type TeachStreamEvent,
} from './event-bus';

describe('event-bus', () => {
  it('按线程扇出，取消订阅后不再收到', () => {
    const received: TeachStreamEvent[] = [];
    const unsub = subscribeTeachThread('t1', (e) => received.push(e));
    publishTeachEvent('t1', { type: 'text-delta', text: 'a' });
    publishTeachEvent('t2', { type: 'text-delta', text: 'b' });
    expect(received).toEqual([{ type: 'text-delta', text: 'a' }]);
    expect(teachSubscriberCount('t1')).toBe(1);
    unsub();
    expect(teachSubscriberCount('t1')).toBe(0);
    publishTeachEvent('t1', { type: 'text-delta', text: 'c' });
    expect(received).toHaveLength(1);
  });

  it('单个订阅者抛异常不影响其他订阅者', () => {
    const received: TeachStreamEvent[] = [];
    subscribeTeachThread('t3', () => {
      throw new Error('boom');
    });
    subscribeTeachThread('t3', (e) => received.push(e));
    publishTeachEvent('t3', { type: 'turn-complete' });
    expect(received).toEqual([{ type: 'turn-complete' }]);
  });
});
