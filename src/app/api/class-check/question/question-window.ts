import type { TranscriptSegment } from '@/types';
import type { ClassCheckQuestionData } from '@/app/api/class-check/plan/route';

/**
 * 随堂检验出题的纯函数部分：选转录窗口、正规化模型输出。
 *
 * 没有兜底题。题目只能来自模型读过真实转录后的产物；模型没给出可用的题，
 * 这个 checkpoint 就安静地跳过（客户端把它标成 skipped），而不是塞一道
 * 「最值得先确认的是哪一件事？」这种正确答案永远是 A 的方法论模板题。
 */

/** 仅保留该 checkpoint 时间窗内的转录片段，并在前后各多留 10s 余量 */
export function sliceSegmentsInWindow(
  segments: TranscriptSegment[],
  startMs: number,
  endMs: number,
): TranscriptSegment[] {
  const PAD_MS = 10_000;
  const lo = Math.max(0, startMs - PAD_MS);
  const hi = endMs + PAD_MS;
  return segments.filter((s) => s.endMs >= lo && s.startMs <= hi);
}

/**
 * 窗口里一段都没有（plan 给的时间点漂到了转录之外）时，取时间上最接近的几段
 * 作为窗口——它们仍是这节课的原话，模型据此出题是有根的；直接放弃则太浪费。
 */
export function selectNearestTranscriptSegments(
  segments: TranscriptSegment[],
  startMs: number,
  endMs: number,
  limit = 6,
): TranscriptSegment[] {
  const midpoint = (startMs + endMs) / 2;
  return [...segments]
    .sort((a, b) => {
      const aMidpoint = (a.startMs + a.endMs) / 2;
      const bMidpoint = (b.startMs + b.endMs) / 2;
      return Math.abs(aMidpoint - midpoint) - Math.abs(bMidpoint - midpoint);
    })
    .slice(0, Math.max(1, limit))
    .sort((a, b) => a.startMs - b.startMs);
}

export interface QuestionLLMRaw {
  stem?: string;
  options?: string[];
  answer?: string;
  explanation?: string;
}

function normalizeOptions(options: unknown): string[] {
  if (!Array.isArray(options)) return [];
  return options
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0)
    .slice(0, 6);
}

function stripOptionPrefix(option: string): string {
  return option.replace(/^[A-Za-z][.、)．\s]+/, '').trim().toLowerCase();
}

/**
 * 把模型给的 answer 解析成选项下标。接受「B」「B.」「B、xxx」或选项原文；
 * 解析不出来返回 -1——这种题不能上：正确答案是猜的，学生答对答错都没有意义。
 */
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

/** 模型输出 → 可用题；题干 / 选项 / 答案任一不成立就丢掉这道题 */
export function normalizeQuestion(raw: QuestionLLMRaw): ClassCheckQuestionData | null {
  const stem = typeof raw?.stem === 'string' ? raw.stem.trim() : '';
  if (!stem) return null;
  const options = normalizeOptions(raw.options);
  if (options.length < 2) return null;
  const answerIndex = resolveAnswerIndex(raw.answer, options);
  if (answerIndex < 0) return null;
  return {
    stem,
    options,
    answer: String.fromCharCode(65 + answerIndex),
    explanation: typeof raw.explanation === 'string' ? raw.explanation.trim() : '',
  };
}
