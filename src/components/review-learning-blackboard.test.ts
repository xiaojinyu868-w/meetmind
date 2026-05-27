import { describe, expect, it } from 'vitest';
import {
  appendReviewLearningActivity,
  createReviewLearningBlackboard,
  formatReviewBlackboardForTutorAgent,
  openReviewLearningApp,
} from './review-learning-blackboard';

describe('review learning blackboard', () => {
  it('records app openings as shared review notes instead of only local UI state', () => {
    const blackboard = openReviewLearningApp(createReviewLearningBlackboard(), 'quiz', 'tutor');

    expect(blackboard.activeAppKey).toBe('quiz');
    expect(blackboard.notes[0]).toMatchObject({
      appKey: 'quiz',
      source: 'tutor',
      text: '同桌打开了测验。',
    });
  });

  it('keeps recent app notes and formats only learning-scene facts for tutor context', () => {
    const blackboard = appendReviewLearningActivity(
      openReviewLearningApp(createReviewLearningBlackboard(), 'quiz', 'workspace'),
      '测验第 1/5 题答错：题目「What is Jane planning to do?」；学生选「Visit Australia」；正确答案「Move to the United States」。',
    );

    const context = formatReviewBlackboardForTutorAgent(blackboard);

    expect(context).toBe([
      '【当前学习现场】',
      '当前打开：测验',
      '',
      '最近发生：',
      '- 学生打开了测验。',
      '- 测验第 1/5 题答错：题目「What is Jane planning to do?」；学生选「Visit Australia」；正确答案「Move to the United States」。',
    ].join('\n'));
    expect(context).not.toMatch(/如果|应该|优先|提醒|建议|不要|只作为|可以/);
  });

  it('does not keep model-facing directives even if an app accidentally emits them', () => {
    const blackboard = appendReviewLearningActivity(
      createReviewLearningBlackboard(),
      '如果他问错因，可以提醒他区分地点线索和动作线索。学生第 1 题答错。',
    );

    expect(formatReviewBlackboardForTutorAgent(blackboard)).toBe([
      '【当前学习现场】',
      '最近发生：',
      '- 学生第 1 题答错。',
    ].join('\n'));
  });
});
