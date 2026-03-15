import { expect, test } from '@playwright/test';
import type { TranscriptSegment } from '../../src/types';
import { appendLiveRecordingSegments, resolveLiveRecordingAppendOffset } from '../../src/lib/capture/live-recording';

function segment(params: Partial<TranscriptSegment> & Pick<TranscriptSegment, 'id' | 'text' | 'startMs' | 'endMs'>): TranscriptSegment {
  return {
    confidence: 0.98,
    ...params,
  };
}

test.describe('live recording utils', () => {
  test('continuation offset starts after existing session timeline', async () => {
    const existingSegments = [
      segment({ id: 'seg-1', text: '第一段', startMs: 0, endMs: 5_000 }),
      segment({ id: 'seg-2', text: '第二段', startMs: 5_800, endMs: 11_000 }),
    ];

    expect(resolveLiveRecordingAppendOffset(existingSegments, 9_000)).toBe(12_200);
    expect(resolveLiveRecordingAppendOffset([], 35_000)).toBe(36_200);
    expect(resolveLiveRecordingAppendOffset([], 0)).toBe(0);
  });

  test('batch transcription appends new recording segments with shifted timestamps', async () => {
    const existingSegments = [
      segment({ id: 'seg-1', text: '旧内容', startMs: 0, endMs: 8_000 }),
    ];
    const incomingSegments = [
      segment({ id: 'raw-1', text: '新内容一', startMs: 0, endMs: 1_600 }),
      segment({ id: 'raw-2', text: '新内容二', startMs: 2_000, endMs: 3_800 }),
    ];

    const { appendedSegments, mergedSegments, totalDurationMs } = appendLiveRecordingSegments({
      existingSegments,
      incomingSegments,
      sourceItemId: 'audio-123',
      offsetMs: resolveLiveRecordingAppendOffset(existingSegments, 8_000),
    });

    expect(appendedSegments).toHaveLength(2);
    expect(appendedSegments[0]).toMatchObject({
      id: 'raw-1',
      sourceItemId: 'audio-123',
      startMs: 9_200,
      endMs: 10_800,
    });
    expect(appendedSegments[1]).toMatchObject({
      id: 'raw-2',
      sourceItemId: 'audio-123',
      startMs: 11_200,
      endMs: 13_000,
    });
    expect(mergedSegments.map((item) => item.text)).toEqual(['旧内容', '新内容一', '新内容二']);
    expect(totalDurationMs).toBe(13_000);
  });
});
