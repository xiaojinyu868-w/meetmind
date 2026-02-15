'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Anchor, TranscriptSegment } from '@/types';
import type { AppExecutionResult, DataSourceType } from '@/lib/ai-native/types';
import type { WorkshopAppCatalogItem } from '@/lib/ai-native/app-catalog';

export type AppTaskStatus = 'idle' | 'running' | 'success' | 'error';

export interface AppTaskState {
  status: AppTaskStatus;
  updatedAt: number;
  error?: string;
}

export const APP_RESULT_CACHE_PREFIX = 'app_workspace_result:';
export const APP_TASK_CACHE_PREFIX = 'app_workspace_task:';

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
  return safeJsonParse<AppTaskState>(window.localStorage.getItem(buildTaskCacheKey(sessionId, appKey)));
}

export function writeCachedAppResult(sessionId: string, appKey: string, result: AppExecutionResult): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(buildResultCacheKey(sessionId, appKey), JSON.stringify(result));
}

export function writeCachedTaskState(sessionId: string, appKey: string, state: AppTaskState): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(buildTaskCacheKey(sessionId, appKey), JSON.stringify(state));
}

function nowTaskState(status: AppTaskStatus, error?: string): AppTaskState {
  return {
    status,
    updatedAt: Date.now(),
    ...(error ? { error } : {}),
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
  model?: string;
  autoRun?: boolean;
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
    model,
    autoRun = true,
  } = params;
  const [result, setResult] = useState<AppExecutionResult | null>(null);
  const [taskState, setTaskState] = useState<AppTaskState>(() => nowTaskState('idle'));
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const cachedResult = readCachedAppResult(sessionId, app.key);
    const cachedTask = readCachedTaskState(sessionId, app.key);
    if (cachedResult) {
      setResult(cachedResult);
    }
    if (cachedTask) {
      setTaskState(cachedTask);
    }
    setHydrated(true);
  }, [app.key, sessionId]);

  const executeInternal = useCallback(
    async (force: boolean) => {
      if (!force && result) return result;
      if (transcript.length === 0) {
        const emptyState = nowTaskState('error', '当前会话缺少可用课堂内容，请先导入或录制。');
        setTaskState(emptyState);
        writeCachedTaskState(sessionId, app.key, emptyState);
        return null;
      }

      const runningState = nowTaskState('running');
      setTaskState(runningState);
      writeCachedTaskState(sessionId, app.key, runningState);

      try {
        const response = await fetch('/api/apps/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            appKey: app.key,
            model,
            goal: {
              intent: app.intent,
              expectedOutput: 'mixed',
              appKey: app.key,
            },
            input: {
              sessionId,
              dataSource,
              transcript,
              anchors,
            },
            memory: {
              summary: summaryOverview,
              keyDifficulties,
            },
          }),
        });

        const data = (await response.json().catch(() => null)) as {
          ok?: boolean;
          error?: string;
          result?: AppExecutionResult;
        } | null;

        if (!response.ok || !data?.ok || !data.result) {
          throw new Error(data?.error || '应用执行失败');
        }

        setResult(data.result);
        writeCachedAppResult(sessionId, app.key, data.result);
        const successState = nowTaskState('success');
        setTaskState(successState);
        writeCachedTaskState(sessionId, app.key, successState);
        return data.result;
      } catch (error) {
        const message = error instanceof Error ? error.message : '应用执行失败';
        const failedState = nowTaskState('error', message);
        setTaskState(failedState);
        writeCachedTaskState(sessionId, app.key, failedState);
        return null;
      }
    },
    [anchors, app.intent, app.key, dataSource, keyDifficulties, model, result, sessionId, summaryOverview, transcript]
  );

  useEffect(() => {
    if (!hydrated) return;
    if (!autoRun) return;
    if (result) return;
    void executeInternal(false);
  }, [autoRun, executeInternal, hydrated, result]);

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
