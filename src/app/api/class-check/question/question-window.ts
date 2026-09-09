import type { TranscriptSegment } from '@/types';
import type { ClassCheckQuestionData } from '@/app/api/class-check/plan/route';
import { normalizeQuizOptions, resolveAnswerIndex } from '@/lib/ai-native/quiz-answer';

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

export { resolveAnswerIndex } from '@/lib/ai-native/quiz-answer';

/** 模型输出 → 可用题；题干 / 选项 / 答案任一不成立就丢掉这道题 */
export function normalizeQuestion(raw: QuestionLLMRaw): ClassCheckQuestionData | null {
  const stem = typeof raw?.stem === 'string' ? raw.stem.trim() : '';
  if (!stem) return null;
  const options = normalizeQuizOptions(raw.options);
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
