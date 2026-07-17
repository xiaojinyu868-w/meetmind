import { describe, expect, it } from 'vitest';
import { computeDiarizationErrorRate } from './diarization';

describe('computeDiarizationErrorRate', () => {
  it('treats anonymous speaker id swaps as a perfect result', () => {
    const result = computeDiarizationErrorRate(
      [
        { speakerId: 'teacher', startMs: 0, endMs: 4000 },
        { speakerId: 'student', startMs: 4000, endMs: 8000 },
      ],
      [
        { speakerId: '1', startMs: 0, endMs: 4000 },
        { speakerId: '0', startMs: 4000, endMs: 8000 },
      ],
      { collarMs: 0 },
    );

    expect(result.der).toBe(0);
    expect(result.mapping).toEqual({ '0': 'student', '1': 'teacher' });
  });

  it('separates confusion from missed speech and false alarms', () => {
    const result = computeDiarizationErrorRate(
      [
        { speakerId: 'a', startMs: 0, endMs: 3000 },
        { speakerId: 'b', startMs: 3000, endMs: 6000 },
      ],
      [{ speakerId: 'only', startMs: 0, endMs: 5000 }],
      { frameMs: 1000, collarMs: 0 },
    );

    expect(result.referenceSpeechMs).toBe(6000);
    expect(result.missedSpeechMs).toBe(1000);
    expect(result.confusionMs).toBe(2000);
    expect(result.falseAlarmMs).toBe(0);
    expect(result.der).toBe(0.5);
    expect(result.speakerCountError).toBe(1);
  });

  it('ignores invalid zero-length segments', () => {
    const result = computeDiarizationErrorRate(
      [{ speakerId: 'a', startMs: 0, endMs: 0 }],
      [],
    );
    expect(result.der).toBe(0);
    expect(result.referenceSpeakerCount).toBe(0);
  });
});
