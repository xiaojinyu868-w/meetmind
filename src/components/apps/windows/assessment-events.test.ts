import { describe, expect, it } from 'vitest';
import type { TeachBackEvaluationItem } from '@/lib/ai-native/types';
import {
  buildFlashcardsAssessment,
  buildQuizAssessment,
  buildTeachBackAssessment,
} from './assessment-events';
import type { QuizQuestion } from './quiz-window-model';
import { QUIZ_SELF_CORRECT, QUIZ_SELF_WRONG } from './quiz-window-model';
import type { FlashcardItem } from './flashcards-window-model';

const quiz: QuizQuestion[] = [
  { id: 'q1', stem: '  什么是   梯度下降？ ', type: 'single', options: ['A. 一种优化算法', 'B. 一种激活函数'], answer: 'A', evidence: { startMs: 12000 } },
  { id: 'q2', stem: '学习率越大收敛越快，对吗？', type: 'judge', options: ['对', '错'], answer: '错' },
  { id: 'q3', stem: '用一句话解释过拟合', type: 'short', options: [], answer: '模型记住了训练集噪声' },
  { id: 'q4', stem: '没提交的题', type: 'single', options: ['A. x', 'B. y'], answer: 'A' },
];

describe('buildQuizAssessment', () => {
  it('只收已提交的题，对错按判定函数，主观题按自评，题面压成一行', () => {
    const draft = buildQuizAssessment(
      quiz,
      { q1: 'A. 一种优化算法', q2: '对', q3: QUIZ_SELF_CORRECT },
      { q1: true, q2: true, q3: true },
    );
    expect(draft?.appKey).toBe('quiz');
    expect(draft?.items).toEqual([
      { concept: '什么是 梯度下降？', outcome: 'correct', evidence: { startMs: 12000 } },
      { concept: '学习率越大收敛越快，对吗？', outcome: 'wrong', evidence: undefined },
      { concept: '用一句话解释过拟合', outcome: 'correct', evidence: undefined },
    ]);
  });

  it('主观题自评错误计为 wrong；没有已提交的题返回 null', () => {
    const draft = buildQuizAssessment(quiz, { q3: QUIZ_SELF_WRONG }, { q3: true });
    expect(draft?.items[0].outcome).toBe('wrong');
    expect(buildQuizAssessment(quiz, {}, {})).toBeNull();
  });
});

describe('buildFlashcardsAssessment', () => {
  const cards: FlashcardItem[] = [
    { id: 'c1', front: '贝叶斯定理', back: '…', evidence: { startMs: 3000.6 } },
    { id: 'c2', front: '先验与后验', back: '…' },
    { id: 'c3', front: '没打分的卡', back: '…' },
  ];

  it('got / missed 原样进事件，证据毫秒取整，未打分的卡不进', () => {
    const draft = buildFlashcardsAssessment(cards, { c1: 'got', c2: 'missed' });
    expect(draft).toEqual({
      appKey: 'flashcards',
      items: [
        { concept: '贝叶斯定理', outcome: 'got', evidence: { startMs: 3001 } },
        { concept: '先验与后验', outcome: 'missed', evidence: undefined },
      ],
    });
  });
});

describe('buildTeachBackAssessment', () => {
  it('每个目标点一条，象限缺失按 uncovered，证据带 endMs', () => {
    const items: TeachBackEvaluationItem[] = [
      { targetId: 't1', point: '为什么要归一化', coverage: 'covered', confidence: 'high', quadrant: 'mastery', note: '', evidence: { startMs: 1000, endMs: 4000, snippet: '' } },
      { targetId: 't2', point: '批归一化和层归一化的区别', coverage: 'missing', confidence: 'low', quadrant: null, note: '', evidence: null },
    ] as TeachBackEvaluationItem[];
    const draft = buildTeachBackAssessment(items);
    expect(draft).toEqual({
      appKey: 'teach-back',
      items: [
        { concept: '为什么要归一化', outcome: 'mastery', evidence: { startMs: 1000, endMs: 4000 } },
        { concept: '批归一化和层归一化的区别', outcome: 'uncovered', evidence: undefined },
      ],
    });
  });
});
