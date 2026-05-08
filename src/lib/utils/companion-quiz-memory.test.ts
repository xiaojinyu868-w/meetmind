import { describe, expect, it } from 'vitest';
import { formatQuizAttemptsForTutor, upsertQuizAttempt } from './companion-quiz-memory';

describe('companion quiz memory', () => {
  it('formats wrong quiz attempts so the next tutor turn can answer what was wrong', () => {
    const attempts = upsertQuizAttempt([], {
      questionId: 'q1',
      stem: '说话者提到的巨大风险具体是什么行为？',
      picked: 'A',
      pickedText: '在六岁时决定成为一名演员',
      correctAnswer: 'B',
      correctText: '从德克萨斯州搬去加利福尼亚州追求演员梦想',
      explanation: '文本明确提到 moving out to California from Texas。',
      correct: false,
    });

    const context = formatQuizAttemptsForTutor(attempts);

    expect(context).toContain('刚刚这套测验');
    expect(context).toContain('做错');
    expect(context).toContain('说话者提到的巨大风险');
    expect(context).toContain('A');
    expect(context).toContain('B');
  });

  it('updates an existing attempt instead of duplicating it', () => {
    const first = upsertQuizAttempt([], {
      questionId: 'q1',
      stem: '题目',
      picked: 'A',
      correctAnswer: 'B',
      correct: false,
    });
    const second = upsertQuizAttempt(first, {
      questionId: 'q1',
      stem: '题目',
      picked: 'B',
      correctAnswer: 'B',
      correct: true,
    });

    expect(second).toHaveLength(1);
    expect(second[0].correct).toBe(true);
  });
});
