import { describe, expect, it } from 'vitest';
import type { Anchor, TranscriptSegment } from '@/types';
import type { LearningAssessmentDraft } from '@/types/learning-event';
import {
  LEARNING_PATH,
  buildOutcomeAnchors,
  formatLessonMeta,
  formatOutcomeLine,
  recommendNextStep,
  summarizeSessionOutcomes,
} from './lesson-path-model';

const transcript: TranscriptSegment[] = Array.from({ length: 30 }, (_, i) => ({
  id: `s${i}`,
  text: `段落 ${i}`,
  startMs: i * 10_000,
  endMs: i * 10_000 + 9_000,
  confidence: 0.9,
  isFinal: true,
})) as TranscriptSegment[];

const anchor = (timestamp: number, resolved = false): Anchor => ({
  id: `a-${timestamp}`, sessionId: 's', studentId: 'me', timestamp, type: 'confusion', cancelled: false, resolved, createdAt: '',
});

const quizDraft: LearningAssessmentDraft = {
  appKey: 'quiz',
  items: [
    { concept: '先验概率是什么', outcome: 'correct', evidence: { startMs: 12_000 } },
    { concept: '为什么要归一化', outcome: 'wrong', evidence: { startMs: 40_000 } },
    { concept: '贝叶斯定理的分母', outcome: 'wrong' },
  ],
};
const flashDraft: LearningAssessmentDraft = {
  appKey: 'flashcards',
  items: [
    { concept: '先验', outcome: 'got' },
    { concept: '后验', outcome: 'missed', evidence: { startMs: 50_000 } },
  ],
};
const teachDraft: LearningAssessmentDraft = {
  appKey: 'teach-back',
  items: [
    { concept: '为什么要归一化', outcome: 'mastery' },
    { concept: '分母的含义', outcome: 'blind-spot' },
    { concept: '先验从哪来', outcome: 'uncovered' },
  ],
};

const allowed = new Set(LEARNING_PATH.concat(['mindmap']));

describe('summarizeSessionOutcomes / formatOutcomeLine', () => {
  it('每个应用取最近一次，结果摘要用学生能核对的数字', () => {
    const summary = summarizeSessionOutcomes([
      { appKey: 'quiz', items: [{ concept: '旧', outcome: 'wrong' }] },
      quizDraft, flashDraft, teachDraft,
    ]);
    expect(summary.quiz).toMatchObject({ total: 3, correct: 1 });
    expect(summary.quiz?.wrongConcepts.map((i) => i.concept)).toEqual(['为什么要归一化', '贝叶斯定理的分母']);
    expect(formatOutcomeLine('quiz', summary)).toBe('3 题对 1');
    expect(formatOutcomeLine('flashcards', summary)).toBe('2 张记住 1');
    expect(formatOutcomeLine('teach-back', summary)).toBe('讲透 1 个 · 1 个还没讲清');
    expect(formatOutcomeLine('infographic', summary)).toBeUndefined();
  });
});

describe('recommendNextStep', () => {
  it('还没开始：有标记 → 先检验，理由点名标记时刻', () => {
    const rec = recommendNextStep({
      anchors: [anchor(17_000), anchor(30_000), anchor(90_000, true)],
      transcript, outcomes: {}, generated: new Set(), allowed,
    });
    expect(rec.key).toBe('quiz');
    expect(rec.reason).toContain('0:17、0:30');
    expect(rec.completed).toBe(false);
  });

  it('没有标记但有难点 → 先记住；都没有且内容长 → 先看结构', () => {
    expect(recommendNextStep({ anchors: [], keyDifficulties: ['归一化', '先验'], transcript, outcomes: {}, generated: new Set(), allowed }).key).toBe('flashcards');
    expect(recommendNextStep({ anchors: [], transcript, outcomes: {}, generated: new Set(), allowed }).key).toBe('mindmap');
  });

  it('上一步的结果决定下一步：测验错了 → 记住；闪卡没记住 → 讲出来；讲完 → 带走；四步齐 → 走完', () => {
    const afterQuiz = recommendNextStep({ anchors: [], transcript, outcomes: summarizeSessionOutcomes([quizDraft]), generated: new Set(['quiz']), allowed });
    expect(afterQuiz.key).toBe('flashcards');
    expect(afterQuiz.reason).toContain('错了 2 处');

    const afterFlash = recommendNextStep({ anchors: [], transcript, outcomes: summarizeSessionOutcomes([quizDraft, flashDraft]), generated: new Set(['quiz', 'flashcards']), allowed });
    expect(afterFlash.key).toBe('teach-back');

    const afterTeach = recommendNextStep({ anchors: [], transcript, outcomes: summarizeSessionOutcomes([quizDraft, flashDraft, teachDraft]), generated: new Set(['quiz', 'flashcards', 'teach-back']), allowed });
    expect(afterTeach.key).toBe('infographic');
    expect(afterTeach.reason).toContain('1 个点还没讲清');

    const done = recommendNextStep({ anchors: [], transcript, outcomes: summarizeSessionOutcomes([quizDraft, flashDraft, teachDraft]), generated: new Set(['quiz', 'flashcards', 'teach-back', 'infographic']), allowed });
    expect(done.completed).toBe(true);
    expect(done.key).toBeNull();
  });

  it('全对的测验直接跳到讲出来', () => {
    const perfect: LearningAssessmentDraft = { appKey: 'quiz', items: [{ concept: 'x', outcome: 'correct' }] };
    const rec = recommendNextStep({ anchors: [], transcript, outcomes: summarizeSessionOutcomes([perfect]), generated: new Set(['quiz']), allowed });
    expect(rec.key).toBe('teach-back');
  });

  it('不在允许集合里的应用不推荐', () => {
    const rec = recommendNextStep({ anchors: [anchor(1000)], transcript, outcomes: {}, generated: new Set(), allowed: new Set(['flashcards']) });
    expect(rec.key).toBe('flashcards');
  });
});

describe('buildOutcomeAnchors', () => {
  it('测验错的点 → 闪卡的困惑锚点（带来源前缀与证据时间），不喂回同一个应用', () => {
    const summary = summarizeSessionOutcomes([quizDraft, flashDraft]);
    const forFlash = buildOutcomeAnchors('s', 'flashcards', summary);
    expect(forFlash.map((a) => a.note)).toEqual(['测验答错：为什么要归一化', '测验答错：贝叶斯定理的分母']);
    expect(forFlash[0]).toMatchObject({ type: 'confusion', resolved: false, cancelled: false, timestamp: 40_000 });

    const forTeach = buildOutcomeAnchors('s', 'teach-back', summary);
    expect(forTeach.map((a) => a.note)).toEqual(['测验答错：为什么要归一化', '测验答错：贝叶斯定理的分母', '闪卡没记住：后验']);
    expect(buildOutcomeAnchors('s', 'mindmap', summary)).toEqual([]);
  });
});

describe('formatLessonMeta', () => {
  it('时长按最后一段取整到分钟，只写有的', () => {
    expect(formatLessonMeta(transcript, [anchor(1000)], 0)).toBe('5 分钟 · 你标记了 1 处');
    expect(formatLessonMeta(transcript, [], 2)).toBe('5 分钟 · 2 个难点');
  });
});
