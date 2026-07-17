import { describe, expect, it } from 'vitest';
import type { TranscriptSegment } from '@/types';
import {
  assessDiarizationEvidence,
  getSpeakerColorClass,
  getSpeakerLabel,
  mergeSpeakerIds,
  shouldRunPostBatchDiarization,
  type DiarizationSentence,
} from './diarization-service';

function segment(overrides: Partial<TranscriptSegment> = {}): TranscriptSegment {
  return {
    id: 'seg-1',
    text: '机器学习的泛化误差来自训练分布之外的偏差。',
    startMs: 0,
    endMs: 2400,
    confidence: 0.94,
    isFinal: true,
    ...overrides,
  };
}

describe('shouldRunPostBatchDiarization', () => {
  it('runs after a fresh lesson final pass without speaker labels', () => {
    expect(shouldRunPostBatchDiarization([segment()], 0)).toBe(true);
  });

  it('does not rerun when realtime speaker labels already exist', () => {
    expect(shouldRunPostBatchDiarization([segment({ speakerId: '0' })], 0)).toBe(false);
  });

  it('does not mistake an unresolved speaker id for a real label', () => {
    expect(shouldRunPostBatchDiarization([segment({ speakerId: '-1' })], 0)).toBe(true);
  });

  it('does not apply blob-relative speaker timestamps to a continued lesson offset', () => {
    expect(shouldRunPostBatchDiarization([segment({ startMs: 61_200 })], 61_200)).toBe(false);
  });

  it('does not call diarization for an empty final pass', () => {
    expect(shouldRunPostBatchDiarization([], 0)).toBe(false);
  });
});

function diarized(overrides: Partial<DiarizationSentence> = {}): DiarizationSentence {
  return {
    text: '这是一段足够稳定的课堂发言',
    beginTime: 0,
    endTime: 3000,
    speakerId: 0,
    ...overrides,
  };
}

describe('assessDiarizationEvidence', () => {
  it('shows labels only when two speakers both have meaningful evidence', () => {
    const evidence = assessDiarizationEvidence([
      diarized(),
      diarized({ text: '我想追问一下这个结论', beginTime: 3200, endTime: 6500, speakerId: 1 }),
    ]);

    expect(evidence.shouldApply).toBe(true);
    expect(evidence.stableSpeakerIds).toEqual([0, 1]);
  });

  it('hides a false second speaker created by a short noise fragment', () => {
    const evidence = assessDiarizationEvidence([
      diarized({ endTime: 7000 }),
      diarized({ text: '嗯', beginTime: 7100, endTime: 7600, speakerId: 1 }),
    ]);

    expect(evidence.shouldApply).toBe(false);
    expect(evidence.stableSpeakerIds).toEqual([0]);
  });

  it('ignores unresolved negative speaker ids', () => {
    const evidence = assessDiarizationEvidence([
      diarized({ speakerId: -1 }),
      diarized({ beginTime: 3200, endTime: 6500, speakerId: 0 }),
    ]);

    expect(evidence.stableSpeakerIds).toEqual([0]);
    expect(evidence.shouldApply).toBe(false);
  });
});

describe('mergeSpeakerIds', () => {
  it('uses the dominant time overlap instead of the nearest sentence start', () => {
    const [merged] = mergeSpeakerIds(
      [segment({ startMs: 0, endMs: 6000 })],
      [
        diarized({ beginTime: 0, endTime: 500, speakerId: 0 }),
        diarized({ beginTime: 600, endTime: 6000, speakerId: 1 }),
      ],
    );

    expect(merged.speakerId).toBe('1');
  });

  it('does not attach a distant speaker guess without overlap', () => {
    const [merged] = mergeSpeakerIds(
      [segment({ startMs: 10_000, endMs: 12_000 })],
      [diarized({ beginTime: 0, endTime: 3000, speakerId: 0 })],
    );

    expect(merged.speakerId).toBeUndefined();
  });
});

describe('speaker display labels', () => {
  it('uses neutral letters and never renders unresolved ids', () => {
    expect(getSpeakerLabel('0')).toBe('发言者 A');
    expect(getSpeakerLabel('1')).toBe('发言者 B');
    expect(getSpeakerLabel('-1')).toBe('');
    expect(getSpeakerLabel('1noise')).toBe('');
    expect(getSpeakerColorClass('-1')).toBe('');
  });
});
