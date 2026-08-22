'use client';

/**
 * useLessonDigest — 调用 /api/classroom/lesson-digest 获取结构化分段总结
 *
 * 缓存策略：
 * - 组件内存：同一 requestKey 只请求一次（fetchedKeyRef）。
 * - IndexedDB（lessonDigests 表，按 sessionId 一份）：挂载时先读缓存，
 *   内容签名（转录段数 + 末段 endMs + 图片 id 集合）一致就直接复用，不打 LLM；
 *   签名变化才重新请求并覆盖缓存。
 * 失败时返回 error 状态，UI 层可展示降级文案。
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { LessonDigest, DigestImageRef } from '@/lib/services/lesson-digest-service';
import { getSessionLessonDigest, saveSessionLessonDigest } from '@/lib/db';
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
  const [resolvedDigest, setResolvedDigest] = useState<{
    requestKey: string;
    digest: LessonDigest;
  } | null>(null);
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
  // 内容签名：转录段数 + 末段 endMs + 图片 id 集合。用于判断缓存是否仍然有效。
  const contentSignature = sessionId && segments.length > 0
    ? [
        segments.length,
        segments.at(-1)?.endMs ?? 0,
        images.map((image) => image.imageId).sort().join(','),
      ].join('|')
    : null;
  const fetchDigest = useCallback(async () => {
    if (!sessionId || !enabled || !requestKey || !contentSignature) return;
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
        setResolvedDigest({ requestKey, digest: data.digest });
        // 持久化到 IndexedDB，下次打开同内容直接复用，不再请求 LLM。
        void saveSessionLessonDigest(sessionId, contentSignature, data.digest).catch(() => {});
      } else {
        throw new Error('No digest in response');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [sessionId, enabled, requestKey, contentSignature]);

  useEffect(() => {
    if (!enabled || !sessionId || segments.length === 0 || !requestKey || !contentSignature) return;
    if (fetchedKeyRef.current === requestKey) return;
    let cancelled = false;
    void (async () => {
      // 先查 IndexedDB 缓存：签名一致直接复用，不发请求。
      try {
        const cached = await getSessionLessonDigest(sessionId);
        if (cancelled) return;
        if (cached && cached.signature === contentSignature) {
          fetchedKeyRef.current = requestKey;
          setResolvedDigest({ requestKey, digest: cached.digest as LessonDigest });
          return;
        }
      } catch {
        // IndexedDB 不可用时静默回退到网络请求
      }
      if (!cancelled) void fetchDigest();
    })();
    return () => { cancelled = true; };
  }, [enabled, sessionId, segments.length, requestKey, contentSignature, fetchDigest]);

  const refetch = useCallback(() => {
    fetchedKeyRef.current = null;
    void fetchDigest();
  }, [fetchDigest]);

  const digest = resolvedDigest?.requestKey === requestKey
    ? resolvedDigest.digest
    : null;
  const waitingForDigest = Boolean(enabled && requestKey && !digest && !error);

  // 真实模型结果返回前保持整理态，不用前几句截断拼一版假标题再覆盖。
  return { digest, loading: loading || waitingForDigest, error, refetch };
}
