import { describe, expect, it } from 'vitest';
import {
  formatFlashcardActivity,
  formatQuizActivity,
  formatQuizCompleteActivity,
} from './review-learning-activity';

describe('review learning activity formatting', () => {
  it('formats quiz answer events for tutor context', () => {
    expect(formatQuizActivity({
      index: 1,
      total: 5,
      stem: 'What is Jane planning to do?',
      picked: 'Visit Australia',
      answer: 'Move to the United States',
      correct: false,
    })).toBe('测验第 1/5 题答错：题目「What is Jane planning to do?」；学生选「Visit Australia」；正确答案「Move to the United States」。');
  });

  it('formats quiz completion summary', () => {
    expect(formatQuizCompleteActivity({ correct: 3, total: 5 })).toBe('课堂测验完成：5 题答对 3 题，正确率 60%。');
  });

  it('formats flashcard rating events', () => {
    expect(formatFlashcardActivity({
      index: 2,
      total: 6,
      front: 'up in the air',
      rating: 'missed',
    })).toBe('闪卡第 2/6 张标记为没记住：正面「up in the air」。');
  });
});
