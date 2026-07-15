import { describe, expect, it } from 'vitest';
import type { TranscriptSegment } from '@/types';
import { buildWorkshopReadinessSignature } from './useWorkshopReadiness';

describe('buildWorkshopReadinessSignature', () => {
  it('changes when a transcript array is populated in place', () => {
    const transcript: TranscriptSegment[] = [];
    const input = { transcript, activeAnchorCount: 0 };
    const before = buildWorkshopReadinessSignature(input);

    transcript.push({
      id: 'segment-1',
      text: '这是后来从 IndexedDB 回填进来的课堂原文。',
      startMs: 0,
      endMs: 8_000,
      isFinal: true,
    });

    expect(buildWorkshopReadinessSignature(input)).not.toBe(before);
  });

  it('changes when same-length text is corrected', () => {
    const transcript: TranscriptSegment[] = [{
      id: 'segment-1',
      text: '量子计算',
      startMs: 0,
      endMs: 3_000,
      isFinal: true,
    }];
    const input = { transcript, activeAnchorCount: 0 };
    const before = buildWorkshopReadinessSignature(input);

    transcript[0].text = '量子纠错';

    expect(buildWorkshopReadinessSignature(input)).not.toBe(before);
  });

  it('changes when the same words belong to a different learning scene', () => {
    const transcript: TranscriptSegment[] = [{
      id: 'segment-1',
      text: 'Please listen carefully and answer questions one to six.',
      startMs: 0,
      endMs: 65_000,
      isFinal: true,
    }];

    const casual = buildWorkshopReadinessSignature({
      transcript,
      activeAnchorCount: 0,
      contextTitle: '随手录音',
    });
    const lesson = buildWorkshopReadinessSignature({
      transcript,
      activeAnchorCount: 0,
      contextTitle: 'IELTS 听力练习',
    });

    expect(lesson).not.toBe(casual);
  });
});
