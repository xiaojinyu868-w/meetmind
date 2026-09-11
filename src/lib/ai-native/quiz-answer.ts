/**
 * quiz-answer — 选择题答案解析（纯函数，服务端插件与浏览器窗口共用）。
 *
 * 模型给的 answer 可能是「B」「B.」「B、xxx」或选项原文。这里把它解析成选项下标；
 * 解析不出来返回 -1——这种题不能上：正确答案是猜的，学生答对答错都没有意义。
 * 随堂检验 API、随堂检验插件、测验插件共用；不再有任何「缺 answer 默认 A」。
 *
 * 多选题（2026-09-11，type = 'multiple'）的答案契约：插件把模型给的答案收口成「字母、字母」（如 "A、C"），
 * 窗口再按当时的选项顺序解析回选项文本——字母对选项顺序是稳定的，选项文本本身可能含顿号 / 逗号，
 * 不能拿它当分隔符。学生的多选作答在 selected 里用 QUIZ_MULTI_SEPARATOR 连接（控制字符，选项文本里不会出现）。
 * 模型写多选答案的方式五花八门（"AC" / "A、C" / "A, C" / "A和C" / 直接写选项原文），这里都认；
 * 认不出一个选项就当没写——上层据此决定降级（只解析出一个 → 单选；一个都没有 → 简答）。
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

/* ── 多选 ── */

/** 学生多选作答在 selected 记录里的连接符（\u001f：单元分隔符，不会出现在正常文本里） */
export const QUIZ_MULTI_SEPARATOR = '\u001f';

/** 单个答案片段（字母 / 选项原文 / 带字母前缀的原文）→ 选项文本；认不出 → undefined */
export function resolveOptionRef(token: string, options: readonly string[]): string | undefined {
  const index = resolveAnswerIndex(token, options as string[]);
  return index >= 0 ? options[index] : undefined;
}

/**
 * 多选答案 → 选项文本数组（按选项顺序、去重）。
 * 先按分隔符（、，,；;/ 和 与 及 空格）切；切完若某段是连写字母（"ACD"）再拆成单字母。
 */
export function parseMultipleAnswer(answer: string, options: readonly string[]): string[] {
  const picked = new Set<string>();
  const pieces = answer
    .split(/[、，,;；/\s]+|和|与|及/)
    .map((piece) => piece.trim())
    .filter(Boolean);
  for (const piece of pieces) {
    const direct = resolveOptionRef(piece, options);
    if (direct) {
      picked.add(direct);
      continue;
    }
    if (/^[A-Za-z]{2,6}$/.test(piece)) {
      for (const letter of piece) {
        const option = resolveOptionRef(letter, options);
        if (option) picked.add(option);
      }
    }
  }
  return options.filter((option) => picked.has(option));
}

/** 选项文本数组 → 规范化的多选答案（"A、C"），用于存进产物 */
export function formatMultipleAnswer(correct: readonly string[], options: readonly string[]): string {
  return options
    .map((option, index) => (correct.includes(option) ? String.fromCharCode(65 + index) : null))
    .filter((letter): letter is string => Boolean(letter))
    .join('、');
}

export function splitMultipleSelection(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(QUIZ_MULTI_SEPARATOR).filter(Boolean);
}

export function joinMultipleSelection(values: readonly string[]): string {
  return values.filter(Boolean).join(QUIZ_MULTI_SEPARATOR);
}

/** 两组选项是否同一集合（顺序无关） */
export function sameOptionSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((item) => set.has(item));
}
