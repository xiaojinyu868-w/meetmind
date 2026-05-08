export interface CompanionQuizAttempt {
  questionId: string;
  stem: string;
  picked: string;
  pickedText?: string;
  correctAnswer: string;
  correctText?: string;
  explanation?: string;
  correct: boolean;
}

export function upsertQuizAttempt(
  attempts: CompanionQuizAttempt[],
  next: CompanionQuizAttempt,
): CompanionQuizAttempt[] {
  const index = attempts.findIndex((item) => item.questionId === next.questionId);
  if (index < 0) return [...attempts, next];
  const cloned = attempts.slice();
  cloned[index] = next;
  return cloned;
}

export function formatQuizAttemptsForTutor(attempts: CompanionQuizAttempt[]): string {
  if (attempts.length === 0) return '';
  const wrong = attempts.filter((item) => !item.correct);
  const lines = [
    `刚刚这套测验：共作答 ${attempts.length} 题，做错 ${wrong.length} 题。`,
    ...attempts.map((item, index) => {
      const picked = item.pickedText ? `${item.picked}（${item.pickedText}）` : item.picked;
      const answer = item.correctText ? `${item.correctAnswer}（${item.correctText}）` : item.correctAnswer;
      return [
        `${index + 1}. ${item.correct ? '答对' : '做错'}：${item.stem}`,
        `   用户选：${picked}`,
        `   正确答案：${answer}`,
        item.explanation ? `   解析：${item.explanation}` : '',
      ].filter(Boolean).join('\n');
    }),
  ];
  return lines.join('\n');
}

export function buildQuestionWithQuizContext(question: string, attempts: CompanionQuizAttempt[]): string {
  const quizContext = formatQuizAttemptsForTutor(attempts);
  if (!quizContext) return question;
  return `${question}\n\n[同桌可见的最近测验作答结果]\n${quizContext}\n\n回答时如果用户问“刚刚/刚才做错了哪些题/哪题不懂”，请优先依据这份作答结果回答。`;
}
