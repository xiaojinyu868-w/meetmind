import { expect, test } from '@playwright/test';
import type { AudioSession } from '../../src/lib/db';
import { buildStoredVideoSource, isStoredVideoFileSession, isStoredVideoSession } from '../../src/lib/capture/video-session';

function makeSession(overrides: Partial<AudioSession> = {}): AudioSession {
  return {
    sessionId: 'session-1',
    userId: 'anonymous',
    mimeType: 'video/mp4',
    duration: 92_000,
    sourceType: 'video-file',
    status: 'completed',
    createdAt: new Date('2026-03-14T10:00:00.000Z'),
    updatedAt: new Date('2026-03-14T10:00:00.000Z'),
    ...overrides,
  };
}

test.describe('video session utils', () => {
  test('recognizes uploaded video sessions, including legacy upload rows', async () => {
    expect(isStoredVideoFileSession(makeSession())).toBeTruthy();
    expect(isStoredVideoSession(makeSession())).toBeTruthy();

    expect(
      isStoredVideoFileSession(
        makeSession({
          sourceType: 'upload',
          mimeType: 'video/webm',
        })
      )
    ).toBeTruthy();

    expect(
      isStoredVideoSession(
        makeSession({
          sourceType: 'upload',
          mimeType: 'audio/webm',
        })
      )
    ).toBeFalsy();
  });

  test('builds direct-file video source for uploaded video review', async () => {
    const source = buildStoredVideoSource(
      makeSession({
        sourceType: 'video-file',
        mediaUrl: 'blob:local-video',
        topic: '函数单调性课堂视频',
      }),
      { playableUrl: 'blob:local-video' }
    );

    expect(source).not.toBeNull();
    expect(source).toMatchObject({
      provider: 'direct-file',
      providerLabel: '视频文件',
      originalUrl: 'blob:local-video',
      playableUrl: 'blob:local-video',
      title: '函数单调性课堂视频',
      sourceMode: 'direct',
    });
  });
});
