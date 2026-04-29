import { describe, expect, it } from 'vitest';
import {
  buildClassCheckPlanRequestKey,
  buildClientFallbackCheckpointQuestions,
  shouldAutoFetchCheckpointQuestions,
} from './useClassCheckUtils';
import type { TranscriptSegment } from '@/types';

function makeSegments(count: number): TranscriptSegment[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `seg-${index}`,
    text: `这是第 ${index + 1} 段课堂转录，包含足够的内容用于随堂检验。`,
    startMs: index * 3_000,
    endMs: (index + 1) * 3_000,
    confidence: 0.95,
    speakerId: 'teacher',
    isFinal: true,
  }));
}

describe('buildClassCheckPlanRequestKey', () => {
  it('keeps live transcript growth within the same coarse bucket on one plan key', () => {
    const first = buildClassCheckPlanRequestKey({
      sessionId: 'session-1',
      dataSource: 'live',
      segments: makeSegments(161),
    });
    const grown = buildClassCheckPlanRequestKey({
      sessionId: 'session-1',
      dataSource: 'live',
      segments: makeSegments(169),
    });

    expect(grown).toBe(first);
  });

  it('changes live plan key only after a large transcript growth bucket', () => {
    const currentBucket = buildClassCheckPlanRequestKey({
      sessionId: 'session-1',
      dataSource: 'live',
      segments: makeSegments(199),
    });
    const nextBucket = buildClassCheckPlanRequestKey({
      sessionId: 'session-1',
      dataSource: 'live',
      segments: makeSegments(201),
    });

    expect(nextBucket).not.toBe(currentBucket);
  });

  it('does not build a key for unsupported source or too little transcript', () => {
    expect(buildClassCheckPlanRequestKey({
      sessionId: 'session-1',
      dataSource: 'text',
      segments: makeSegments(20),
    })).toBeNull();
    expect(buildClassCheckPlanRequestKey({
      sessionId: 'session-1',
      dataSource: 'live',
      segments: makeSegments(5),
    })).toBeNull();
  });
});

describe('shouldAutoFetchCheckpointQuestions', () => {
  it('does not auto retry a checkpoint after question generation has failed', () => {
    expect(shouldAutoFetchCheckpointQuestions({
      hasQuestions: false,
      questionState: 'failed',
      checkpointStatus: 'pending',
    })).toBe(false);
  });

  it('builds local fallback questions when the question endpoint is rate limited', () => {
    const questions = buildClientFallbackCheckpointQuestions({
      checkpoint: {
        topic: 'why 和认知地图',
        difficulty: 3,
        startMs: 0,
        endMs: 12_000,
        triggerMs: 12_000,
        greeting: '',
        encouragement: '',
        questions: [],
      },
      transcript: makeSegments(3),
    });

    expect(questions.length).toBeGreaterThan(0);
    expect(questions[0].stem).toContain('why 和认知地图');
  });
});
