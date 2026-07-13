'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { AppExecutionResult } from '@/lib/ai-native/types';
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

export function buildAppResultActivityDetail(
  result: AppExecutionResult | null,
  fallback: (cardCount: number) => string,
): string {
  if (!result) return '';
  const renderDescription = result.render?.description?.trim();
  if (renderDescription) return renderDescription.slice(0, 220);
  const firstCard = result.cards[0];
  if (firstCard) return `${firstCard.title}：${firstCard.body}`.slice(0, 220);
  return fallback(result.cards.length);
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
