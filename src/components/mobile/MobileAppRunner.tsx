'use client';

/**
 * MobileAppRunner — 移动端应用执行器
 *
 * 封装 useAppExecution + AppRenderSurface，让移动端全屏应用页（闪卡/测验/速查表等）
 * 可以一行调用。自动执行 + 缓存 + 渲染。
 *
 * 2026-09-10：加载 / 失败态不再自己画一套（Octo 头像 + 大写 mono 标签 + 两个按钮），
 * 交给 AppRenderSurface 里统一的 AppWindowPlaceholder——四个宿主同一句话、同一个按钮、同一段 220ms 过渡；
 * 分享退成头部一行里的一个词，不再独占一条 56px 的白带。
 */

import React, { useCallback, useEffect } from 'react';
import { useAppExecution } from '@/components/apps/hooks/useAppExecution';
import { AppRenderSurface } from '@/components/apps/windows/AppRenderSurface';
import { WORKSHOP_APP_CATALOG, type WorkshopAppKey } from '@/lib/ai-native/app-catalog';
import type { TranscriptSegment, Anchor } from '@/types';
import { COPY } from '@/lib/ui/copy';
import { GLOBAL_ASK_COPY } from '@/lib/ui/copy-global-ask';
import { useAppLearningActivity } from '@/hooks/useAppLearningActivity';
import { recordSessionAssessment } from '@/components/apps/review-session-outcomes';
import type { LearningAssessmentDraft } from '@/types/learning-event';
import { buildAppResultActivityDetail } from '@/lib/utils/app-learning-activity';
import type { DataSourceType } from '@/lib/ai-native/types';
import { ShareArtifactAction } from '@/components/share/ShareArtifactAction';
import { isShareableArtifactAppKey } from '@/components/share/share-artifact-model';

export interface MobileAppRunnerProps {
  appKey: WorkshopAppKey;
  sessionId: string;
  segments: TranscriptSegment[];
  anchors?: Anchor[];
  summaryOverview?: string;
  keyDifficulties?: string[];
  terminologyHint?: string;
  contextTitle?: string;
  dataSource?: DataSourceType;
  onSeek?: (ms: number) => void;
  onReturnToMatrix?: () => void;
}

export function MobileAppRunner({
  appKey,
  sessionId,
  segments,
  anchors = [],
  summaryOverview,
  keyDifficulties,
  terminologyHint,
  contextTitle,
  dataSource = 'live',
  onSeek,
  onReturnToMatrix,
}: MobileAppRunnerProps) {
  const app = WORKSHOP_APP_CATALOG.find((a) => a.key === appKey);
  const contentContext = summaryOverview?.trim() || segments
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(' ')
    .slice(0, 1400);

  const { result, taskState, execute, rerun, updateResult, hasResult } = useAppExecution({
    app: app ?? WORKSHOP_APP_CATALOG[0],
    sessionId: sessionId || 'mobile-session',
    dataSource,
    transcript: segments,
    anchors,
    summaryOverview,
    keyDifficulties,
    terminologyHint,
    contextTitle,
    autoRun: false, // 手动触发
  });
  const resultActivityDetail = buildAppResultActivityDetail(
    result,
    GLOBAL_ASK_COPY.appResultSummary,
  );
  const { recordInteraction, recordAssessment: recordAssessmentEvent } = useAppLearningActivity({
    appKey,
    sessionId: sessionId || 'mobile-session',
    resultReady: Boolean(result) && taskState.status === 'success',
    resultUpdatedAt: taskState.updatedAt,
    resultDetail: resultActivityDetail,
    activityTitle: GLOBAL_ASK_COPY.appActivity(app?.name || appKey),
  });
  const recordAssessment = useCallback((draft: LearningAssessmentDraft) => {
    recordSessionAssessment(sessionId || 'mobile-session', draft);
    recordAssessmentEvent(draft);
  }, [recordAssessmentEvent, sessionId]);

  // 挂载时自动执行
  useEffect(() => {
    if (!result && taskState.status === 'idle') {
      void execute();
    }
  }, [result, taskState.status, execute]);

  if (!app) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <p className="text-[15px] font-semibold text-ink">{COPY.apps.matrix.windowUnavailableTitle}</p>
        <p className="mt-1.5 max-w-[260px] text-[12px] leading-relaxed text-ink-muted">{COPY.apps.matrix.windowUnavailableBody}</p>
        {onReturnToMatrix ? (
          <button type="button" onClick={onReturnToMatrix} className="mm-press mt-5 rounded-full bg-ink px-4 py-2 text-[12px] font-medium text-white">
            {COPY.apps.matrix.backToMatrix}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {result && isShareableArtifactAppKey(appKey) ? (
        <div className="flex flex-shrink-0 justify-end px-4 pt-2">
          <ShareArtifactAction
            appKey={appKey}
            result={result}
            sessionId={sessionId}
            transcript={segments}
            courseTitle={contextTitle}
            summary={summaryOverview}
          />
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-hidden">
        <AppRenderSurface
          appKey={appKey}
          result={result}
          transcript={segments}
          taskState={taskState}
          sessionId={sessionId}
          contentContext={contentContext}
          contextTitle={contextTitle}
          onSeek={onSeek}
          onRegenerate={rerun}
          onGenerateDraft={() => (hasResult ? rerun() : execute())}
          onResultUpdate={updateResult}
          onLearningActivity={recordInteraction}
          onAssessment={recordAssessment}
          mindmapDefaultViewMode="outline"
        />
      </div>
    </div>
  );
}

export default MobileAppRunner;
