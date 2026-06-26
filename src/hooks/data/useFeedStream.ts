'use client';

import { useState, useCallback, useRef } from 'react';
import type { TranscriptSegment, FeedItem } from '@/types';
import type { LearnerProfile } from '@/types/user';

// ─── 类型定义 ────────────────────────────────────────────────

interface GenerateFeedRequest {
  sessionId: string;
  transcript: Array<{
    id: string;
    text: string;
    startMs: number;
    endMs: number;
  }>;
  learnerProfile?: {
    bio?: { headline: string; detail?: string };
    goals?: Array<{ title: string; summary?: string }>;
  };
  notes?: Array<{ text: string; source: string }>;
  confusions?: Array<{ text: string; timestampLabel?: string }>;
  sessionInfo?: {
    subject?: string;
    topic?: string;
  };
}

interface GenerateFeedResponse {
  success: boolean;
  items?: FeedItem[];
  error?: string;
}

interface UseFeedStreamOptions {
  sessionId: string;
  segments: TranscriptSegment[];
  learnerProfile?: LearnerProfile | null;
  notes?: Array<{ text: string; source: string }>;
  confusions?: Array<{ text: string; timestampLabel?: string }>;
  sessionInfo?: {
    subject?: string;
    topic?: string;
  };
}

interface UseFeedStreamReturn {
  /** 信息流条目 */
  items: FeedItem[];
  /** 是否正在生成 */
  isLoading: boolean;
  /** 错误信息 */
  error: Error | null;
  /** 生成信息流 */
  generate: () => Promise<void>;
}

// ─── Hook 实现 ────────────────────────────────────────────────

export function useFeedStream({
  sessionId,
  segments,
  learnerProfile,
  notes,
  confusions,
  sessionInfo,
}: UseFeedStreamOptions): UseFeedStreamReturn {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const generate = useCallback(async () => {
    if (segments.length === 0) return;

    // 取消上一次未完成的请求
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setError(null);

    try {
      // 提取 learnerProfile 里的 bio + goals
      const profilePayload: GenerateFeedRequest['learnerProfile'] = learnerProfile
        ? {
            bio: learnerProfile.bio?.headline
              ? {
                  headline: learnerProfile.bio.headline,
                  detail: learnerProfile.bio.detail,
                }
              : undefined,
            goals: learnerProfile.goals
              ?.filter((g) => !g.status || g.status === 'active')
              .slice(0, 3)
              .map((g) => ({ title: g.title, summary: g.summary })),
          }
        : undefined;

      const requestBody: GenerateFeedRequest = {
        sessionId,
        transcript: segments.map((s) => ({
          id: String(s.id),
          text: s.text,
          startMs: s.startMs,
          endMs: s.endMs,
        })),
        learnerProfile: profilePayload,
        notes,
        confusions,
        sessionInfo,
      };

      const res = await fetch('/api/feed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      const data: GenerateFeedResponse = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || '生成信息流失败');
      }

      setItems(data.items ?? []);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, segments, learnerProfile, notes, confusions, sessionInfo]);

  return { items, isLoading, error, generate };
}
