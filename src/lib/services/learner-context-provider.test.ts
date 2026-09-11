import { beforeEach, describe, expect, it, vi } from 'vitest';

const findMany = vi.fn();
const findUnique = vi.fn();
vi.mock('@/lib/prisma', () => ({ default: { learningEvent: { findMany: (...a: unknown[]) => findMany(...a) }, user: { findUnique: (...a: unknown[]) => findUnique(...a) } } }));

import { buildLearnerContextFromStore } from './learner-context-provider';

const t = (n: number) => new Date(1_700_000_000_000 + n * 60_000);
const ev = (id: string, at: Date, appKey: string, items: unknown[], sessionId = 's1') => ({
  id, occurredAt: at, payloadJson: JSON.stringify({ v: 1, appKey, sessionId, items }),
});

describe('buildLearnerContextFromStore（服务端供给方）', () => {
  beforeEach(() => { findMany.mockReset(); findUnique.mockReset(); });

  it('assessment 事件 → 掌握状态（与客户端同一份规则），证据 id 指回事件', async () => {
    findMany.mockResolvedValue([
      ev('e2', t(5), 'flashcards', [{ concept: '归一化', outcome: 'got' }, { concept: '先验', outcome: 'got' }]),
      ev('e1', t(0), 'quiz', [{ concept: '归一化', outcome: 'wrong', evidence: { startMs: 40_000 } }, { concept: '先验', outcome: 'correct' }]),
    ]);
    findUnique.mockResolvedValue({ learnerProfileJson: JSON.stringify({
      memories: [
        { id: 'm1', kind: 'challenge', title: '条件概率的方向', status: 'active' },
        { id: 'm2', kind: 'topic', title: '概率论', status: 'active' },
        { id: 'm3', kind: 'challenge', title: '暂停的', status: 'paused' },
      ],
      recentLearningActivities: [
        { id: 'a1', kind: 'lesson', title: '概率论 · 9-1', occurredAt: '2026-09-01T08:00:00Z', sessionId: 's0' },
        { id: 'a2', kind: 'lesson', title: '当前课', occurredAt: '2026-09-08T08:00:00Z', sessionId: 's1' },
      ],
    }) });
    const ctx = await buildLearnerContextFromStore({ v: 1, appId: 'quiz', learnerId: 'u1', sessionId: 's1', need: ['mastery', 'recent', 'challenges', 'topics'] });
    expect(ctx.source).toBe('server');
    expect(ctx.mastery.map((m) => `${m.concept}:${m.status}`)).toEqual(['归一化:improving', '先验:stable']);
    expect(ctx.mastery[0].evidence?.startMs).toBe(40_000);
    expect(ctx.mastery[0].evidenceIds).toEqual(['e2']);
    expect(ctx.recentLessons.map((l) => l.title)).toEqual(['概率论 · 9-1']);
    expect(ctx.challenges.map((c) => c.title)).toEqual(['条件概率的方向']);
    expect(ctx.topics).toEqual(['概率论']);
    expect(ctx.evidenceIds).toContain('m1');
  });

  it('没有 learnerId 直接空切片，不碰数据库；坏 JSON 事件被跳过', async () => {
    const none = await buildLearnerContextFromStore({ v: 1, appId: 'quiz', need: ['mastery'] });
    expect(none.mastery).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
    findMany.mockResolvedValue([{ id: 'bad', occurredAt: t(0), payloadJson: '{not json' }]);
    findUnique.mockResolvedValue(null);
    const ctx = await buildLearnerContextFromStore({ v: 1, appId: 'quiz', learnerId: 'u1', need: ['mastery'] });
    expect(ctx.mastery).toEqual([]);
  });
});

describe('selectMasteryEntries（2026-09-11：点名的概念不占 limit，其余 状态 → 本课 → 最近）', () => {
  it('concepts 点名的全部保留；其余还没稳在前、同状态本课优先、再按时间', async () => {
    findMany.mockResolvedValue([
      ev('e1', t(0), 'flashcards', [{ concept: '别的课·稳', outcome: 'got' }, { concept: '别的课·稳', outcome: 'got' }], 'other'),
      ev('e2', t(1), 'quiz', [{ concept: '别的课·不稳', outcome: 'wrong' }], 'other'),
      ev('e3', t(2), 'quiz', [{ concept: '本课·不稳', outcome: 'wrong' }, { concept: '本课·稳', outcome: 'correct' }], 's1'),
      ev('e4', t(3), 'flashcards', [{ concept: '本课·稳', outcome: 'got' }, { concept: '被点名的卡', outcome: 'got' }], 's1'),
    ]);
    findUnique.mockResolvedValue({ learnerProfileJson: null });
    const ctx = await buildLearnerContextFromStore({ v: 1, appId: 'flashcards', learnerId: 'u1', sessionId: 's1', need: ['mastery'], limit: 2, concepts: ['被点名的卡'] });
    // 点名的先（不占 limit=2），然后 不稳（本课 → 别的课），limit 截断掉两条稳的
    expect(ctx.mastery.map((m) => m.concept)).toEqual(['被点名的卡', '本课·不稳', '别的课·不稳']);
    expect(ctx.mastery[1].evidence?.sessionId).toBe('s1');
  });
});
