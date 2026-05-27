import type { AppExecutionResult } from '@/lib/ai-native/types';

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
  max: number,
): number {
  const parsed = Number.parseInt(envValue || '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export const APP_EXEC_TIMEOUT_DEFAULT_MS = parseClientTimeoutMs(
  process.env.NEXT_PUBLIC_APP_EXEC_TIMEOUT_MS,
  180 * 1000,
  30 * 1000,
  10 * 60 * 1000,
);
export const APP_EXEC_TIMEOUT_PODCAST_MS = parseClientTimeoutMs(
  process.env.NEXT_PUBLIC_APP_EXEC_PODCAST_TIMEOUT_MS,
  300 * 1000,
  60 * 1000,
  15 * 60 * 1000,
);
export const APP_RUNNING_TASK_STALE_MS = parseClientTimeoutMs(
  process.env.NEXT_PUBLIC_APP_RUNNING_STALE_MS,
  420 * 1000,
  120 * 1000,
  20 * 60 * 1000,
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

function readCacheIndex(): string[] {
  try {
    const raw = window.localStorage.getItem(CACHE_INDEX_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function writeCacheIndex(index: string[]): void {
  try {
    window.localStorage.setItem(CACHE_INDEX_KEY, JSON.stringify(index));
  } catch {
    // ignore
  }
}

function touchCacheKey(key: string): void {
  const index = readCacheIndex().filter((k) => k !== key);
  index.push(key);

  while (index.length > MAX_CACHED_RESULTS) {
    const evicted = index.shift();
    if (evicted) {
      try {
        window.localStorage.removeItem(evicted);
        const taskKey = evicted.replace(APP_RESULT_CACHE_PREFIX, APP_TASK_CACHE_PREFIX);
        window.localStorage.removeItem(taskKey);
      } catch {
        // ignore
      }
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

function safeSetItem(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch (err) {
    if (err instanceof DOMException && (err.name === 'QuotaExceededError' || err.code === 22)) {
      const index = readCacheIndex();
      for (let i = 0; i < 5 && index.length > 0; i += 1) {
        const evicted = index.shift();
        if (evicted) {
          try {
            window.localStorage.removeItem(evicted);
            const taskKey = evicted.replace(APP_RESULT_CACHE_PREFIX, APP_TASK_CACHE_PREFIX);
            window.localStorage.removeItem(taskKey);
          } catch {
            // ignore
          }
        }
      }
      writeCacheIndex(index);
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // give up silently
      }
    }
  }
}

export function writeCachedAppResult(sessionId: string, appKey: string, result: AppExecutionResult): void {
  if (typeof window === 'undefined') return;
  const key = buildResultCacheKey(sessionId, appKey);

  try {
    const sanitized = stripLargeInlineData(result);
    const serialized = JSON.stringify(sanitized);

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

export function nowTaskState(status: AppTaskStatus, error?: string): AppTaskState {
  return {
    status,
    updatedAt: Date.now(),
    ...(error ? { error } : {}),
  };
}

export function resolveExecuteTimeoutMs(appKey: string): number {
  return appKey === 'audio-overview' ? APP_EXEC_TIMEOUT_PODCAST_MS : APP_EXEC_TIMEOUT_DEFAULT_MS;
}
