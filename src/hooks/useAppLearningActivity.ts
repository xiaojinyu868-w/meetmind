'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useLearningContext } from '@/hooks/useLearningContext';

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
}: UseAppLearningActivityOptions): { recordInteraction: (line: string) => void } {
  const { recordActivity } = useLearningContext();
  const recordedResultRef = useRef<string | null>(null);

  useEffect(() => {
    if (!resultReady) return;
    const sourceId = `app-result:${sessionId}:${appKey}:${resultUpdatedAt}`;
    if (recordedResultRef.current === sourceId) return;
    recordedResultRef.current = sourceId;
    void recordActivity({
      kind: 'app',
      title: activityTitle,
      detail: resultDetail,
      sessionId,
      appKey,
      sourceId,
    });
  }, [activityTitle, appKey, recordActivity, resultDetail, resultReady, resultUpdatedAt, sessionId]);

  const recordInteraction = useCallback((line: string) => {
    onLearningActivity?.(line);
    void recordActivity({
      kind: 'app',
      title: activityTitle,
      detail: line,
      sessionId,
      appKey,
      sourceId: `app-interaction:${sessionId}:${appKey}:${line}`,
    });
  }, [activityTitle, appKey, onLearningActivity, recordActivity, sessionId]);

  return { recordInteraction };
}

export default useAppLearningActivity;
