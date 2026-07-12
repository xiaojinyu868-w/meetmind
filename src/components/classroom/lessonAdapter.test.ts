import { describe, expect, it } from 'vitest';
import { audioSessionToLesson } from './lessonAdapter';
import type { AudioSession } from '@/lib/db/schema';

function session(overrides: Partial<AudioSession> = {}): AudioSession {
  return {
    sessionId: 'lesson-1',
    userId: 'u1',
    mimeType: 'audio/webm',
    duration: 55 * 60 * 1000,
    status: 'completed',
    sourceType: 'recording',
    createdAt: new Date('2026-05-24T10:00:00Z'),
    updatedAt: new Date('2026-05-24T10:10:00Z'),
    ...overrides,
  };
}

describe('audioSessionToLesson transcription state', () => {
  it('marks a failed transcript session as failed instead of leaving it processing forever', () => {
    const lesson = audioSessionToLesson(
      session({ transcriptionStatus: 'failed', transcriptionError: 'NetworkError: Failed to fetch' }),
      { hasTranscript: false }
    );

    expect(lesson.status).toBe('failed');
    expect(lesson.statusText).toBe('网络不稳，原声已保留');
  });

  it('treats old completed recordings without transcript as failed fallback after the grace window', () => {
    const lesson = audioSessionToLesson(
      session({
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        blob: new Blob(['audio'], { type: 'audio/webm' }),
      }),
      { hasTranscript: false }
    );

    expect(lesson.status).toBe('failed');
    expect(lesson.statusText).toBe('原声已保留');
  });

  it('stops claiming an empty stale session is still processing', () => {
    const lesson = audioSessionToLesson(
      session({
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        blob: undefined,
        mediaUrl: undefined,
      }),
      { hasTranscript: false },
    );

    expect(lesson.status).toBe('failed');
    expect(lesson.statusText).toBe('没有留下可用内容');
  });
});
