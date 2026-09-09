import { describe, expect, it } from 'vitest';
import {
  normalizeQuestion,
  resolveAnswerIndex,
  selectNearestTranscriptSegments,
  sliceSegmentsInWindow,
} from './question-window';
import type { TranscriptSegment } from '@/types';

const transcript: TranscriptSegment[] = [
  {
    id: 'seg-1',
    text: '老师这里在比较 Cursor、Copilot 和 Claude Code 的产品差异，重点是它们如何帮助开发者推进任务。',
    startMs: 0,
    endMs: 20_000,
    confidence: 0.9,
    isFinal: true,
  },
  {
    id: 'seg-2',
    text: '后面还提到 Codex 和 Midjourney，说明 AI 产品需要把能力做成用户能感知的下一步。',
    startMs: 20_000,
    endMs: 40_000,
    confidence: 0.9,
    isFinal: true,
  },
];

describe('sliceSegmentsInWindow', () => {
  it('keeps segments overlapping the window with 10s padding', () => {
    expect(sliceSegmentsInWindow(transcript, 25_000, 30_000).map((s) => s.id)).toEqual(['seg-1', 'seg-2']);
    expect(sliceSegmentsInWindow(transcript, 35_000, 45_000).map((s) => s.id)).toEqual(['seg-2']);
    expect(sliceSegmentsInWindow(transcript, 90_000, 110_000)).toEqual([]);
  });
});

describe('selectNearestTranscriptSegments', () => {
  it('falls back to the closest real segments when the plan window drifted outside the transcript', () => {
    const nearest = selectNearestTranscriptSegments(transcript, 90_000, 110_000, 1);
    expect(nearest.map((segment) => segment.id)).toEqual(['seg-2']);
  });
});

describe('resolveAnswerIndex', () => {
  const options = ['A. 只用 Cursor', 'B. 看它们怎么推进任务', 'C. 比价格', 'D. 都一样'];

  it('accepts a bare letter, letter with punctuation, or the option text', () => {
    expect(resolveAnswerIndex('B', options)).toBe(1);
    expect(resolveAnswerIndex('b.', options)).toBe(1);
    expect(resolveAnswerIndex('B. 看它们怎么推进任务', options)).toBe(1);
    expect(resolveAnswerIndex('看它们怎么推进任务', options)).toBe(1);
  });

  it('rejects missing, out-of-range, or unmatched answers instead of guessing A', () => {
    expect(resolveAnswerIndex(undefined, options)).toBe(-1);
    expect(resolveAnswerIndex('', options)).toBe(-1);
    expect(resolveAnswerIndex('F', options)).toBe(-1);
    expect(resolveAnswerIndex('完全无关的文本', options)).toBe(-1);
  });
});

describe('normalizeQuestion', () => {
  it('keeps a well-formed model question and canonicalizes the answer to a letter', () => {
    const question = normalizeQuestion({
      stem: '老师比较这些工具时，最看重什么？',
      options: ['A. 价格', 'B. 如何帮助开发者推进任务', 'C. 品牌'],
      answer: '如何帮助开发者推进任务',
      explanation: '原话里说重点是它们如何帮助开发者推进任务。',
    });
    expect(question).not.toBeNull();
    expect(question!.answer).toBe('B');
  });

  it('drops questions whose correct answer cannot be resolved — no fabricated A', () => {
    expect(normalizeQuestion({
      stem: '一道没有答案的题',
      options: ['A. 甲', 'B. 乙'],
    })).toBeNull();
    expect(normalizeQuestion({
      stem: '答案越界',
      options: ['A. 甲', 'B. 乙'],
      answer: 'D',
    })).toBeNull();
  });

  it('drops questions without a stem or with fewer than two options', () => {
    expect(normalizeQuestion({ options: ['A. 甲', 'B. 乙'], answer: 'A' })).toBeNull();
    expect(normalizeQuestion({ stem: '只有一个选项', options: ['A. 甲'], answer: 'A' })).toBeNull();
  });
});
