'use client';

/**
 * useLessonDigest — 调用 /api/classroom/lesson-digest 获取结构化分段总结
 *
 * 缓存策略：同一 sessionId 只请求一次，结果存 ref。
 * 失败时返回 error 状态，UI 层可展示降级文案。
 */

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
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
  const previewDigest = useMemo(
    () => requestKey ? buildLessonDigestPreview(segments, images, lessonTitle) : null,
    [requestKey, segments, images, lessonTitle],
  );

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
        setResolvedDigest({ requestKey, digest: data.digest });
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

  const digest = resolvedDigest?.requestKey === requestKey
    ? resolvedDigest.digest
    : previewDigest;

  // 有真实转录形成的即时笔记时，不用 loading 挡住内容；模型结果在后台静默替换。
  return { digest, loading: loading && !digest, error, refetch };
}

/**
 * 不调用模型，只把已有转录按自然顺序整理成可立即阅读的课堂笔记。
 * 它既是首屏预览，也是网络失败时的有根降级，不生成转录里不存在的结论。
 */
export function buildLessonDigestPreview(
  segments: TranscriptSegment[],
  images: DigestImageRef[] = [],
  lessonTitle?: string,
): LessonDigest | null {
  const usableSegments = segments
    .filter((segment) => Boolean(segment.text?.trim()))
    .sort((a, b) => a.startMs - b.startMs);
  if (usableSegments.length === 0) return null;

  const sectionCount = Math.min(4, Math.max(1, Math.ceil(usableSegments.length / 8)));
  const sectionSize = Math.ceil(usableSegments.length / sectionCount);
  const sections = Array.from({ length: sectionCount }, (_, index) => {
    const sectionSegments = usableSegments.slice(index * sectionSize, (index + 1) * sectionSize);
    if (sectionSegments.length === 0) return null;
    const startMs = sectionSegments[0].startMs;
    const endMs = sectionSegments.at(-1)?.endMs ?? startMs;
    const text = compactDigestText(sectionSegments.map((segment) => segment.text).join(' '), 260);
    const anchoredImage = images.find((image) => (
      image.capturedAtMs !== null
      && image.capturedAtMs >= startMs
      && image.capturedAtMs <= endMs
    ));
    return {
      heading: deriveDigestHeading(text),
      text,
      imageId: anchoredImage?.imageId,
      startMs,
      endMs,
    };
  }).filter((section): section is NonNullable<typeof section> => Boolean(section));

  const completeText = usableSegments.map((segment) => segment.text).join(' ');
  return {
    title: lessonTitle?.trim() || '课堂笔记',
    overview: compactDigestText(completeText, 100),
    sections,
    extras: images
      .filter((image) => image.capturedAtMs === null)
      .map((image) => ({ text: image.title?.trim() || '课后补充照片', imageId: image.imageId })),
  };
}

function compactDigestText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).trimEnd()}…`;
}

function deriveDigestHeading(text: string): string {
  const firstClause = text
    .split(/[。！？!?；;\n]/, 1)[0]
    .replace(/^(?:嗯|呃|然后|接下来|那么)[，,\s]*/u, '')
    .trim();
  const groundedHeading = firstClause || text;
  return compactDigestText(groundedHeading, 18);
}
