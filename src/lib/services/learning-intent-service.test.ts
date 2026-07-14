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
      questions: [],
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

  it('uses a safe plan when the model response is malformed', () => {
    const plan = sanitizeLearningIntentPlan({
      approach: 'unsupported',
      contextFocus: 'everything',
      confidence: 'low',
    }, '我想学会贝叶斯定理');

    expect(plan.title).toBe('我想学会贝叶斯定理');
    expect(plan.approach).toBe('understand');
    expect(plan.contextFocus).toBe('mixed');
    expect(plan.checkpoints).toHaveLength(3);
    expect(plan.questions).toBeUndefined();
  });

  it('keeps at most three actionable choice questions', () => {
    const plan = sanitizeLearningIntentPlan({
      title: '选对统计检验',
      outcome: '看到题目能判断该用哪种检验',
      approach: 'practice',
      contextFocus: 'mixed',
      checkpoints: ['建立判断框架'],
      confidence: 'low',
      questions: [
        {
          id: 'exam_type',
          prompt: '你最容易卡在哪类题？',
          kind: 'multiple',
          options: [
            { id: 'mean', label: '比较均值' },
            { id: 'ratio', label: '比较比例' },
            { id: 'relation', label: '判断相关性' },
          ],
        },
        { id: 'invalid', prompt: '无有效选项', kind: 'single', options: ['只有一个'] },
      ],
    }, '我想学统计学');

    expect(plan.questions).toEqual([{
      id: 'exam_type',
      prompt: '你最容易卡在哪类题？',
      kind: 'multiple',
      options: [
        { id: 'mean', label: '比较均值' },
        { id: 'ratio', label: '比较比例' },
        { id: 'relation', label: '判断相关性' },
      ],
    }]);
  });

  it('drops follow-up questions after the user has answered', () => {
    const plan = sanitizeLearningIntentPlan({
      title: '练习统计检验',
      outcome: '能独立选择方法',
      approach: 'practice',
      contextFocus: 'mixed',
      checkpoints: ['先看判断框架'],
      confidence: 'high',
      questions: [{ id: 'again', prompt: '还要问吗？', options: ['要', '不要'] }],
    }, '学习统计检验', false);

    expect(plan.questions).toBeUndefined();
  });
});
