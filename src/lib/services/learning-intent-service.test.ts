import { describe, expect, it } from 'vitest';
import { sanitizeLearningIntentPlan } from './learning-intent-service';

describe('sanitizeLearningIntentPlan', () => {
  it('keeps valid model intent fields and trims checkpoints to three', () => {
    const plan = sanitizeLearningIntentPlan({
      title: '理解机会成本',
      outcome: '能分析自己的时间选择',
      approach: 'practice',
      contextFocus: 'current',
      checkpoints: ['理解定义', '看校园例子', '自己练一次', '多余步骤'],
      confidence: 'high',
    }, '学习机会成本');

    expect(plan).toMatchObject({
      title: '理解机会成本',
      outcome: '能分析自己的时间选择',
      approach: 'practice',
      contextFocus: 'current',
      confidence: 'high',
    });
    expect(plan.checkpoints).toEqual(['理解定义', '看校园例子', '自己练一次']);
  });

  it('uses a safe editable plan when the model response is malformed', () => {
    const plan = sanitizeLearningIntentPlan({
      approach: 'unsupported',
      contextFocus: 'everything',
      confidence: 'low',
      clarification: '  你更想理解概念，还是解决一道题？  ',
    }, '我想学会贝叶斯定理');

    expect(plan.title).toBe('我想学会贝叶斯定理');
    expect(plan.approach).toBe('understand');
    expect(plan.contextFocus).toBe('mixed');
    expect(plan.checkpoints).toHaveLength(3);
    expect(plan.clarification).toBe('你更想理解概念，还是解决一道题？');
  });
});
