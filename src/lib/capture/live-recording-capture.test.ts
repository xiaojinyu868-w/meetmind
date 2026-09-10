import { describe, expect, it } from 'vitest';
import {
  buildLiveCaptureSourceKey,
  buildLiveRecordingCaptureInput,
  isRecordingCheckpointStale,
  readRecordingState,
  UNFINISHED_RECORDING_AUTO_FINALIZE_MS,
} from './live-recording-capture';
import type { TranscriptSegment } from '@/types';

const segments: TranscriptSegment[] = [
  { id: 's1', text: '第一句', startMs: 0, endMs: 2000, confidence: 0.9, isFinal: true },
  { id: 's2', text: '  ', startMs: 2000, endMs: 2500, confidence: 0.9, isFinal: true },
  { id: 's3', text: '还在说的一句', startMs: 2500, endMs: 4000, confidence: 0.5, isFinal: false, provisional: true },
  { id: 's4', text: '第二句', startMs: 4000, endMs: 6000, confidence: 0.95, isFinal: true },
];

describe('live-recording capture payload（四个写入时刻的唯一形状）', () => {
  it('sourceKey 由 userId + sessionId 决定，录课开始就能算出来', () => {
    expect(buildLiveCaptureSourceKey('u1', 'session-1')).toBe('live:u1:session-1');
  });

  it('检查点：只带 previewText 与分段，不带正文（不触发课后理解 / 不当完整课堂引用）', () => {
    const body = buildLiveRecordingCaptureInput({
      userId: 'u1', sessionId: 'session-1', title: '录音 15:05', segments, durationMs: 6000, state: 'recording',
    });
    expect(body.sourceKey).toBe('live:u1:session-1');
    expect(body.previewText).toBe('第一句 还在说的一句 第二句');
    expect(body.normalizedText).toBeUndefined();
    expect(body.tutorContext).toBeUndefined();
    expect(body.metadata.recordingState).toBe('recording');
    // 空白句与 provisional 草稿都不进服务端证据
    expect(body.metadata.transcriptSegments).toEqual([
      expect.objectContaining({ id: 's1', text: '第一句' }),
      expect.objectContaining({ id: 's4', text: '第二句' }),
    ]);
    expect(body.metadata.segmentCount).toBe(2);
  });

  it('结束：带正文与 tutorContext，recordingState=completed', () => {
    const body = buildLiveRecordingCaptureInput({
      userId: 'u1', sessionId: 'session-1', title: '录音 15:05', segments, durationMs: 6000, state: 'completed', mediaUrl: 'blob:x',
    });
    expect(body.normalizedText).toBe('第一句 还在说的一句 第二句');
    expect(body.tutorContext).toBe(body.normalizedText);
    expect(body.mediaUrl).toBe('blob:x');
    expect(body.metadata.recordingState).toBe('completed');
  });

  it('没带分段的写入（原声回写 / 心跳）不放 transcriptSegments 与 segmentCount，服务端合并时不会清掉已有计数', () => {
    const body = buildLiveRecordingCaptureInput({
      userId: 'u1', sessionId: 'session-1', title: '录音 15:05', segments: [], durationMs: 6000, state: 'completed', audioUploaded: true,
    });
    expect('transcriptSegments' in body.metadata).toBe(false);
    expect('segmentCount' in body.metadata).toBe(false);
    expect(body.metadata.audioUploaded).toBe(true);
    expect(body.normalizedText).toBeUndefined();
  });

  it('occurredAt 用开始时刻而不是结束时刻', () => {
    const startedAtMs = Date.UTC(2026, 8, 10, 7, 5, 0);
    const body = buildLiveRecordingCaptureInput({
      userId: 'u1', sessionId: 's', title: 't', segments: [], durationMs: 600_000, state: 'completed', startedAtMs,
    });
    expect(body.occurredAt).toBe(new Date(startedAtMs).toISOString());
  });

  it('旧数据没有 recordingState 视为已完成', () => {
    expect(readRecordingState(null)).toBe('completed');
    expect(readRecordingState({ recordingState: 'recording' })).toBe('recording');
    expect(readRecordingState({ recordingState: 'weird' })).toBe('completed');
  });

  it('检查点过期判定：缺时间戳一定过期；6 小时内不过期', () => {
    const now = Date.now();
    expect(isRecordingCheckpointStale(undefined, now)).toBe(true);
    expect(isRecordingCheckpointStale(new Date(now - 60_000), now)).toBe(false);
    expect(isRecordingCheckpointStale(new Date(now - UNFINISHED_RECORDING_AUTO_FINALIZE_MS - 1), now)).toBe(true);
    expect(isRecordingCheckpointStale(new Date(now - 5000).toISOString(), now)).toBe(false);
  });
});
