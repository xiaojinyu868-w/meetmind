/**
 * quiz-answer — 选择题答案解析（纯函数）
 *
 * 模型给的 answer 可能是「B」「B.」「B、xxx」或选项原文。这里把它解析成选项下标；
 * 解析不出来返回 -1——这种题不能上：正确答案是猜的，学生答对答错都没有意义。
 * 随堂检验 API、随堂检验插件共用；不再有任何「缺 answer 默认 A」。
 */

export function stripOptionPrefix(option: string): string {
  return option.replace(/^[A-Za-z][.、)．\s]+/, '').trim().toLowerCase();
}

export function resolveAnswerIndex(answer: unknown, options: string[]): number {
  if (typeof answer !== 'string') return -1;
  const trimmed = answer.trim();
  if (!trimmed) return -1;

  const letter = trimmed.match(/^([A-Za-z])[.、)．\s]*$/);
  if (letter) {
    const idx = letter[1].toUpperCase().charCodeAt(0) - 65;
    return idx >= 0 && idx < options.length ? idx : -1;
  }

  const lowered = trimmed.toLowerCase();
  const exact = options.findIndex((option) => option.toLowerCase() === lowered);
  if (exact >= 0) return exact;

  const content = stripOptionPrefix(trimmed);
  if (!content) return -1;
  return options.findIndex((option) => stripOptionPrefix(option) === content);
}

export function normalizeQuizOptions(options: unknown, max = 6): string[] {
  if (!Array.isArray(options)) return [];
  return options
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0)
    .slice(0, max);
}
