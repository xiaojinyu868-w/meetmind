import { describe, expect, it } from 'vitest';
import type { AudioSession } from '@/lib/db/schema';
import { isPendingRecordingUpload } from './retry-pending-recording-uploads';

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
