'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useLearningContext } from '@/hooks/useLearningContext';
import { useAuth } from '@/lib/hooks/useAuth';
import { invalidateMasteryTrailCache } from '@/hooks/useMasteryTrail';
import { createLogger } from '@/lib/logger';
import type { LearningAssessmentDraft, LearningEventInput } from '@/types/learning-event';

const log = createLogger('app-learning-activity');

/** 稳定短签名：同一份结果重复提交（连点两次「查看结果」）时让服务端幂等键撞上。 */
export function assessmentSignature(draft: LearningAssessmentDraft): string {
  const source = draft.items.map((item) => `${item.concept}|${item.outcome}`).join('\n');
  let hash = 5381;
  for (let i = 0; i < source.length; i += 1) {
    hash = ((hash << 5) + hash + source.charCodeAt(i)) | 0;
  }
  return `${draft.appKey}-${draft.items.length}-${(hash >>> 0).toString(36)}`;
}

interface UseAppLearningActivityOptions {
  appKey: string;
  sessionId: string;
  resultReady: boolean;
  resultUpdatedAt: number;
  resultDetail: string;
  activityTitle: string;
  /** 课堂标题快照，随 assessment 事件留史 */
  lessonTitle?: string;
  onLearningActivity?: (line: string) => void;
}

/**
 * 应用窗口 → 学习记忆的两条通道：
 * - `recordInteraction`：一行人话进最近学习现场（同桌当场就能读到；既有通道，访客也走本地）
 * - `recordAssessment`：结构化「概念 × 结果 × 证据」进 `LearningEvent`（登录用户；服务端留史，
 *   物化成掌握轨迹在读侧一起做）。访客一期不发——他们的本地同构结构留待记忆线下一步。
 */
export function useAppLearningActivity({
  appKey,
  sessionId,
  resultReady,
  resultUpdatedAt,
  resultDetail,
  activityTitle,
  lessonTitle,
  onLearningActivity,
}: UseAppLearningActivityOptions): {
  recordInteraction: (line: string) => void;
  recordAssessment: (draft: LearningAssessmentDraft) => void;
} {
  const { recordActivity } = useLearningContext();
  const { accessToken } = useAuth();
  const recordedResultRef = useRef<string | null>(null);
  const sentAssessmentsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!resultReady || !resultDetail.trim()) return;
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

  const recordAssessment = useCallback((draft: LearningAssessmentDraft) => {
    if (!accessToken || draft.items.length === 0) return;
    const signature = assessmentSignature(draft);
    const idempotencyKey = `app-assessment:${sessionId}:${resultUpdatedAt}:${signature}`;
    if (sentAssessmentsRef.current.has(idempotencyKey)) return;
    sentAssessmentsRef.current.add(idempotencyKey);
    const body: LearningEventInput = {
      appId: 'apps',
      type: 'assessment',
      payload: {
        v: 1,
        appKey: draft.appKey,
        sessionId,
        ...(lessonTitle ? { lessonTitle: lessonTitle.slice(0, 120) } : {}),
        items: draft.items,
      },
      sourceId: `app-result:${sessionId}:${appKey}:${resultUpdatedAt}`,
      idempotencyKey,
    };
    void fetch('/api/memory/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(body),
    }).then(() => {
      invalidateMasteryTrailCache();
    }).catch((error) => {
      // 记忆写入失败不打扰用户，也不重试——事件是增量材料，丢一条不影响当前学习
      log.warn('assessment event failed', { appKey: draft.appKey, message: error instanceof Error ? error.message : String(error) });
    });
  }, [accessToken, appKey, lessonTitle, resultUpdatedAt, sessionId]);

  return { recordInteraction, recordAssessment };
}

export default useAppLearningActivity;
