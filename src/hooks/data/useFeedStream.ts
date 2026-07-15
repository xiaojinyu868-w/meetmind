'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import type { FeedItem } from '@/types';
import type { LearnerProfile, LearningContextState } from '@/types/user';
import type { WorkspaceCaptureMessage } from '@/types/page-types';
import { readFeedPreferences, type FeedPreference } from '@/lib/feed-preferences';

const FEED_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

interface FeedCacheEntry {
  signature: string;
  items: FeedItem[];
  generatedAt: string;
}

// ─── 类型定义 ────────────────────────────────────────────────

interface CapturePayload {
  id: string;
  title: string;
  normalizedText?: string | null;
  contentType?: string;
  occurredAt?: string | null;
  source?: {
    platformLabel?: string;
    author?: string;
    contentState?: 'received' | 'extracting' | 'complete' | 'partial' | 'link-only' | 'failed';
    completeness?: number;
  };
}

type CaptureSourcePayload = NonNullable<CapturePayload['source']>;

interface GenerateFeedRequest {
  mode: 'cross-course';
  workspaceId: string;
  captures: CapturePayload[];
  learnerProfile?: {
    bio?: { headline: string; detail?: string };
    goals?: Array<{ title: string; summary?: string }>;
  };
  notes?: Array<{ text: string; source: string }>;
  feedback?: FeedPreference[];
  learningContext?: {
    activeThread?: { title: string; intent?: string; lastSummary?: string; nextStep?: string };
    memories?: Array<{ title: string; detail?: string; kind?: string }>;
    recentActivities?: Array<{ title: string; detail?: string; kind?: string }>;
  };
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
  learningContext?: LearningContextState;
}

interface UseFeedStreamReturn {
  /** 信息流条目 */
  items: FeedItem[];
  /** 是否正在生成 */
  isLoading: boolean;
  /** 错误信息 */
  error: Error | null;
  /** 有旧内容时的静默刷新态 */
  isRefreshing: boolean;
  /** 上次成功生成时间 */
  generatedAt: string | null;
  /** 缓存是否已过期 */
  isStale: boolean;
  /** 当前工作区缓存已完成恢复 */
  cacheReady: boolean;
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
  learningContext,
}: UseFeedStreamOptions): UseFeedStreamReturn {
  const signature = buildFeedSignature(captures, learnerProfile, learningContext);
  const cacheKey = `${workspaceId}:${signature}`;
  const [items, setItems] = useState<FeedItem[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [readyCacheKey, setReadyCacheKey] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const cached = readFeedCache(workspaceId, signature);
    setItems(filterDismissedItems(cached?.items ?? []));
    setGeneratedAt(cached?.generatedAt ?? null);
    setReadyCacheKey(cacheKey);
  }, [workspaceId, signature, cacheKey]);

  const generate = useCallback(async () => {
    const hasLearningContext = Boolean(
      learningContext?.activeThread?.title
        || learningContext?.memories.length
        || learnerProfile?.goals?.some((goal) => !goal.status || goal.status === 'active'),
    );
    if (captures.length === 0 && !hasLearningContext) return;

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
        source: (() => {
          const provenance = c.metadata?.provenance;
          if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) return undefined;
          const value = provenance as Record<string, unknown>;
          return {
            platformLabel: typeof value.platformLabel === 'string' ? value.platformLabel : undefined,
            author: typeof value.author === 'string' ? value.author : undefined,
            contentState: typeof value.contentState === 'string'
              ? value.contentState as CaptureSourcePayload['contentState']
              : undefined,
            completeness: typeof value.completeness === 'number' ? value.completeness : undefined,
          };
        })(),
      }));

      const requestBody: GenerateFeedRequest = {
        mode: 'cross-course',
        workspaceId,
        captures: capturesPayload,
        learnerProfile: profilePayload,
        notes,
        feedback: readFeedPreferences(),
        learningContext: learningContext ? {
          activeThread: learningContext.activeThread?.status === 'active'
            ? {
                title: learningContext.activeThread.title,
                intent: learningContext.activeThread.intent,
                lastSummary: learningContext.activeThread.lastSummary,
                nextStep: learningContext.activeThread.nextStep,
              }
            : undefined,
          memories: learningContext.memories
            .filter((memory) => memory.status === 'active')
            .slice(-8)
            .map(({ title, detail, kind }) => ({ title, detail, kind })),
          recentActivities: learningContext.recentActivities
            .slice(-6)
            .map(({ title, detail, kind }) => ({ title, detail, kind })),
        } : undefined,
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

      const nextItems = data.items ?? [];
      const nextGeneratedAt = new Date().toISOString();
      setItems(nextItems);
      setGeneratedAt(nextGeneratedAt);
      writeFeedCache(workspaceId, {
        signature,
        items: nextItems,
        generatedAt: nextGeneratedAt,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId, captures, learnerProfile, notes, accessToken, signature, learningContext]);

  const isStale = !generatedAt || Date.now() - new Date(generatedAt).getTime() > FEED_CACHE_TTL_MS;
  return {
    items,
    isLoading,
    isRefreshing: isLoading && items.length > 0,
    generatedAt,
    isStale,
    cacheReady: readyCacheKey === cacheKey,
    error,
    generate,
  };
}

export function buildFeedSignature(
  captures: WorkspaceCaptureMessage[],
  learnerProfile?: LearnerProfile | null,
  learningContext?: LearningContextState,
): string {
  const capturePart = captures.slice(0, 20).map((capture) => (
    `${capture.id}:${capture.occurredAt ?? capture.createdAt}:${capture.normalizedText?.length ?? 0}:${JSON.stringify(capture.metadata?.provenance ?? null)}`
  )).join('|');
  const goalPart = (learnerProfile?.goals ?? [])
    .filter((goal) => !goal.status || goal.status === 'active')
    .map((goal) => `${goal.title}:${goal.summary ?? ''}`)
    .join('|');
  const learningPart = [
    learningContext?.activeThread?.status === 'active'
      ? `${learningContext.activeThread.title}:${learningContext.activeThread.updatedAt}`
      : '',
    ...(learningContext?.memories ?? []).filter((memory) => memory.status === 'active').slice(-8)
      .map((memory) => `${memory.id}:${memory.updatedAt}`),
    ...(learningContext?.recentActivities ?? []).slice(-6)
      .map((activity) => `${activity.id}:${activity.occurredAt}`),
  ].join('|');
  return `${capturePart}::${goalPart}::${learningPart}`;
}

function readFeedCache(workspaceId: string, signature: string): FeedCacheEntry | null {
  if (typeof window === 'undefined' || !workspaceId) return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(`meetmind-feed-cache:${workspaceId}`) || 'null') as FeedCacheEntry | null;
    return parsed?.signature === signature && Array.isArray(parsed.items) ? parsed : null;
  } catch {
    return null;
  }
}

function writeFeedCache(workspaceId: string, value: FeedCacheEntry): void {
  if (typeof window === 'undefined' || !workspaceId) return;
  try {
    window.localStorage.setItem(`meetmind-feed-cache:${workspaceId}`, JSON.stringify(value));
  } catch {
    // 缓存不可用时不影响主流程。
  }
}

function filterDismissedItems(items: FeedItem[]): FeedItem[] {
  const dismissed = new Set(
    readFeedPreferences()
      .filter((preference) => preference.rating === 'down')
      .map((preference) => `${preference.type}:${preference.title}`),
  );
  return items.filter((item) => !dismissed.has(`${item.type}:${item.title}`));
}
