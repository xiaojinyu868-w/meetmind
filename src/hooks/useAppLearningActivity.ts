'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useLearningContext } from '@/hooks/useLearningContext';
import { readStoredAccessToken, useAuth } from '@/lib/hooks/useAuth';
import { invalidateMasteryTrailCache } from '@/hooks/useMasteryTrail';
import { createLogger } from '@/lib/logger';
import type { LearningAssessmentDraft, LearningEventInput, LearningObservationContent } from '@/types/learning-event';

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
 * - activity 事件可带 `observation`（完整题面 / 实际答案 / 观察条件），由 education-adapter 变成通用 Context
 *   原始观察进 Hindsight（CONTEXT_ENABLED）；登录态还在核对时先排队，token 一致才补发，不把访客动作转给账号。
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
  recordInteraction: (line: string, observation?: LearningObservationContent) => void;
  recordAssessment: (draft: LearningAssessmentDraft) => void;
} {
  const { recordActivity } = useLearningContext();
  const { accessToken, user, isCheckingAuth } = useAuth();
  const recordedResultRef = useRef<string | null>(null);
  const sentAssessmentsRef = useRef<Set<string>>(new Set());
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
    }).then((response) => {
      invalidateMasteryTrailCache();
      if (response.ok) window.dispatchEvent(new Event('meetmind:context-updated'));
    }).catch((error) => {
      // 记忆写入失败不打扰用户，也不重试——事件是增量材料，丢一条不影响当前学习
      log.warn('assessment event failed', { appKey: draft.appKey, message: error instanceof Error ? error.message : String(error) });
    });
  }, [accessToken, appKey, lessonTitle, resultUpdatedAt, sessionId]);

  return { recordInteraction, recordAssessment };
}

export default useAppLearningActivity;
