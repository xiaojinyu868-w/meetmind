import { describe, expect, it } from 'vitest';
import type { LearningIntentPlan } from '@/types/learning-intent';
import { shouldAutoStartLearningIntent } from './useLearningIntentFlow';

function createPlan(overrides: Partial<LearningIntentPlan> = {}): LearningIntentPlan {
  return {
    title: '理解机会成本',
    outcome: '能分析自己的时间选择',
    approach: 'understand',
    contextFocus: 'mixed',
    checkpoints: ['先建立判断框架'],
    confidence: 'high',
    ...overrides,
  };
}

describe('shouldAutoStartLearningIntent', () => {
  it('starts a clear high-confidence intent without another confirmation', () => {
    expect(shouldAutoStartLearningIntent(createPlan())).toBe(true);
  });

  it('keeps meaningful questions in the conversation', () => {
    expect(shouldAutoStartLearningIntent(createPlan({
      questions: [{
        id: 'goal',
        prompt: '你更想解决哪类问题？',
        kind: 'single',
        options: [{ id: 'exam', label: '考试题' }, { id: 'project', label: '项目应用' }],
      }],
    }))).toBe(false);
  });

  it('asks for confirmation when the model is not yet confident', () => {
    expect(shouldAutoStartLearningIntent(createPlan({ confidence: 'medium' }))).toBe(false);
  });

  it('always starts after the user has resolved the ambiguity', () => {
    expect(shouldAutoStartLearningIntent(createPlan({ confidence: 'medium' }), true)).toBe(true);
  });
});
