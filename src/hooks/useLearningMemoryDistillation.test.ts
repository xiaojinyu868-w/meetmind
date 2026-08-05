import { describe, expect, it } from 'vitest';
import type { LearningThreadEntry } from '@/types/user';
import { updateLearningThreadFromTurn } from './useLearningMemoryDistillation';

const THREAD: LearningThreadEntry = {
  id: 'thread-1',
  title: '分清相关与因果',
  intent: '我想真正理解相关和因果的区别',
  outcome: '能用自己的例子解释区别',
  depth: 'deep',
  status: 'active',
  lastSummary: '已经知道相关只说明一起变化',
  nextStep: '识别共同原因',
  createdAt: '2026-08-05T08:00:00.000Z',
  updatedAt: '2026-08-05T08:00:00.000Z',
};

describe('updateLearningThreadFromTurn', () => {
  it('keeps a recoverable turn summary when model maintenance is unavailable', () => {
    const updated = updateLearningThreadFromTurn(
      THREAD,
      '**共同原因**会让两个变量同时变化。下一轮可以用吸烟、黄手指和肺癌来检验。',
      undefined,
      '2026-08-05T09:00:00.000Z',
    );

    expect(updated.lastSummary).toContain('已经知道相关只说明一起变化');
    expect(updated.lastSummary).toContain('共同原因会让两个变量同时变化');
    expect(updated.nextStep).toBe('识别共同原因');
    expect(updated.updatedAt).toBe('2026-08-05T09:00:00.000Z');
  });

  it('prefers model-refined progress without changing thread identity', () => {
    const updated = updateLearningThreadFromTurn(
      THREAD,
      '本轮回答',
      {
        summary: '已经定位到相关与因果之间缺少排除共同原因这一步',
        nextStep: '让学生自己构造一个混淆变量反例',
      },
      '2026-08-05T10:00:00.000Z',
    );

    expect(updated).toMatchObject({
      id: THREAD.id,
      status: 'active',
      lastSummary: '已经定位到相关与因果之间缺少排除共同原因这一步',
      nextStep: '让学生自己构造一个混淆变量反例',
      updatedAt: '2026-08-05T10:00:00.000Z',
    });
  });
});
