import { describe, expect, it } from 'vitest';
import type { AppExecutionResult } from '@/lib/ai-native/types';
import {
  formatQuizEvidenceTime,
  isQuizAnswerCorrect,
  normalizeQuizAnswer,
  normalizeQuizQuestions,
  QUIZ_SELF_CORRECT,
  QUIZ_SELF_WRONG,
  sanitizeQuizExplanation,
  stripQuizOptionPrefix,
} from './quiz-window-model';

function createResult(overrides: Partial<AppExecutionResult> = {}): AppExecutionResult {
  return {
    pluginId: 'quiz-arena',
    version: '1',
    cards: [],
    tasks: [],
    trace: [],
    ...overrides,
  };
}

describe('quiz window model', () => {
  it('normalizes payload questions without losing the original evidence', () => {
    const result = createResult({
      cards: [{
        id: 'question-1',
        type: 'quiz',
        title: '测验 1',
        body: '题面',
        citations: [{ startMs: 93_000, endMs: 98_000, snippet: '课堂依据' }],
      }],
      render: {
        mode: 'quiz',
        payload: {
          questions: [{
            id: 'question-1',
            stem: '工作记忆的作用是什么？',
            type: 'single',
            options: ['A. 临时加工信息', 'B. 永久保存全部信息'],
            answer: 'A',
          }],
        },
      },
    });

    expect(normalizeQuizQuestions(result)[0]).toEqual(expect.objectContaining({
      id: 'question-1',
      evidence: { startMs: 93_000, snippet: '课堂依据' },
    }));
  });

  it('accepts grounded subjective questions and rejects empty objective questions', () => {
    const result = createResult({
      cards: [
        {
          id: 'subjective',
          type: 'quiz',
          title: '简答',
          body: '请复述核心观点',
          meta: { cardKind: 'quiz', type: 'short', answer: '核心观点' },
        },
        {
          id: 'broken',
          type: 'quiz',
          title: '无效题',
          body: '缺少选项',
          meta: { cardKind: 'quiz', type: 'single', answer: 'A' },
        },
      ],
    });

    expect(normalizeQuizQuestions(result).map((question) => question.id)).toEqual(['subjective']);
  });

  it('matches letter, prefixed and subjective answers consistently', () => {
    const objective = {
      id: 'objective',
      stem: '题目',
      type: 'single',
      options: ['A. 第一项', 'B. 第二项'],
      answer: 'B',
    };
    const subjective = { ...objective, id: 'subjective', type: 'short', options: [] };

    expect(normalizeQuizAnswer('B', objective.options)).toBe('B. 第二项');
    expect(stripQuizOptionPrefix('B. 第二项')).toBe('第二项');
    expect(isQuizAnswerCorrect(objective, 'B. 第二项')).toBe(true);
    expect(isQuizAnswerCorrect(subjective, QUIZ_SELF_CORRECT)).toBe(true);
    expect(isQuizAnswerCorrect(subjective, QUIZ_SELF_WRONG)).toBe(false);
    expect(formatQuizEvidenceTime(93_000)).toBe('1:33');
  });

  it('removes internal segment ids from learner-facing explanations', () => {
    expect(sanitizeQuizExplanation('段002中女士提出问题，结合段003中男士的回答以及段004里的例子。'))
      .toBe('课堂原文中女士提出问题，结合原文里男士的回答原文中的例子。');
  });
});
