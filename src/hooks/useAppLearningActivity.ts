'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useLearningContext } from '@/hooks/useLearningContext';
import { readStoredAccessToken, useAuth } from '@/lib/hooks/useAuth';
import type { LearningObservationContent } from '@/types/learning-event';

interface UseAppLearningActivityOptions {
  appKey: string;
  sessionId: string;
  resultReady: boolean;
  resultUpdatedAt: number;
  resultDetail: string;
  activityTitle: string;
  onLearningActivity?: (line: string) => void;
}

export function useAppLearningActivity({
  appKey,
  sessionId,
  resultReady,
  resultUpdatedAt,
  resultDetail,
  activityTitle,
  onLearningActivity,
}: UseAppLearningActivityOptions): { recordInteraction: (line: string, observation?: LearningObservationContent) => void } {
  const { recordActivity } = useLearningContext();
  const { accessToken, user, isCheckingAuth } = useAuth();
  const recordedResultRef = useRef<string | null>(null);
  const awaitingAuth = useRef<Array<{ token: string; detail: string; sourceId: string; observation?: LearningObservationContent }>>([]);

  const syncActivity = useCallback(async (detail: string, sourceId: string, observation?: LearningObservationContent): Promise<void> => {
    if (!accessToken || !user?.id) return;
    try {
      // Account-scoped keys also avoid the legacy pipeline's globally unique key.
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([user.id, sourceId])));
      const key = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
      const response = await fetch('/api/memory/events', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          appId: 'application-matrix', type: 'activity', sourceId: sessionId,
          idempotencyKey: `app-activity:${key}`,
          observation,
          // These are existing UI summaries, not a complete answer or proof of mastery.
          payload: { v: 1, kind: 'app', title: activityTitle.slice(0, 80), detail: detail.slice(0, 240), sessionId, appKey },
        }),
      });
      if (response.ok) window.dispatchEvent(new Event('meetmind:context-updated'));
    } catch {
      // The current learning activity remains usable when background submission fails.
    }
  }, [accessToken, activityTitle, appKey, sessionId, user?.id]);

  useEffect(() => {
    if (isCheckingAuth) return;
    const queued = awaitingAuth.current.splice(0);
    // Never transfer a guest action or another account's pending action after login.
    for (const entry of queued) if (entry.token === accessToken && user?.id) {
      void syncActivity(entry.detail, entry.sourceId, entry.observation);
    }
  }, [accessToken, isCheckingAuth, syncActivity, user?.id]);

  useEffect(() => {
    if (!resultReady || !resultDetail.trim()) return;
    const sourceId = `app-result:${sessionId}:${appKey}:${resultUpdatedAt}`;
    const ownerSourceId = `${user?.id ?? 'guest'}:${sourceId}`;
    if (recordedResultRef.current === ownerSourceId) return;
    recordedResultRef.current = ownerSourceId;
    void recordActivity({
      kind: 'app',
      title: activityTitle,
      detail: resultDetail,
      sessionId,
      appKey,
      sourceId,
    });
    void syncActivity(resultDetail, sourceId);
  }, [activityTitle, appKey, recordActivity, resultDetail, resultReady, resultUpdatedAt, sessionId, syncActivity, user?.id]);

  const recordInteraction = useCallback((line: string, observation?: LearningObservationContent) => {
    onLearningActivity?.(line);
    const sourceId = `app-interaction:${sessionId}:${appKey}:${crypto.randomUUID()}`;
    void recordActivity({
      kind: 'app',
      title: activityTitle,
      detail: line,
      sessionId,
      appKey,
      sourceId,
    });
    const pendingToken = isCheckingAuth ? readStoredAccessToken() : null;
    if (pendingToken && (!accessToken || !user?.id)) {
      awaitingAuth.current.push({ token: pendingToken, detail: line, sourceId, observation });
    } else void syncActivity(line, sourceId, observation);
  }, [accessToken, activityTitle, appKey, isCheckingAuth, onLearningActivity, recordActivity, sessionId, syncActivity, user?.id]);

  return { recordInteraction };
}

export default useAppLearningActivity;
