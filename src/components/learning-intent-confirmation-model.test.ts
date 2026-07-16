import { describe, expect, it } from 'vitest';
import type { LearningIntentQuestion } from '@/types/learning-intent';
import {
  buildLearningIntentAnswers,
  hasLearningIntentAnswer,
  updateLearningIntentSelection,
} from './learning-intent-confirmation-model';

const single: LearningIntentQuestion = {
  id: 'level',
  prompt: '你现在更接近哪种状态？',
  kind: 'single',
  options: [
    { id: 'new', label: '刚开始' },
    { id: 'review', label: '学过但不稳' },
  ],
};

const multiple: LearningIntentQuestion = {
  id: 'focus',
  prompt: '这次更想解决什么？',
  kind: 'multiple',
  options: [
    { id: 'concept', label: '概念' },
    { id: 'practice', label: '练习' },
  ],
};

describe('learning intent confirmation model', () => {
  it('单选只保留最后一次选择', () => {
    const first = updateLearningIntentSelection({}, single, 'new');
    const second = updateLearningIntentSelection(first, single, 'review');

    expect(second.level).toEqual(['review']);
    expect(hasLearningIntentAnswer(second, single)).toBe(true);
  });

  it('多选支持追加和取消', () => {
    const first = updateLearningIntentSelection({}, multiple, 'concept');
    const second = updateLearningIntentSelection(first, multiple, 'practice');
    const third = updateLearningIntentSelection(second, multiple, 'concept');

    expect(second.focus).toEqual(['concept', 'practice']);
    expect(third.focus).toEqual(['practice']);
  });

  it('按问题顺序生成给模型的答案与可读标签', () => {
    expect(buildLearningIntentAnswers([single, multiple], {
      level: ['review'],
      focus: ['practice'],
    })).toEqual([
      {
        questionId: 'level',
        question: single.prompt,
        optionIds: ['review'],
        optionLabels: ['学过但不稳'],
      },
      {
        questionId: 'focus',
        question: multiple.prompt,
        optionIds: ['practice'],
        optionLabels: ['练习'],
      },
    ]);
  });
});
