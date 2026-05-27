/**
 * composeFirstHello 单元测试
 *
 * 覆盖 8 个情境分支：
 *   1. isRecording=true → null
 *   2. 空数组 → null（没有课堂上下文时同桌不主动出现）
 *   3. 有 processing → 强调"刚那节在整理"
 *   4. 今天 upcoming → 预报今天
 *   5. 今天 ready → 今天刚录完
 *   6. 昨天 ready → 召唤复习
 *   7. 3 天内 ready → 前阵子
 *   8. 非今天 upcoming 兜底
 */

import { describe, it, expect } from 'vitest';
import { composeFirstHello } from './composeFirstHello';
import type { Lesson } from './types';

const TODAY = '2026-04-17';
const YESTERDAY = '2026-04-16';
const THREE_DAYS_AGO = '2026-04-14';
const TEN_DAYS_AGO = '2026-04-07';

function lesson(partial: Partial<Lesson> & { id: string; status: Lesson['status'] }): Lesson {
  return {
    title: 'Test Lesson',
    date: TODAY,
    time: '10:00',
    hasEcho: false,
    reviewed: false,
    ...partial,
  };
}

describe('composeFirstHello', () => {
  it('录课中时不说话（返回 null）', () => {
    const result = composeFirstHello({
      lessons: [lesson({ id: '1', status: 'ready' })],
      today: TODAY,
      isRecording: true,
    });
    expect(result).toBeNull();
  });

  it('完全没数据时不主动说话，避免没有上下文也展示同桌', () => {
    const result = composeFirstHello({ lessons: [], today: TODAY });
    expect(result).toBeNull();
  });

  it('有 processing 时优先强调"刚那节还在整理"', () => {
    const lessons = [
      lesson({ id: '1', status: 'ready', title: '微积分', date: YESTERDAY }),
      lesson({ id: '2', status: 'processing', title: '线性代数', date: TODAY }),
    ];
    const result = composeFirstHello({ lessons, today: TODAY });
    expect(result).toContain('线性代数');
    expect(result).toContain('在整理');
  });

  it('今天有 upcoming 时预报时间', () => {
    const lessons = [
      lesson({ id: '1', status: 'upcoming', title: '物理', date: TODAY, time: '14:00' }),
    ];
    const result = composeFirstHello({ lessons, today: TODAY });
    expect(result).toContain('14:00');
    expect(result).toContain('物理');
  });

  it('今天多节 upcoming 时选最早那节', () => {
    const lessons = [
      lesson({ id: '1', status: 'upcoming', title: '下午物理', date: TODAY, time: '15:00' }),
      lesson({ id: '2', status: 'upcoming', title: '早上数学', date: TODAY, time: '09:00' }),
    ];
    const result = composeFirstHello({ lessons, today: TODAY });
    expect(result).toContain('早上数学');
    expect(result).toContain('09:00');
  });

  it('今天有 ready 时说"今天那节"', () => {
    const lessons = [
      lesson({ id: '1', status: 'ready', title: '经济学', date: TODAY }),
    ];
    const result = composeFirstHello({ lessons, today: TODAY });
    expect(result).toContain('今天那节');
    expect(result).toContain('经济学');
  });

  it('昨天有 ready 时召唤复习', () => {
    const lessons = [
      lesson({ id: '1', status: 'ready', title: '傅里叶', date: YESTERDAY }),
    ];
    const result = composeFirstHello({ lessons, today: TODAY });
    expect(result).toContain('昨天那节');
    expect(result).toContain('傅里叶');
    expect(result).toContain('再过一遍');
  });

  it('3 天内的 ready 说"前阵子"', () => {
    const lessons = [
      lesson({ id: '1', status: 'ready', title: '概率论', date: THREE_DAYS_AGO }),
    ];
    const result = composeFirstHello({ lessons, today: TODAY });
    expect(result).toContain('前阵子');
    expect(result).toContain('概率论');
  });

  it('超过 3 天的 ready 说"好久没见"', () => {
    const lessons = [
      lesson({ id: '1', status: 'ready', title: '很久前的课', date: TEN_DAYS_AGO }),
    ];
    const result = composeFirstHello({ lessons, today: TODAY });
    expect(result).toContain('好久没见');
  });

  it('只有非今天的 upcoming 兜底', () => {
    const lessons = [
      lesson({ id: '1', status: 'upcoming', title: '下周的课', date: '2026-04-24' }),
    ];
    const result = composeFirstHello({ lessons, today: TODAY });
    expect(result).toContain('下周的课');
  });

  it('长标题会被截短', () => {
    const lessons = [
      lesson({
        id: '1',
        status: 'ready',
        title: '这是一个超级超级超级超级长的课程名字',
        date: YESTERDAY,
      }),
    ];
    const result = composeFirstHello({ lessons, today: TODAY });
    expect(result).toContain('…');
    expect(result!.length).toBeLessThan(60);
  });

  it('优先级：processing > today upcoming > today ready > yesterday ready', () => {
    const all = [
      lesson({ id: 'r', status: 'ready', title: 'R', date: YESTERDAY }),
      lesson({ id: 't', status: 'ready', title: 'T', date: TODAY }),
      lesson({ id: 'u', status: 'upcoming', title: 'U', date: TODAY, time: '15:00' }),
      lesson({ id: 'p', status: 'processing', title: 'P', date: TODAY }),
    ];
    const result = composeFirstHello({ lessons: all, today: TODAY });
    expect(result).toContain('P');
    expect(result).not.toContain('U');
    expect(result).not.toContain('T');
  });
});
