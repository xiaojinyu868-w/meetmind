import { afterEach, describe, expect, it } from 'vitest';
import { emptyLearnerContext, LEARNER_CONTEXT_VERSION, type LearnerContext } from '@/types/learner-context';
import { formatLearnerContextForPrompt, parseLearnerContext, resolveLearnerContext } from './learner-context-service';

const sample: LearnerContext = {
  ...emptyLearnerContext('local'),
  mastery: [
    { concept: 'up in the air 是什么意思', status: 'unstable', lastAt: '2026-09-08T10:00:00Z', steps: [{ appId: 'quiz', positive: false, at: '2026-09-08T10:00:00Z' }], evidence: { startMs: 6000 } },
    { concept: '先验概率', status: 'improving', lastAt: '2026-09-08T10:05:00Z', steps: [{ appId: 'quiz', positive: false, at: '2026-09-08T09:00:00Z' }, { appId: 'flashcards', positive: true, at: '2026-09-08T10:05:00Z' }] },
    { concept: '样本空间', status: 'stable', lastAt: '2026-09-08T10:06:00Z' },
  ],
  recentLessons: [{ title: '概率论 · 9-5', at: '2026-09-05T08:00:00Z' }],
  challenges: [{ title: '条件概率的方向', evidenceIds: ['m3'] }],
  topics: ['概率论'],
  preferences: [],
  goals: [],
  evidenceIds: ['m3'],
};

describe('formatLearnerContextForPrompt', () => {
  it('只写事实，顺序是还没稳 → 刚记住 → 已经稳 → 困惑 → 最近 → 在学', () => {
    const text = formatLearnerContextForPrompt(sample);
    const order = ['还没稳', '刚记住', '已经稳了', '还没过去的困惑', '最近学过', '在学'].map((k) => text.indexOf(k));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text).toContain('quiz✕ → flashcards✓');
    expect(text).toContain('原话在 0:06');
  });
  it('空切片返回空串；超预算截断', () => {
    expect(formatLearnerContextForPrompt(emptyLearnerContext())).toBe('');
    const huge: LearnerContext = { ...sample, mastery: Array.from({ length: 40 }, (_, i) => ({ concept: `概念${i}`.padEnd(40, '长'), status: 'unstable' as const, lastAt: '2026-09-08T10:00:00Z' })) };
    expect(formatLearnerContextForPrompt(huge).length).toBeLessThanOrEqual(600);
  });
});

describe('resolveLearnerContext', () => {
  const env = process.env.CONTEXT_SYSTEM_URL;
  afterEach(() => { if (env === undefined) delete process.env.CONTEXT_SYSTEM_URL; else process.env.CONTEXT_SYSTEM_URL = env; });

  it('远端未配置：用请求方的本机切片；切片不合法就给空切片', async () => {
    delete process.env.CONTEXT_SYSTEM_URL;
    const req = { v: LEARNER_CONTEXT_VERSION, appId: 'quiz', need: ['mastery' as const] };
    const got = await resolveLearnerContext({ request: req, local: sample });
    expect(got.source).toBe('local');
    expect(got.mastery).toHaveLength(3);
    const bad = await resolveLearnerContext({ request: req, local: { v: 99, mastery: 'nope' } });
    expect(bad.mastery).toEqual([]);
  });

  it('远端配置了但不可达：静默回落到本机切片', async () => {
    process.env.CONTEXT_SYSTEM_URL = 'http://127.0.0.1:9';
    const got = await resolveLearnerContext({ request: { v: LEARNER_CONTEXT_VERSION, appId: 'quiz', learnerId: 'u1', need: ['mastery'] }, local: sample });
    expect(got.source).toBe('local');
    expect(got.mastery[0].concept).toContain('up in the air');
  });

  it('parseLearnerContext 只认当前版本', () => {
    expect(parseLearnerContext(sample)?.v).toBe(LEARNER_CONTEXT_VERSION);
    expect(parseLearnerContext({ ...sample, v: 2 })).toBeNull();
  });
});
