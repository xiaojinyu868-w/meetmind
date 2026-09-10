import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  upsertCaptureForUser: vi.fn(),
  captureFindMany: vi.fn(),
  captureUpdate: vi.fn(),
  segmentFindMany: vi.fn(),
  generateLessonUnderstanding: vi.fn(),
  applyLessonUnderstanding: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    workspaceCapture: { findMany: mocks.captureFindMany, update: mocks.captureUpdate },
    workspaceTranscriptSegment: { findMany: mocks.segmentFindMany },
  },
}));
vi.mock('@/lib/services/workspace-context-service', () => ({
  default: { upsertCaptureForUser: mocks.upsertCaptureForUser },
}));
vi.mock('@/lib/services/lesson-understanding-service', () => ({
  generateLessonUnderstanding: mocks.generateLessonUnderstanding,
  applyLessonUnderstanding: mocks.applyLessonUnderstanding,
}));
vi.mock('@/lib/services/lesson-title-service', () => ({
  isGenericLessonTitle: (title: string) => /^录音 \d{2}:\d{2}$/.test(title) || title === '课堂录音',
}));
vi.mock('@/lib/services/point-meter', () => ({
  runWithMeterContext: (_ctx: unknown, fn: () => unknown) => fn(),
}));

import {
  finalizeStaleRecordingCaptures,
  parseRecordingCheckpointBody,
  upsertRecordingCheckpoint,
} from './recording-checkpoint-service';

describe('parseRecordingCheckpointBody', () => {
  it('校验 sessionId 形状，清洗分段，heartbeat 不带分段', () => {
    expect(parseRecordingCheckpointBody(null)).toBeNull();
    expect(parseRecordingCheckpointBody({ sessionId: 'bad id with spaces' })).toBeNull();
    const parsed = parseRecordingCheckpointBody({
      sessionId: 'session-1789044036978',
      kind: 'checkpoint',
      durationMs: 65_216.7,
      startedAt: '2026-09-05T08:04:00.000Z',
      title: '录音 16:04',
      segments: [
        { id: 's1', text: ' 第一句 ', startMs: 0, endMs: 2000, confidence: 0.9 },
        { text: '', startMs: 0, endMs: 1 },
        'garbage',
        { text: '倒着的时间', startMs: 5000, endMs: 3000 },
      ],
    });
    expect(parsed).toEqual({
      sessionId: 'session-1789044036978',
      kind: 'checkpoint',
      durationMs: 65_217,
      startedAt: '2026-09-05T08:04:00.000Z',
      title: '录音 16:04',
      audioSource: undefined,
      segments: [
        { id: 's1', text: '第一句', startMs: 0, endMs: 2000, speakerId: undefined, confidence: 0.9, isFinal: true },
        { id: undefined, text: '倒着的时间', startMs: 5000, endMs: 5000, speakerId: undefined, confidence: undefined, isFinal: true },
      ],
    });
    expect(parseRecordingCheckpointBody({ sessionId: 'session-1', kind: 'heartbeat', durationMs: 10, segments: [{ text: 'x', startMs: 0, endMs: 1 }] })?.segments).toEqual([]);
  });
});

describe('upsertRecordingCheckpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.upsertCaptureForUser.mockResolvedValue({ capture: { id: 'cap-1', sourceKey: 'live:u1:session-1' } });
  });

  it('用稳定 sourceKey 写「录制中」capture，不带正文', async () => {
    const result = await upsertRecordingCheckpoint('u1', {
      sessionId: 'session-1',
      kind: 'checkpoint',
      durationMs: 60_000,
      startedAt: '2026-09-10T07:05:00.000Z',
      segments: [{ text: '第一句', startMs: 0, endMs: 2000 }],
    });
    expect(result).toEqual({ captureId: 'cap-1', sourceKey: 'live:u1:session-1' });
    const input = mocks.upsertCaptureForUser.mock.calls[0][1];
    expect(input.sourceKey).toBe('live:u1:session-1');
    expect(input.sourceType).toBe('live-audio');
    expect(input.normalizedText).toBeUndefined();
    expect(input.metadata.recordingState).toBe('recording');
    expect(input.metadata.checkpointKind).toBe('checkpoint');
    expect(input.metadata.transcriptSegments).toHaveLength(1);
    expect(input.occurredAt).toBe('2026-09-10T07:05:00.000Z');
  });
});

describe('finalizeStaleRecordingCaptures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.captureUpdate.mockResolvedValue({});
    mocks.generateLessonUnderstanding.mockResolvedValue(null);
  });

  it('只翻超过 6 小时没检查点的「录制中」，并保留其余 metadata', async () => {
    const now = Date.parse('2026-09-10T12:00:00.000Z');
    mocks.captureFindMany.mockResolvedValue([
      {
        id: 'fresh', title: '录音 11:50', userId: 'u1', occurredAt: new Date(now - 600_000), createdAt: new Date(now - 600_000),
        metadataJson: JSON.stringify({ sessionId: 's-fresh', recordingState: 'recording', checkpointAt: new Date(now - 60_000).toISOString() }),
      },
      {
        id: 'stale', title: '录音 03:00', userId: 'u1', occurredAt: new Date(now - 9 * 3600_000), createdAt: new Date(now - 9 * 3600_000),
        metadataJson: JSON.stringify({ sessionId: 's-stale', recordingState: 'recording', checkpointAt: new Date(now - 8 * 3600_000).toISOString(), evidenceAvailable: true }),
      },
    ]);
    mocks.segmentFindMany.mockResolvedValue([{ text: '这节课讲了什么' }, { text: '还讲了别的' }]);

    const finalized = await finalizeStaleRecordingCaptures({ workspaceId: 'w1', userId: 'u1', now });
    expect(finalized).toBe(1);
    expect(mocks.captureUpdate).toHaveBeenCalledTimes(1);
    const data = mocks.captureUpdate.mock.calls[0][0].data;
    const metadata = JSON.parse(data.metadataJson);
    expect(metadata).toMatchObject({ sessionId: 's-stale', recordingState: 'completed', finalizedBy: 'server-timeout', evidenceAvailable: true });
    expect(data.normalizedText).toBe('这节课讲了什么 还讲了别的');
  });
});
