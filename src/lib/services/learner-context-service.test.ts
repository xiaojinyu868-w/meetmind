import { describe, expect, it, vi } from 'vitest';
import { emptyLearnerContext, LEARNER_CONTEXT_VERSION, type LearnerContext } from '@/types/learner-context';
import { formatLearnerContextForPrompt, parseLearnerContext, resolveLearnerContext } from './learner-context-service';

// 理解半走 Context 服务（Hindsight）；这里只测编排：记录调用、按 userId 返回固定证据
const understandingCalls: Array<{ userId: string; task: string }> = [];
vi.mock('@/lib/services/context/learner-understanding', () => ({
  prepareLearnerUnderstanding: vi.fn(async (input: { userId: string; task: string }) => {
    understandingCalls.push({ userId: input.userId, task: input.task });
    if (input.userId !== 'u-with-memory') return null;
    return { text: JSON.stringify({ memories: [{ text: '曾把 P(A|B) 与 P(B|A) 搞反，复习时自己讲对了一次', sources: ['ev-1'] }] }), sources: [{ id: 'ev-1', appId: 'meetmind', occurredAt: '2026-09-08T10:00:00Z' }], degraded: false };
  }),
}));

// 服务端事件表供给方走 prisma；这里只测编排，供给方由 learner-context-provider.test.ts 单独测
vi.mock('@/lib/services/learner-context-provider', () => ({
  buildLearnerContextFromStore: vi.fn(async (request: { learnerId?: string }) => ({
    ...emptyLearnerContext('server', request.learnerId),
    ...(request.learnerId === 'u-with-server-data'
      ? { mastery: [{ concept: '服务端记得的概念', status: 'unstable' as const, lastAt: '2026-09-08T10:00:00Z' }] }
      : {}),
  })),
}));

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
  it('访客：用请求方的本机切片；切片不合法就给空切片；不问理解半', async () => {
    const req = { v: LEARNER_CONTEXT_VERSION, appId: 'quiz', need: ['mastery' as const] };
    const got = await resolveLearnerContext({ request: req, local: sample });
    expect(got.source).toBe('local');
    expect(got.mastery).toHaveLength(3);
    expect(got.understanding).toBeUndefined();
    const bad = await resolveLearnerContext({ request: req, local: { v: 99, mastery: 'nope' } });
    expect(bad.mastery).toEqual([]);
  });

  it('登录用户但服务端事件表为空：回落本机切片（刚做完的一轮可能还没写进表）', async () => {
    const got = await resolveLearnerContext({ request: { v: LEARNER_CONTEXT_VERSION, appId: 'quiz', learnerId: 'u1', need: ['mastery'] }, local: sample });
    expect(got.source).toBe('local');
    expect(got.mastery[0].concept).toContain('up in the air');
  });

  it('登录用户：服务端事件表有数据就优先用它（换设备也在）', async () => {
    const got = await resolveLearnerContext({ request: { v: LEARNER_CONTEXT_VERSION, appId: 'quiz', learnerId: 'u-with-server-data', need: ['mastery'] }, local: sample });
    expect(got.source).toBe('server');
    expect(got.mastery[0].concept).toBe('服务端记得的概念');
  });

  it('Context 开启：理解半按任务召回并挂在切片上，prompt 段落带来源说明；task 缺省用 appId + concepts', async () => {
    const got = await resolveLearnerContext({ request: { v: LEARNER_CONTEXT_VERSION, appId: 'quiz', learnerId: 'u-with-memory', need: ['mastery'], concepts: ['贝叶斯'], task: '出一组关于条件概率的题' }, local: sample });
    expect(got.understanding?.text).toContain('P(A|B)');
    expect(understandingCalls.at(-1)).toMatchObject({ userId: 'u-with-memory', task: '出一组关于条件概率的题' });
    const text = formatLearnerContextForPrompt(got);
    expect(text).toContain('跨应用记忆');
    expect(text).toContain('P(A|B)');
    await resolveLearnerContext({ request: { v: LEARNER_CONTEXT_VERSION, appId: 'quiz', learnerId: 'u-with-memory', need: ['mastery'], concepts: ['贝叶斯'] } });
    expect(understandingCalls.at(-1)?.task).toBe('quiz 贝叶斯');
  });

  it('parseLearnerContext 只认当前版本', () => {
    expect(parseLearnerContext(sample)?.v).toBe(LEARNER_CONTEXT_VERSION);
    expect(parseLearnerContext({ ...sample, v: 2 })).toBeNull();
  });
});

describe('formatLearnerContextForPrompt · 本课标记与预算（2026-09-11）', () => {
  it('传 sessionId 时证据落在这节课的概念标「本课」；预算 1000 字', () => {
    const marked: LearnerContext = {
      ...emptyLearnerContext('server'),
      mastery: [
        { concept: '为什么只有单射才有逆映射？', status: 'unstable', lastAt: '2026-09-09T10:00:00Z', evidence: { sessionId: 'lesson-1', startMs: 1_151_000 } },
        { concept: '贝叶斯公式的分母是什么', status: 'unstable', lastAt: '2026-09-08T10:00:00Z', evidence: { sessionId: 'lesson-0', startMs: 6_000 } },
        { concept: '映射的定义', status: 'stable', lastAt: '2026-09-09T10:00:00Z', evidence: { sessionId: 'lesson-1', startMs: 918_000 } },
      ],
    };
    const text = formatLearnerContextForPrompt(marked, { sessionId: 'lesson-1' });
    expect(text).toContain('「本课」为什么只有单射才有逆映射？');
    expect(text).not.toContain('「本课」贝叶斯');
    expect(text).toContain('已经稳了：「本课」映射的定义');
    expect(formatLearnerContextForPrompt(marked)).not.toContain('「本课」');
    const huge: LearnerContext = { ...marked, mastery: Array.from({ length: 40 }, (_, i) => ({ concept: `概念${i}`.padEnd(40, '长'), status: (i % 3 === 0 ? 'unstable' : i % 3 === 1 ? 'improving' : 'stable') as const, lastAt: '2026-09-08T10:00:00Z' })) };
    const long = formatLearnerContextForPrompt(huge);
    expect(long.length).toBeLessThanOrEqual(1000);
    expect(long.length).toBeGreaterThan(600);
  });
});
