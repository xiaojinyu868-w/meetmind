'use client';

/**
 * useLessonDigest — 调用 /api/classroom/lesson-digest 获取结构化分段总结
 *
 * 缓存策略：同一 sessionId 只请求一次，结果存 ref。
 * 失败时返回 error 状态，UI 层可展示降级文案。
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { LessonDigest, DigestImageRef } from '@/lib/services/lesson-digest-service';
import type { TranscriptSegment } from '@/types';

interface UseLessonDigestParams {
  sessionId: string | null | undefined;
  segments: TranscriptSegment[];
  /** 课中拍的照片（有 capturedAtMs 锚点） */
  images?: DigestImageRef[];
  lessonTitle?: string;
  /** 是否启用（不在复习态时不请求） */
  enabled?: boolean;
}

interface UseLessonDigestReturn {
  digest: LessonDigest | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useLessonDigest({
  sessionId,
  segments,
  images = [],
  lessonTitle,
  enabled = true,
}: UseLessonDigestParams): UseLessonDigestReturn {
  const [digest, setDigest] = useState<LessonDigest | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchedKeyRef = useRef<string | null>(null);
  const inputRef = useRef({ segments, images, lessonTitle });
  inputRef.current = { segments, images, lessonTitle };
  const requestKey = sessionId && segments.length > 0
    ? [
        sessionId,
        segments.length,
        segments[0]?.id,
        segments.at(-1)?.id,
        segments.at(-1)?.endMs,
        images.map((image) => `${image.imageId}:${image.capturedAtMs ?? 'extra'}`).join(','),
        lessonTitle || '',
      ].join('|')
    : null;

  const fetchDigest = useCallback(async () => {
    if (!sessionId || !enabled || !requestKey) return;
    if (fetchedKeyRef.current === requestKey) return;
    fetchedKeyRef.current = requestKey;
    const input = inputRef.current;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/classroom/lesson-digest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          segments: input.segments,
          images: input.images,
          lessonTitle: input.lessonTitle,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch digest: ${response.status}`);
      }

      const data = await response.json();
      if (data.digest) {
        setDigest(data.digest);
      } else {
        throw new Error('No digest in response');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [sessionId, enabled, requestKey]);

  useEffect(() => {
    if (enabled && sessionId && segments.length > 0) {
      void fetchDigest();
    }
  }, [fetchDigest, enabled, sessionId, segments.length]);

  const refetch = useCallback(() => {
    fetchedKeyRef.current = null;
    void fetchDigest();
  }, [fetchDigest]);

  return { digest, loading, error, refetch };
}
