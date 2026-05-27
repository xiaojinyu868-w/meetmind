import type { AppExecutionResult } from '@/lib/ai-native/types';
import type { InlineAppKey } from '@/lib/utils/open-app-marker';
import {
  nowTaskState,
  readCachedAppResult,
  writeCachedAppResult,
  writeCachedTaskState,
} from '@/lib/utils/app-execution-cache';

export type ReviewInlineAppState = {
  appKey: InlineAppKey;
  status: 'loading' | 'ready' | 'error';
  result?: AppExecutionResult;
  payload?: unknown;
  error?: string;
};

export function toReadyReviewInlineAppState(
  appKey: InlineAppKey,
  result: AppExecutionResult,
): ReviewInlineAppState {
  return {
    appKey,
    status: 'ready',
    result,
    payload: result.render?.payload,
  };
}

export function readCachedReviewInlineAppState(
  sessionId: string,
  appKey: InlineAppKey,
): ReviewInlineAppState | null {
  const cachedResult = readCachedAppResult(sessionId, appKey);
  if (!cachedResult) return null;
  return toReadyReviewInlineAppState(appKey, cachedResult);
}

export function writeReviewInlineAppRunning(sessionId: string, appKey: InlineAppKey): void {
  writeCachedTaskState(sessionId, appKey, nowTaskState('running'));
}

export function writeReviewInlineAppSuccess(
  sessionId: string,
  appKey: InlineAppKey,
  result: AppExecutionResult,
): ReviewInlineAppState {
  writeCachedAppResult(sessionId, appKey, result);
  writeCachedTaskState(sessionId, appKey, nowTaskState('success'));
  return toReadyReviewInlineAppState(appKey, result);
}

export function writeReviewInlineAppError(
  sessionId: string,
  appKey: InlineAppKey,
  error: string,
): void {
  writeCachedTaskState(sessionId, appKey, nowTaskState('error', error));
}
