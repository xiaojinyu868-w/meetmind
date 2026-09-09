import { describe, expect, it } from 'vitest';
import { buildSidebarRecent, relativeDay } from './sidebar-recent-model';

const NOW = new Date('2026-09-09T20:00:00+08:00');

describe('buildSidebarRecent', () => {
  it('最近：按时间倒序、同一节课去重、只念主题、相对日期；超出 6 条给 more', () => {
    const lessons = Array.from({ length: 8 }, (_, i) => ({
      id: `c${i}`,
      title: `课 ${i} · 课程 · 9-${i + 1}`,
      at: new Date(NOW.getTime() - i * 86_400_000).toISOString(),
      sessionId: i === 1 ? 's-dup' : `s${i}`,
    }));
    lessons.push({ id: 'c-dup', title: '课 1 的视频 · 课程 · 9-2', at: lessons[1].at, sessionId: 's-dup' });
    const recent = buildSidebarRecent({ lessons, now: NOW });
    expect(recent.lessons.map((l) => [l.title, l.when])).toEqual([
      ['课 0', '今天'], ['课 1', '昨天'], ['课 2', '9-7'], ['课 3', '9-6'], ['课 4', '9-5'], ['课 5', '9-4'],
    ]);
    expect(recent.more).toBe(2);
    // 没有线索：继续学习 = 上一节
    expect(recent.continueItem).toMatchObject({ kind: 'lesson', title: '课 0', detail: '今天' });
  });

  it('有活着的学习线索时继续学习是线索；正打开的一节不再当"上一节"推', () => {
    const recent = buildSidebarRecent({
      lessons: [{ id: 'a', title: '线性规划 · 运筹学 · 9-5', at: '2026-09-05T08:00:00Z', active: true }],
      activeThread: { id: 't', title: '线性规划：从业务问题到数学建模', intent: 'x', depth: 'deep', status: 'active', nextStep: '先把标准形式写出来', createdAt: '', updatedAt: '' },
      now: NOW,
    });
    expect(recent.continueItem).toMatchObject({ kind: 'thread', detail: '先把标准形式写出来' });
    expect(recent.lessons[0]).toMatchObject({ title: '线性规划', active: true });
    const noThread = buildSidebarRecent({ lessons: [{ id: 'a', title: '线性规划 · 运筹学 · 9-5', at: '2026-09-05T08:00:00Z', active: true }], now: NOW });
    expect(noThread.continueItem).toBeUndefined();
  });

  it('relativeDay：今天 / 昨天 / M-D，坏日期空串', () => {
    expect(relativeDay('2026-09-09T01:00:00+08:00', NOW)).toBe('今天');
    expect(relativeDay('2026-09-08T23:00:00+08:00', NOW)).toBe('昨天');
    expect(relativeDay('2026-08-20T10:00:00+08:00', NOW)).toBe('8-20');
    expect(relativeDay('nope', NOW)).toBe('');
  });
});
