import { describe, expect, it } from 'vitest';
import type { StoredAssessment } from '@/components/apps/review-session-outcomes';
import { buildMasteryTrail } from './mastery-trail';

const t = (n: number) => 1_700_000_000_000 + n * 60_000;

const quiz: StoredAssessment = {
  appKey: 'quiz', at: t(0),
  items: [
    { concept: '为什么要归一化', outcome: 'wrong', evidence: { startMs: 40_000 } },
    { concept: '先验概率', outcome: 'correct' },
  ],
};
const flash: StoredAssessment = {
  appKey: 'flashcards', at: t(5),
  items: [
    { concept: '为什么要归一化 ', outcome: 'got' },
    { concept: '先验概率', outcome: 'got' },
    { concept: '后验', outcome: 'missed' },
  ],
};
const teach: StoredAssessment = {
  appKey: 'teach-back', at: t(9),
  items: [
    { concept: '后验', outcome: 'blind-spot' },
    { concept: '样本空间', outcome: 'uncovered' },
  ],
};

describe('buildMasteryTrail', () => {
  it('按概念聚合（原文归一），状态只看事实序列：负→正 = 刚记住，正正 = 已稳，最后负 = 还没稳', () => {
    const trail = buildMasteryTrail([flash, quiz, teach]); // 顺序打乱也按时间排
    const byName = Object.fromEntries(trail.map((e) => [e.concept, e]));
    expect(byName['为什么要归一化'].status).toBe('improving');
    expect(byName['为什么要归一化'].steps.map((s) => `${s.appKey}:${s.outcome}`)).toEqual(['quiz:wrong', 'flashcards:got']);
    expect(byName['为什么要归一化'].evidence).toEqual({ startMs: 40_000 });
    expect(byName['先验概率'].status).toBe('stable');
    expect(byName['后验'].status).toBe('unstable');
    expect(byName['样本空间']).toBeUndefined(); // uncovered 不计
  });

  it('还没稳的排最前，其后按时间倒序；limit 生效', () => {
    const trail = buildMasteryTrail([quiz, flash, teach]);
    expect(trail[0].concept).toBe('后验');
    expect(buildMasteryTrail([quiz, flash, teach], 1)).toHaveLength(1);
  });

  it('只对过一次 = 刚记住（不敢说稳）', () => {
    const once: StoredAssessment = { appKey: 'quiz', at: t(1), items: [{ concept: 'x', outcome: 'correct' }] };
    expect(buildMasteryTrail([once])[0].status).toBe('improving');
  });
});
