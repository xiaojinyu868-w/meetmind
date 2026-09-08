import { describe, expect, it } from 'vitest';
import type { StoredAssessment } from '@/components/apps/review-session-outcomes';
import type { LearningActivityEntry, LearningMemoryEntry } from '@/types/user';
import { buildLearnerContextRequest, buildLocalLearnerContext } from './learner-context-local';

const t = (n: number) => 1_700_000_000_000 + n * 60_000;
const outcomes: StoredAssessment[] = [
  { appKey: 'quiz', at: t(0), items: [{ concept: '归一化', outcome: 'wrong', evidence: { startMs: 40_000 } }, { concept: '先验', outcome: 'correct' }] },
  { appKey: 'flashcards', at: t(5), items: [{ concept: '归一化', outcome: 'got' }, { concept: '先验', outcome: 'got' }] },
];
const activities: LearningActivityEntry[] = [
  { id: 'a1', kind: 'lesson', title: '概率论 · 9-1', occurredAt: '2026-09-01T08:00:00Z', sessionId: 's1' },
  { id: 'a2', kind: 'lesson', title: '当前这节', occurredAt: '2026-09-08T08:00:00Z', sessionId: 'now' },
  { id: 'a3', kind: 'conversation', title: '随手一问', occurredAt: '2026-09-08T09:00:00Z' },
];
const mem = (id: string, kind: LearningMemoryEntry['kind'], title: string, status: LearningMemoryEntry['status'] = 'active'): LearningMemoryEntry => ({
  id, kind, title, status, source: 'user', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
});

describe('buildLocalLearnerContext', () => {
  it('掌握状态来自本机检验结果，还没稳的排前；证据带回原话时间', () => {
    const ctx = buildLocalLearnerContext({ appId: 'quiz', sessionId: 'now', outcomes, activities: [], memories: [] });
    expect(ctx.source).toBe('local');
    expect(ctx.mastery.map((m) => `${m.concept}:${m.status}`)).toEqual(['归一化:improving', '先验:stable']);
    expect(ctx.mastery[0].evidence?.startMs).toBe(40_000);
    expect(ctx.mastery[0].steps?.map((s) => `${s.appId}${s.positive ? '+' : '-'}`)).toEqual(['quiz-', 'flashcards+']);
  });
  it('最近学过排除当前课与非课堂活动；长期理解按 kind 分流，暂停的不进', () => {
    const ctx = buildLocalLearnerContext({
      appId: 'flashcards', sessionId: 'now', outcomes: [], activities,
      memories: [mem('m1', 'challenge', '条件概率的方向'), mem('m2', 'topic', '概率论'), mem('m3', 'preference', '先看例子'), mem('m4', 'progress', '期中前过完前四章'), mem('m5', 'challenge', '已暂停的', 'paused')],
    });
    expect(ctx.recentLessons.map((l) => l.title)).toEqual(['概率论 · 9-1']);
    expect(ctx.challenges.map((c) => c.title)).toEqual(['条件概率的方向']);
    expect(ctx.topics).toEqual(['概率论']);
    expect(ctx.preferences).toEqual(['先看例子']);
    expect(ctx.goals).toEqual(['期中前过完前四章']);
    expect(ctx.evidenceIds).toContain('m1');
  });
  it('请求声明这次任务要什么', () => {
    const req = buildLearnerContextRequest({ appId: 'quiz', sessionId: 'now' });
    expect(req.need).toContain('mastery');
    expect(req.appId).toBe('quiz');
  });
});
