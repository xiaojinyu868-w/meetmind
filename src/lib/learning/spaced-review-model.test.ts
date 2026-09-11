import { describe, expect, it } from 'vitest';
import { DAY_MS, describeReviewEntry, historyFromSteps, planReview, scheduleFromSteps } from './spaced-review-model';

const T0 = Date.UTC(2026, 8, 1, 20, 0, 0); // 9-1 晚上
const day = (n: number) => T0 + n * DAY_MS;
const hour = (n: number) => n * 60 * 60 * 1000;

describe('scheduleFromSteps：SM-2 思路的轻到期模型', () => {
  it('没记住 → 明天到期；记住 → 第一次 1 天，之后翻倍', () => {
    expect(scheduleFromSteps([{ positive: false, at: T0 }])).toMatchObject({ intervalDays: 1, dueAt: day(1), streak: 0, lapses: 1, lastPositive: false });
    const got1 = scheduleFromSteps([{ positive: true, at: T0 }]);
    expect(got1).toMatchObject({ intervalDays: 1, dueAt: day(1), streak: 1 });
    const got3 = scheduleFromSteps([{ positive: true, at: T0 }, { positive: true, at: day(1) }, { positive: true, at: day(3) }]);
    expect(got3).toMatchObject({ intervalDays: 4, dueAt: day(3) + 4 * DAY_MS, streak: 3, lapses: 0 });
  });

  it('忘一次间隔回到 1 天、连续数归零；之后再记住从 1 天重新翻倍', () => {
    const schedule = scheduleFromSteps([
      { positive: true, at: T0 },
      { positive: true, at: day(1) },
      { positive: false, at: day(3) },
      { positive: true, at: day(4) },
      { positive: true, at: day(5) },
    ]);
    expect(schedule).toMatchObject({ intervalDays: 2, streak: 2, lapses: 1, lastPositive: true, dueAt: day(5) + 2 * DAY_MS });
  });

  it('同一坐里"没记住的再来一遍"补上的那一次不把间隔翻倍', () => {
    const schedule = scheduleFromSteps([
      { positive: true, at: T0 },
      { positive: true, at: day(2) },
      { positive: true, at: day(2) + hour(1) }, // 同一坐再对一次
    ]);
    expect(schedule).toMatchObject({ intervalDays: 2, streak: 2, lastAt: day(2) + hour(1) });
    // 同一坐里先错再对：错把间隔清到 1 天，紧接着的对是 streak 0 → 1，仍是 1 天（不是翻倍）
    const relearned = scheduleFromSteps([{ positive: false, at: T0 }, { positive: true, at: T0 + hour(0.2) }]);
    expect(relearned).toMatchObject({ intervalDays: 1, streak: 1, lapses: 1, lastPositive: true });
  });

  it('间隔有上限；乱序输入按时间排；空历史返回 null', () => {
    const steps = Array.from({ length: 12 }, (_, i) => ({ positive: true, at: day(i * 70) }));
    expect(scheduleFromSteps(steps)?.intervalDays).toBe(60);
    const shuffled = scheduleFromSteps([{ positive: true, at: day(1) }, { positive: false, at: T0 }]);
    expect(shuffled).toMatchObject({ lastPositive: true, streak: 1, lapses: 1 });
    expect(scheduleFromSteps([])).toBeNull();
  });
});

describe('planReview / describeReviewEntry：一叠卡的复习顺序与进入态那一句', () => {
  const cards = [
    { id: 'c1', front: '为什么单射才有逆映射？' },
    { id: 'c2', front: '老师拿哪个例子说明机会成本？' },
    { id: 'c3', front: '$f\\circ g$ 的定义域是什么？' },
    { id: 'c4', front: '值域和陪域差在哪？' },
    { id: 'c5', front: '新卡，没检验过' },
  ];

  it('到期的（没记住的在前）→ 上次没记住还没到期 → 新卡 → 记住了还没到期', () => {
    const history = historyFromSteps([
      { concept: '为什么单射才有逆映射？', steps: [{ positive: true, at: day(0) }, { positive: true, at: day(1) }] }, // 间隔 2 天，day(3) 到期
      { concept: '老师拿哪个例子说明机会成本？', steps: [{ positive: false, at: day(2) }] }, // day(3) 到期，没记住
      { concept: ' $f\\circ g$ 的定义域是什么？ ', steps: [{ positive: false, at: day(3) - hour(1) }] }, // 刚没记住，明天才到期
      { concept: '值域和陪域差在哪？', steps: [{ positive: true, at: day(3) - hour(2) }] }, // 刚记住，明天到期
    ]);
    const plan = planReview(cards, history, day(3));
    expect(plan.due).toEqual(['c2', 'c1']);
    expect(plan.lapsed).toEqual(['c3']);
    expect(plan.fresh).toEqual(['c5']);
    expect(plan.later).toEqual(['c4']);
    expect(plan.order).toEqual(['c2', 'c1', 'c3', 'c5', 'c4']);
    expect(describeReviewEntry(plan)).toEqual({ kind: 'due', count: 2 });
  });

  it('到期的全是上次没记住的 → 「上次没记住的 N 张先来」；只有没到期的没记住卡也这么说；全新卡不说话', () => {
    const missedOnly = planReview(cards, historyFromSteps([
      { concept: '为什么单射才有逆映射？', steps: [{ positive: false, at: day(0) }] },
      { concept: '老师拿哪个例子说明机会成本？', steps: [{ positive: false, at: day(0) }] },
    ]), day(1));
    expect(describeReviewEntry(missedOnly)).toEqual({ kind: 'missed', count: 2 });

    const lapsedOnly = planReview(cards, historyFromSteps([
      { concept: '为什么单射才有逆映射？', steps: [{ positive: false, at: day(0) }] },
    ]), day(0) + hour(1));
    expect(lapsedOnly.due).toEqual([]);
    expect(describeReviewEntry(lapsedOnly)).toEqual({ kind: 'missed', count: 1 });

    expect(describeReviewEntry(planReview(cards, new Map(), day(0)))).toBeNull();
  });

  it('概念键按原文归一：多余空白与大小写不影响匹配', () => {
    const history = historyFromSteps([{ concept: '  新卡，没检验过 ', steps: [{ positive: true, at: day(0) }] }]);
    const plan = planReview(cards, history, day(2));
    expect(plan.due).toEqual(['c5']);
  });
});
