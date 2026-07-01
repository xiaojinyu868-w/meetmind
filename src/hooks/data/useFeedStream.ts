'use client';

import { useState, useCallback, useRef } from 'react';
import type { FeedItem } from '@/types';
import type { LearnerProfile } from '@/types/user';
import type { WorkspaceCaptureMessage } from '@/types/page-types';

// ─── 类型定义 ────────────────────────────────────────────────

interface CapturePayload {
  id: string;
  title: string;
  normalizedText?: string | null;
  contentType?: string;
  occurredAt?: string | null;
}

interface GenerateFeedRequest {
  mode: 'cross-course';
  workspaceId: string;
  captures: CapturePayload[];
  learnerProfile?: {
    bio?: { headline: string; detail?: string };
    goals?: Array<{ title: string; summary?: string }>;
  };
  notes?: Array<{ text: string; source: string }>;
}

interface GenerateFeedResponse {
  success: boolean;
  items?: FeedItem[];
  error?: string;
}

interface UseFeedStreamOptions {
  workspaceId: string;
  captures: WorkspaceCaptureMessage[];
  learnerProfile?: LearnerProfile | null;
  notes?: Array<{ text: string; source: string }>;
  accessToken?: string | null;
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
  workspaceId,
  captures,
  learnerProfile,
  notes,
  accessToken,
}: UseFeedStreamOptions): UseFeedStreamReturn {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const generate = useCallback(async () => {
    if (captures.length === 0) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setError(null);

    try {
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

      const capturesPayload: CapturePayload[] = captures.map((c) => ({
        id: c.id,
        title: c.title,
        normalizedText: c.normalizedText,
        contentType: c.contentType,
        occurredAt: c.occurredAt ?? c.createdAt,
      }));

      const requestBody: GenerateFeedRequest = {
        mode: 'cross-course',
        workspaceId,
        captures: capturesPayload,
        learnerProfile: profilePayload,
        notes,
      };

      const res = await fetch('/api/feed', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
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
  }, [workspaceId, captures, learnerProfile, notes, accessToken]);

  return { items, isLoading, error, generate };
}