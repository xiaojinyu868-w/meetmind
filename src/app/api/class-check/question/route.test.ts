import { describe, expect, it } from 'vitest';
import { buildFallbackCheckpointQuestions } from './question-fallback';
import { selectNearestTranscriptSegments } from './route';
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

describe('buildFallbackCheckpointQuestions', () => {
  it('returns usable questions when LLM question generation fails', () => {
    const questions = buildFallbackCheckpointQuestions({
      checkpoint: {
        topic: 'AI 编程工具的产品差异',
        difficulty: 3,
        startMs: 0,
        endMs: 40_000,
      },
      windowSegments: transcript,
      count: 2,
    });

    expect(questions).toHaveLength(2);
    expect(questions[0].stem).toContain('AI 编程工具的产品差异');
    expect(questions[0].options.length).toBeGreaterThanOrEqual(4);
    expect(questions[0].answer).toBe('A');
    expect(questions[0].explanation).toContain('课堂原文');
  });
});

describe('selectNearestTranscriptSegments', () => {
  it('keeps future checkpoint preheating usable while streaming transcript is incomplete', () => {
    const nearest = selectNearestTranscriptSegments(transcript, 90_000, 110_000, 1);
    expect(nearest.map((segment) => segment.id)).toEqual(['seg-2']);
  });
});
