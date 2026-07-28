'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { Anchor, TranscriptSegment } from '@/types';
import type { AppExecutionResult, ContextPack, DataSourceType } from '@/lib/ai-native/types';
import type { WorkshopAppCatalogItem } from '@/lib/ai-native/app-catalog';
import { useAuth } from '@/lib/hooks/useAuth';
import { COPY } from '@/lib/ui/copy';

export type AppTaskStatus = 'idle' | 'running' | 'success' | 'error';

export interface AppTaskState {
  status: AppTaskStatus;
  updatedAt: number;
  error?: string;
}

export const APP_RESULT_CACHE_PREFIX = 'app_workspace_result:';
export const APP_TASK_CACHE_PREFIX = 'app_workspace_task:';

function parseClientTimeoutMs(
  envValue: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number.parseInt(envValue || '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

const APP_EXEC_TIMEOUT_DEFAULT_MS = parseClientTimeoutMs(
  process.env.NEXT_PUBLIC_APP_EXEC_TIMEOUT_MS,
  180 * 1000,
  30 * 1000,
  10 * 60 * 1000
);
const APP_EXEC_TIMEOUT_PODCAST_MS = parseClientTimeoutMs(
  process.env.NEXT_PUBLIC_APP_EXEC_PODCAST_TIMEOUT_MS,
  300 * 1000,
  60 * 1000,
  15 * 60 * 1000
);
export const APP_RUNNING_TASK_STALE_MS = parseClientTimeoutMs(
  process.env.NEXT_PUBLIC_APP_RUNNING_STALE_MS,
  420 * 1000,
  120 * 1000,
  20 * 60 * 1000
);

function safeJsonParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function buildResultCacheKey(sessionId: string, appKey: string): string {
  return `${APP_RESULT_CACHE_PREFIX}${sessionId}:${appKey}`;
}

export function buildTaskCacheKey(sessionId: string, appKey: string): string {
  return `${APP_TASK_CACHE_PREFIX}${sessionId}:${appKey}`;
}

export function readCachedAppResult(sessionId: string, appKey: string): AppExecutionResult | null {
  if (typeof window === 'undefined') return null;
  return safeJsonParse<AppExecutionResult>(window.localStorage.getItem(buildResultCacheKey(sessionId, appKey)));
}

export function readCachedTaskState(sessionId: string, appKey: string): AppTaskState | null {
  if (typeof window === 'undefined') return null;
  const state = safeJsonParse<AppTaskState>(window.localStorage.getItem(buildTaskCacheKey(sessionId, appKey)));
  if (!state) return null;

  if (state.status === 'running' && Date.now() - state.updatedAt > APP_RUNNING_TASK_STALE_MS) {
    const timeoutState: AppTaskState = {
      status: 'error',
      updatedAt: Date.now(),
      error: '后台任务超时，请点击“重试”重新生成。',
    };
    window.localStorage.setItem(buildTaskCacheKey(sessionId, appKey), JSON.stringify(timeoutState));
    return timeoutState;
  }

  return state;
}

/** Max number of cached app results to keep (LRU eviction). */
const MAX_CACHED_RESULTS = 30;
const CACHE_INDEX_KEY = 'app_workspace_cache_index';
const MAX_CACHED_RESULT_CHARS = 1_000_000;
const LARGE_DATA_URL_CHARS = 120_000;

function isLargeInlineDataUrl(value: string): boolean {
  return value.length >= LARGE_DATA_URL_CHARS && value.startsWith('data:') && value.includes(';base64,');
}

function stripLargeInlineData<T>(value: T): T {
  if (typeof value === 'string') {
    return (isLargeInlineDataUrl(value) ? '' : value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => stripLargeInlineData(item)) as T;
  }

  if (value && typeof value === 'object') {
    const next: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      next[key] = stripLargeInlineData(child);
    }
    return next as T;
  }

  return value;
}

/** Read LRU index: ordered list of cache keys (oldest first). */
function readCacheIndex(): string[] {
  try {
    const raw = window.localStorage.getItem(CACHE_INDEX_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

/** Persist LRU index. */
function writeCacheIndex(index: string[]): void {
  try {
    window.localStorage.setItem(CACHE_INDEX_KEY, JSON.stringify(index));
  } catch { /* ignore */ }
}

/** Touch a key in the LRU index (move to end = most recent). Evict oldest if over limit. */
function touchCacheKey(key: string): void {
  const index = readCacheIndex().filter((k) => k !== key);
  index.push(key);

  // Evict oldest entries if over limit
  while (index.length > MAX_CACHED_RESULTS) {
    const evicted = index.shift();
    if (evicted) {
      try {
        window.localStorage.removeItem(evicted);
        // Also remove the corresponding task state
        const taskKey = evicted.replace(APP_RESULT_CACHE_PREFIX, APP_TASK_CACHE_PREFIX);
        window.localStorage.removeItem(taskKey);
      } catch { /* ignore */ }
    }
  }

  writeCacheIndex(index);
}

function removeCacheEntry(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
  const index = readCacheIndex().filter((k) => k !== key);
  writeCacheIndex(index);
}

/** Safe localStorage.setItem with QuotaExceeded fallback (evict oldest, retry). */
function safeSetItem(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch (err) {
    if (err instanceof DOMException && (err.name === 'QuotaExceededError' || err.code === 22)) {
      // Emergency eviction: remove the 5 oldest cached results
      const index = readCacheIndex();
      for (let i = 0; i < 5 && index.length > 0; i++) {
        const evicted = index.shift();
        if (evicted) {
          try {
            window.localStorage.removeItem(evicted);
            const taskKey = evicted.replace(APP_RESULT_CACHE_PREFIX, APP_TASK_CACHE_PREFIX);
            window.localStorage.removeItem(taskKey);
          } catch { /* ignore */ }
        }
      }
      writeCacheIndex(index);
      try {
        window.localStorage.setItem(key, value);
      } catch { /* give up silently */ }
    }
  }
}

export function writeCachedAppResult(sessionId: string, appKey: string, result: AppExecutionResult): void {
  if (typeof window === 'undefined') return;
  const key = buildResultCacheKey(sessionId, appKey);

  try {
    const sanitized = stripLargeInlineData(result);
    const serialized = JSON.stringify(sanitized);

    // Guard against giant payloads (e.g. base64 images) blocking localStorage writes.
    if (serialized.length > MAX_CACHED_RESULT_CHARS) {
      removeCacheEntry(key);
      return;
    }

    safeSetItem(key, serialized);
    touchCacheKey(key);
  } catch {
    removeCacheEntry(key);
  }
}

export function writeCachedTaskState(sessionId: string, appKey: string, state: AppTaskState): void {
  if (typeof window === 'undefined') return;
  safeSetItem(buildTaskCacheKey(sessionId, appKey), JSON.stringify(state));
}

function nowTaskState(status: AppTaskStatus, error?: string): AppTaskState {
  return {
    status,
    updatedAt: Date.now(),
    ...(error ? { error } : {}),
  };
}

function resolveExecuteTimeoutMs(appKey: string): number {
  return appKey === 'audio-overview' ? APP_EXEC_TIMEOUT_PODCAST_MS : APP_EXEC_TIMEOUT_DEFAULT_MS;
}

/**
 * Strip transcript segments to only essential fields for the API request,
 * reducing HTTP payload size significantly for long sessions.
 */
function slimTranscript(
  segments: TranscriptSegment[]
): TranscriptSegment[] {
  return segments.map((s) => ({
    id: s.id,
    text: s.text,
    startMs: s.startMs,
    endMs: s.endMs,
    confidence: s.confidence ?? 1,
    isFinal: s.isFinal ?? true,
  }));
}

function slimContextPack(pack: ContextPack): ContextPack {
  return {
    ...pack,
    lessons: pack.lessons.map((lesson) => ({
      ...lesson,
      transcript: slimTranscript(lesson.transcript),
    })),
  };
}

interface UseAppExecutionParams {
  app: WorkshopAppCatalogItem;
  sessionId: string;
  dataSource: DataSourceType;
  transcript: TranscriptSegment[];
  anchors: Anchor[];
  summaryOverview?: string;
  keyDifficulties?: string[];
  terminologyHint?: string;
  contextTitle?: string;
  model?: string;
  autoRun?: boolean;
  /** 跨课 / 考试学习对象；存在时 API 不再使用单课 input。 */
  contextPack?: ContextPack;
}

export interface UseAppExecutionReturn {
  result: AppExecutionResult | null;
  taskState: AppTaskState;
  isRunning: boolean;
  hasResult: boolean;
  execute: () => Promise<AppExecutionResult | null>;
  rerun: () => Promise<AppExecutionResult | null>;
  updateResult: (next: AppExecutionResult) => void;
}

export function useAppExecution(params: UseAppExecutionParams): UseAppExecutionReturn {
  const {
    app,
    sessionId,
    dataSource,
    transcript,
    anchors,
    summaryOverview,
    keyDifficulties,
    terminologyHint,
    contextTitle,
    model,
    autoRun = true,
    contextPack,
  } = params;
  const { accessToken } = useAuth();
  const [result, setResult] = useState<AppExecutionResult | null>(null);
  const [taskState, setTaskState] = useState<AppTaskState>(() => nowTaskState('idle'));
  const [hydrated, setHydrated] = useState(false);

  const syncFromCache = useCallback(() => {
    const cachedResult = readCachedAppResult(sessionId, app.key);
    const cachedTask = readCachedTaskState(sessionId, app.key);
    // Changing a multi-lesson scope changes this cache key. Explicitly clear
    // the prior scope so its result never flashes under the new selection.
    setResult(cachedResult);
    setTaskState(cachedTask ?? nowTaskState('idle'));
  }, [app.key, sessionId]);

  useEffect(() => {
    syncFromCache();
    setHydrated(true);
  }, [syncFromCache]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const resultKey = buildResultCacheKey(sessionId, app.key);
    const taskKey = buildTaskCacheKey(sessionId, app.key);

    const onStorage = (event: StorageEvent) => {
      if (!event.key) return;
      if (event.key !== resultKey && event.key !== taskKey) return;
      syncFromCache();
    };

    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [app.key, sessionId, syncFromCache]);

  const executeInternal = useCallback(
    async (force: boolean) => {
      if (!force && result) return result;
      const hasContextPackTranscript = contextPack?.lessons.some((lesson) => lesson.transcript.length > 0) ?? false;
      if (transcript.length === 0 && !hasContextPackTranscript) {
        const emptyState = nowTaskState('error', '当前会话缺少可用课堂内容，请先导入或录制。');
        setTaskState(emptyState);
        writeCachedTaskState(sessionId, app.key, emptyState);
        return null;
      }

      const runningState = nowTaskState('running');
      setTaskState(runningState);
      writeCachedTaskState(sessionId, app.key, runningState);

      try {
        const controller = new AbortController();
        const timeoutMs = resolveExecuteTimeoutMs(app.key);
        const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

        let response: Response;
        try {
          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          if (accessToken) {
            headers['Authorization'] = `Bearer ${accessToken}`;
          }
          response = await fetch('/api/apps/execute', {
            method: 'POST',
            headers,
            signal: controller.signal,
            body: JSON.stringify({
              appKey: app.key,
              model,
              contextTier: contextPack?.tier,
              contextPack: contextPack ? slimContextPack(contextPack) : undefined,
              goal: {
                intent: app.intent,
                expectedOutput: 'mixed',
                appKey: app.key,
              },
              input: contextPack ? undefined : {
                sessionId,
                dataSource,
                transcript: slimTranscript(transcript),
                anchors,
                metadata: {
                  title: contextTitle,
                  contextType: dataSource,
                },
              },
              memory: contextPack ? undefined : {
                summary: summaryOverview,
                keyDifficulties,
                terminologyHint: terminologyHint || undefined,
              },
            }),
          });
        } finally {
          window.clearTimeout(timeoutId);
        }

        const data = (await response.json().catch(() => null)) as {
          ok?: boolean;
          error?: string;
          result?: AppExecutionResult;
        } | null;

        if (!response.ok || !data?.ok || !data.result) {
          // 429 限流友好提示
          if (response.status === 429) {
            throw new Error(data?.error || '生成请求过于频繁，请稍等片刻再点重试');
          }
          if (data?.error === 'CONTENT_NOT_READY' || data?.error === 'APP_NOT_SUITABLE') {
            // 材料不足是预期内的诚实空态：不抛错、不进红色失败态，窗口回空态 + 一句安静说明。
            // 同时清掉旧结果与缓存：空态意味着旧产物不能再代表当前材料，
            // 避免页面一边说没做好，一边还展示/分享旧的伪成品。
            const idleState = nowTaskState('idle');
            setTaskState(idleState);
            writeCachedTaskState(sessionId, app.key, idleState);
            setResult(null);
            removeCacheEntry(buildResultCacheKey(sessionId, app.key));
            toast.message(
              data.error === 'CONTENT_NOT_READY'
                ? COPY.apps.matrix.executeNotReady
                : COPY.apps.matrix.executeNotSuitable,
            );
            return null;
          }
          if (data?.error === 'MULTI_LESSON_CONTEXT_REQUIRED') {
            throw new Error(COPY.apps.matrix.executeNeedsMultipleLessons);
          }
          throw new Error(data?.error || '应用执行失败');
        }

        setResult(data.result);
        writeCachedAppResult(sessionId, app.key, data.result);
        const successState = nowTaskState('success');
        setTaskState(successState);
        writeCachedTaskState(sessionId, app.key, successState);
        return data.result;
      } catch (error) {
        const isNetworkFailure =
          error instanceof TypeError
            ? /failed to fetch|load failed|networkerror/i.test(error.message)
            : error instanceof Error
              ? /failed to fetch|load failed|networkerror/i.test(error.message)
              : false;
        const message =
          error instanceof DOMException && error.name === 'AbortError'
            ? `生成超时（${Math.round(resolveExecuteTimeoutMs(app.key) / 1000)}s），请重试或切换模型。`
            : isNetworkFailure
              ? '网络请求失败，请确认开发服务正在运行，并在页面稳定后重试。'
              : error instanceof Error
                ? error.message
                : '应用执行失败';
        // CONTENT_NOT_READY 的清理已在上面早退分支完成；这里只剩真实失败
        const failedState = nowTaskState('error', message);
        setTaskState(failedState);
        writeCachedTaskState(sessionId, app.key, failedState);
        return null;
      }
    },
    [accessToken, anchors, app.intent, app.key, contextPack, contextTitle, dataSource, keyDifficulties, model, result, sessionId, summaryOverview, terminologyHint, transcript]
  );

  useEffect(() => {
    if (!hydrated) return;
    if (!autoRun) return;
    if (result) return;
    // 失败后不自动重跑，避免限流/失败循环。用户需要主动点"重试"。
    if (taskState.status === 'error') return;
    const staleRunningTask =
      taskState.status === 'running' && Date.now() - taskState.updatedAt > APP_RUNNING_TASK_STALE_MS;
    if (taskState.status === 'running' && !staleRunningTask) return;
    void executeInternal(false);
  }, [autoRun, executeInternal, hydrated, result, taskState.status, taskState.updatedAt]);

  const execute = useCallback(() => executeInternal(false), [executeInternal]);
  const rerun = useCallback(() => executeInternal(true), [executeInternal]);
  const updateResult = useCallback(
    (next: AppExecutionResult) => {
      setResult(next);
      writeCachedAppResult(sessionId, app.key, next);
      const successState = nowTaskState('success');
      setTaskState(successState);
      writeCachedTaskState(sessionId, app.key, successState);
    },
    [app.key, sessionId]
  );

  return useMemo(
    () => ({
      result,
      taskState,
      isRunning: taskState.status === 'running',
      hasResult: Boolean(result),
      execute,
      rerun,
      updateResult,
    }),
    [execute, result, rerun, taskState, updateResult]
  );
}
