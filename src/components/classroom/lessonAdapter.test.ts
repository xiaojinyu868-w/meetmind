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
  it('uses grounded lesson evidence instead of exposing a URL or timestamp as the title', () => {
    const lesson = audioSessionToLesson(
      session({ topic: 'https://www.bilibili.com/video/BV123', sourceType: 'video-link' }),
      {
        hasTranscript: true,
        titleEvidence: {
          transcriptPreview: '同学们大家好。今天我们来学习 特征值与特征向量，以及它们的几何意义。',
        },
      },
    );

    expect(lesson.title).toBe('特征值与特征向量，以及它们的几何意义');
  });

  it('prefers a reviewed highlight title and keeps time out of the title', () => {
    const lesson = audioSessionToLesson(
      session({ topic: '10:30' }),
      {
        hasTranscript: true,
        titleEvidence: {
          highlightTitles: ['贝叶斯公式的直觉'],
          summaryOverview: '这节课讲条件概率。',
        },
      },
    );

    expect(lesson.title).toBe('贝叶斯公式的直觉');
    expect(lesson.title).not.toContain(lesson.time);
  });

  it('falls back to a truthful source label when no content evidence exists', () => {
    const lesson = audioSessionToLesson(session({ topic: '课堂录音' }), { hasTranscript: false });
    expect(lesson.title).toBe('课堂录音');
  });

  it('does not mistake a casual transcript fragment for a lesson title', () => {
    const lesson = audioSessionToLesson(session({ topic: '课堂录音' }), {
      hasTranscript: true,
      titleEvidence: {
        transcriptPreview: '但是很少，因为我比较内向，不太参加那种。那还得家庭条件跟得上。',
      },
    });

    expect(lesson.title).toBe('课堂录音');
  });

  it('marks a failed transcript session as failed instead of leaving it processing forever', () => {
    const lesson = audioSessionToLesson(
      session({ transcriptionStatus: 'failed', transcriptionError: 'NetworkError: Failed to fetch' }),
      { hasTranscript: false }
    );

    expect(lesson.status).toBe('failed');
    expect(lesson.statusText).toBe('网络不稳，原声已保留');
  });

  it('keeps a pending final pass in processing even when realtime draft text exists', () => {
    const result = audioSessionToLesson(
      session({ transcriptionStatus: 'pending' }),
      {
        hasTranscript: true,
        titleEvidence: { transcriptPreview: '前面几句话形成的临时标题不应发布' },
      },
    );

    expect(result.status).toBe('processing');
    expect(result.title).toBe('课堂录音');
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
