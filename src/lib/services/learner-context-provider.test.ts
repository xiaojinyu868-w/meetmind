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
