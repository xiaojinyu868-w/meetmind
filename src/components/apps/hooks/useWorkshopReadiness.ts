'use client';

import { useEffect, useState } from 'react';
import type { WorkshopReadinessAssessment } from '@/lib/ai-native/types';
import { fallbackWorkshopReadiness } from '@/lib/ai-native/workshop-readiness';
import type { TranscriptSegment } from '@/types';

interface UseWorkshopReadinessInput {
  transcript: TranscriptSegment[];
  contextTitle?: string;
  contextType?: string;
  activeAnchorCount: number;
  keyDifficulties?: string[];
  summary?: string;
}

interface ReadinessApiResponse {
  ok?: boolean;
  assessment?: WorkshopReadinessAssessment;
}

const readinessRequestCache = new Map<string, Promise<WorkshopReadinessAssessment>>();
const MAX_READINESS_CACHE_ENTRIES = 24;

function requestWorkshopReadiness(
  cacheKey: string,
  input: UseWorkshopReadinessInput,
): Promise<WorkshopReadinessAssessment> {
  const cached = readinessRequestCache.get(cacheKey);
  if (cached) return cached;

  const request = (async () => {
    const response = await fetch('/api/apps/readiness', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript: input.transcript.map((segment) => ({
          id: segment.id,
          text: segment.text,
          startMs: segment.startMs,
          endMs: segment.endMs,
        })),
        contextTitle: input.contextTitle,
        contextType: input.contextType,
        activeAnchorCount: input.activeAnchorCount,
        keyDifficulties: input.keyDifficulties,
        summary: input.summary,
      }),
    });
    const data = await response.json().catch(() => null) as (ReadinessApiResponse & { error?: unknown }) | null;
    if (!response.ok || !data?.ok || !data.assessment) {
      throw new Error(`ASSESSMENT_FAILED:${response.status}:${String(data?.error ?? '')}`);
    }
    return data.assessment;
  })();

  readinessRequestCache.set(cacheKey, request);
  if (readinessRequestCache.size > MAX_READINESS_CACHE_ENTRIES) {
    const oldest = readinessRequestCache.keys().next().value;
    if (oldest) readinessRequestCache.delete(oldest);
  }
  void request.catch(() => readinessRequestCache.delete(cacheKey));
  return request;
}

export function buildWorkshopReadinessSignature(input: UseWorkshopReadinessInput): string {
  let characterCount = 0;
  let rollingHash = 2166136261;
  const mix = (value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      rollingHash ^= value.charCodeAt(index);
      rollingHash = Math.imul(rollingHash, 16777619);
    }
  };

  for (const segment of input.transcript) {
    const text = segment.text.trim();
    characterCount += text.length;
    mix(`${segment.id ?? ''}:${segment.startMs}:${segment.endMs}:${text}`);
  }
  for (const difficulty of input.keyDifficulties ?? []) mix(difficulty.trim());
  mix(input.summary?.trim() ?? '');
  mix(input.contextTitle?.trim() ?? '');
  mix(input.contextType?.trim() ?? '');

  const last = input.transcript[input.transcript.length - 1];
  return `${input.transcript.length}:${last?.endMs ?? 0}:${characterCount}:${input.activeAnchorCount}:${rollingHash >>> 0}`;
}

export function useWorkshopReadiness(input: UseWorkshopReadinessInput) {
  const { transcript } = input;
  const [assessment, setAssessment] = useState<WorkshopReadinessAssessment | null>(() => (
    transcript.length > 0 ? fallbackWorkshopReadiness(input) : null
  ));
  const [isAssessing, setIsAssessing] = useState(transcript.length > 0);
  const [failed, setFailed] = useState(false);

  // IndexedDB 回填会在部分旧链路里原地填充同一个数组；这里必须按内容计算，
  // 不能依赖 transcript 的引用身份，否则真实转录到达后 readiness 不会运行。
  const signature = buildWorkshopReadinessSignature(input);
  const contentSignature = buildWorkshopReadinessSignature({
    transcript,
    activeAnchorCount: 0,
    contextTitle: input.contextTitle,
    contextType: input.contextType,
  });

  useEffect(() => {
    if (transcript.length === 0) {
      setAssessment(null);
      setIsAssessing(false);
      setFailed(false);
      return undefined;
    }

    let cancelled = false;
    const safeFallback = fallbackWorkshopReadiness(input);
    setAssessment(safeFallback);
    setIsAssessing(true);
    setFailed(false);

    const run = async () => {
      try {
        const nextAssessment = await requestWorkshopReadiness(contentSignature, input);
        if (!cancelled) setAssessment(nextAssessment);
      } catch {
        if (!cancelled) {
          setAssessment(safeFallback);
          setFailed(true);
        }
      } finally {
        if (!cancelled) setIsAssessing(false);
      }
    };

    void run();
    return () => { cancelled = true; };
    // signature captures the meaningful transcript change without depending on a new array identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, contentSignature]);

  return { assessment, isAssessing, failed };
}
