import { describe, expect, it } from 'vitest';
import type { AudioSession } from '@/lib/db/schema';
import { isPendingCaptureSync, isPendingRecordingUpload } from './retry-pending-recording-uploads';

function session(partial: Partial<AudioSession> = {}): AudioSession {
  return {
    sessionId: 'session-1',
    userId: 'user-1',
    blob: new Blob([new Uint8Array(9 * 1024)]),
    mimeType: 'audio/webm',
    duration: 60_000,
    sourceType: 'recording',
    status: 'completed',
    createdAt: new Date('2026-07-16T00:00:00.000Z'),
    updatedAt: new Date('2026-07-16T00:01:00.000Z'),
    ...partial,
  };
}

describe('isPendingRecordingUpload', () => {
  it('完成且仍只有本地 Blob URL 的录音需要重试', () => {
    expect(isPendingRecordingUpload(session({ mediaUrl: 'blob:local-audio' }))).toBe(true);
    expect(isPendingRecordingUpload(session({ mediaUrl: undefined }))).toBe(true);
    expect(isPendingRecordingUpload(session({ sourceType: undefined }))).toBe(true);
  });

  it('已有稳定地址、非录音来源或仍在录制时不上传', () => {
    expect(isPendingRecordingUpload(session({ mediaUrl: '/api/workspace/audio/user/session.webm' }))).toBe(false);
    expect(isPendingRecordingUpload(session({ sourceType: 'video-link' }))).toBe(false);
    expect(isPendingRecordingUpload(session({ status: 'recording' }))).toBe(false);
  });

  it('过小的静音 Blob 不进入上传队列', () => {
    expect(isPendingRecordingUpload(session({ blob: new Blob(['tiny']) }))).toBe(false);
  });
});

describe('isPendingCaptureSync（结束时写服务端失败的课要补传）', () => {
  const now = Date.parse('2026-09-10T12:00:00.000Z');

  it('failed 立刻重试；pending 卡住超过 60s 才重试；synced / 访客旧数据不动', () => {
    expect(isPendingCaptureSync(session({ syncState: 'failed' }), now)).toBe(true);
    expect(isPendingCaptureSync(session({ syncState: 'pending', updatedAt: new Date(now - 5_000) }), now)).toBe(false);
    expect(isPendingCaptureSync(session({ syncState: 'pending', updatedAt: new Date(now - 120_000) }), now)).toBe(true);
    expect(isPendingCaptureSync(session({ syncState: 'synced' }), now)).toBe(false);
    expect(isPendingCaptureSync(session({ syncState: undefined }), now)).toBe(false);
  });

  it('还在录 / 没结束的课不在补传队列里（由恢复链路处理）', () => {
    expect(isPendingCaptureSync(session({ syncState: 'failed', status: 'recording' }), now)).toBe(false);
  });
});
