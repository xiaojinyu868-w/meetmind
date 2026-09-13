'use client';

/**
 * 一节「收藏夹课」在浏览器里的共享状态：材料包、伪转录、考一考（测验 / 闪卡）、交卷后的记忆写入与「继续看」。
 * 课堂页（舞台 + 材料栏）和课后页（三栏）共用，避免两处各写一份。零 UI。
 */

import * as React from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { ZHIHU_COPY as C } from '@/lib/ui/copy-zhihu';
import { buildLocalLearnerContext } from '@/components/learner-context-local';
import type { AppExecutionResult } from '@/lib/ai-native/types';
import type { LiveMaterialPack } from '@/lib/services/teach-live/live-materials';
import type { ContinueReadingGroup } from '@/lib/services/zhihu/zhihu-discovery-service';
import type { LearningAssessmentDraft, LearningEventInput } from '@/types/learning-event';
import { executeApp, fetchContinueReading, fetchLessonPack, ZhihuClientError } from './zhihu-api-client';
import { buildExecutePayload, materialsToTranscript, relabelTimeReferences, sourceForTime, weakConceptsFromAssessment, type MaterialsTranscript, type ZhihuLessonAppKey } from './zhihu-lesson-model';

export interface AppRun {
  status: 'idle' | 'running' | 'done' | 'error';
  result: AppExecutionResult | null;
  updatedAt: number;
  error?: string;
}

const idleRun: AppRun = { status: 'idle', result: null, updatedAt: 0 };

export interface ZhihuLessonController {
  threadId: string;
  pack: LiveMaterialPack | null;
  packError: string | null;
  thread: { id: string; title: string; topic: string } | null;
  materials: MaterialsTranscript | null;
  runs: Record<ZhihuLessonAppKey, AppRun>;
  run: (appKey: ZhihuLessonAppKey) => Promise<void>;
  /** 证据按钮 → 打开对应的知乎原文 */
  openSource: (startMs: number) => void;
  /** 证据按钮文案：「看这篇材料：A1《…》」 */
  evidenceLabel: (startMs: number) => string;
  recordAssessment: (appKey: ZhihuLessonAppKey, draft: LearningAssessmentDraft) => void;
  weak: string[] | null;
  groups: ContinueReadingGroup[] | null;
  /** 今天从知乎搜东西的额度用完了（空结果时要说清原因） */
  continueExhausted: boolean;
  continueBusy: boolean;
  /** 最近一次交卷 / 打分的时间戳，课后页据此把「继续看」推到前面 */
  assessedAt: number | null;
  /** 材料包没读到（慢 / 断）时再试 */
  retryPack: () => void;
}

export function useZhihuLesson(threadId: string): ZhihuLessonController {
  const { accessToken } = useAuth();
  const [pack, setPack] = React.useState<LiveMaterialPack | null>(null);
  const [thread, setThread] = React.useState<{ id: string; title: string; topic: string } | null>(null);
  const [packError, setPackError] = React.useState<string | null>(null);
  const [runs, setRuns] = React.useState<Record<ZhihuLessonAppKey, AppRun>>({ quiz: idleRun, flashcards: idleRun });
  const [weak, setWeak] = React.useState<string[] | null>(null);
  const [groups, setGroups] = React.useState<ContinueReadingGroup[] | null>(null);
  const [continueBusy, setContinueBusy] = React.useState(false);
  const [continueExhausted, setContinueExhausted] = React.useState(false);
  const [assessedAt, setAssessedAt] = React.useState<number | null>(null);
  const runsRef = React.useRef(runs);
  runsRef.current = runs;

  const [packAttempt, setPackAttempt] = React.useState(0);
  React.useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    setPackError(null);
    fetchLessonPack(accessToken, threadId)
      .then((data) => {
        if (cancelled) return;
        setPack(data.pack);
        setThread(data.thread);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ZhihuClientError) setPackError(error.message);
        else if ((error as Error)?.name === 'TimeoutError' || (error as Error)?.name === 'AbortError') setPackError(C.packSlow);
        else setPackError(C.errors.unknown);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, threadId, packAttempt]);
  const retryPack = React.useCallback(() => setPackAttempt((n) => n + 1), []);

  const materials = React.useMemo(() => (pack ? materialsToTranscript(pack) : null), [pack]);

  const openSource = React.useCallback(
    (startMs: number) => {
      const span = materials ? sourceForTime(materials.spans, startMs) : null;
      if (span?.url) window.open(span.url, '_blank', 'noopener');
    },
    [materials],
  );

  const evidenceLabel = React.useCallback(
    (startMs: number) => {
      const span = materials ? sourceForTime(materials.spans, startMs) : null;
      return span ? C.evidenceLabel(span.ref, span.title) : C.backToSource;
    },
    [materials],
  );

  const run = React.useCallback(
    async (appKey: ZhihuLessonAppKey) => {
      if (!pack || !materials || runsRef.current[appKey].status === 'running') return;
      setRuns((r) => ({ ...r, [appKey]: { status: 'running', result: null, updatedAt: Date.now() } }));
      const sessionId = `zhihu-lesson:${threadId}`;
      let learner: unknown;
      try {
        learner = buildLocalLearnerContext({ appId: appKey, sessionId });
      } catch {
        learner = undefined;
      }
      const payload = buildExecutePayload({ appKey, threadId, pack, transcript: materials.transcript, learner });
      const outcome = await executeApp(accessToken, payload);
      setRuns((r) => ({
        ...r,
        [appKey]: outcome.ok
          ? { status: 'done', result: relabelTimeReferences(outcome.result, materials.spans), updatedAt: Date.now() }
          : { status: 'error', result: null, updatedAt: Date.now(), error: outcome.error === 'CONTENT_NOT_READY' ? C.notReady : C.quizFailed },
      }));
    },
    [accessToken, materials, pack, threadId],
  );

  const recordAssessment = React.useCallback(
    (appKey: ZhihuLessonAppKey, draft: LearningAssessmentDraft) => {
      const sessionId = `zhihu-lesson:${threadId}`;
      const updatedAt = runsRef.current[appKey].updatedAt;
      if (accessToken && draft.items.length) {
        const body: LearningEventInput = {
          appId: 'apps',
          type: 'assessment',
          payload: { v: 1, appKey: draft.appKey, sessionId, ...(pack ? { lessonTitle: pack.title.slice(0, 120) } : {}), items: draft.items },
          sourceId: `app-result:${sessionId}:${appKey}:${updatedAt}`,
          idempotencyKey: `app-assessment:${sessionId}:${updatedAt}:${draft.items.map((i) => `${i.concept}=${i.outcome}`).join('|').slice(0, 400)}`,
        };
        void fetch('/api/memory/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify(body),
        })
          .then(() => window.dispatchEvent(new Event('meetmind:context-updated')))
          .catch(() => undefined);
      }
      const concepts = weakConceptsFromAssessment(draft);
      setWeak(concepts);
      setAssessedAt(Date.now());
      if (!accessToken || concepts.length === 0) {
        setGroups([]);
        return;
      }
      setContinueBusy(true);
      setContinueExhausted(false);
      fetchContinueReading(accessToken, { concepts, threadId })
        .then((data) => {
          setGroups(data.groups);
          setContinueExhausted(data.exhausted);
        })
        .catch(() => setGroups([]))
        .finally(() => setContinueBusy(false));
    },
    [accessToken, pack, threadId],
  );

  return { threadId, pack, packError, thread, materials, runs, run, openSource, evidenceLabel, recordAssessment, weak, groups, continueExhausted, continueBusy, assessedAt, retryPack };
}
