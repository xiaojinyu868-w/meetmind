function compact(value: string, max = 42): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1)}…`;
}

export function formatQuizActivity(input: {
  index: number;
  total: number;
  stem: string;
  picked: string;
  answer: string;
  correct: boolean;
}): string {
  return `测验第 ${input.index}/${input.total} 题${input.correct ? '答对' : '答错'}：题目「${compact(input.stem)}」；学生选「${compact(input.picked)}」；正确答案「${compact(input.answer)}」。`;
}

export function formatQuizCompleteActivity(input: { correct: number; total: number }): string {
  const accuracy = input.total > 0 ? Math.round((input.correct / input.total) * 100) : 0;
  return `课堂测验完成：${input.total} 题答对 ${input.correct} 题，正确率 ${accuracy}%。`;
}

export function formatFlashcardActivity(input: {
  index: number;
  total: number;
  front: string;
  rating: 'missed' | 'got';
}): string {
  return `闪卡第 ${input.index}/${input.total} 张标记为${input.rating === 'got' ? '记住了' : '没记住'}：正面「${compact(input.front)}」。`;
}

export function formatFlashcardCompleteActivity(input: { got: number; total: number }): string {
  const missed = Math.max(0, input.total - input.got);
  return `闪卡训练完成：${input.total} 张里记住 ${input.got} 张，待加强 ${missed} 张。`;
}
