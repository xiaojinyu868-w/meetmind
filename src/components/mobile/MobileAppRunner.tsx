'use client';

/**
 * MobileAppRunner — 移动端应用执行器
 *
 * 封装 useAppExecution + AppRenderSurface，让移动端全屏应用页（闪卡/测验/速查表等）
 * 可以一行调用。自动执行 + 缓存 + 渲染。
 */

import React, { useEffect } from 'react';
import { useAppExecution } from '@/components/apps/hooks/useAppExecution';
import { AppRenderSurface } from '@/components/apps/windows/AppRenderSurface';
import { WORKSHOP_APP_CATALOG, type WorkshopAppKey } from '@/lib/ai-native/app-catalog';
import type { TranscriptSegment, Anchor } from '@/types';
import { COPY } from '@/lib/ui/copy';
import { buildAppResultActivityDetail, useAppLearningActivity } from '@/hooks/useAppLearningActivity';

export interface MobileAppRunnerProps {
  appKey: WorkshopAppKey;
  sessionId: string;
  segments: TranscriptSegment[];
  anchors?: Anchor[];
  summaryOverview?: string;
  keyDifficulties?: string[];
  terminologyHint?: string;
  onSeek?: (ms: number) => void;
}

export function MobileAppRunner({
  appKey,
  sessionId,
  segments,
  anchors = [],
  summaryOverview,
  keyDifficulties,
  terminologyHint,
  onSeek,
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
    dataSource: 'live',
    transcript: segments,
    anchors,
    summaryOverview,
    keyDifficulties,
    terminologyHint,
    autoRun: false, // 手动触发
  });
  const resultActivityDetail = buildAppResultActivityDetail(
    result,
    COPY.globalAsk.appResultSummary,
  );
  const { recordInteraction } = useAppLearningActivity({
    appKey,
    sessionId: sessionId || 'mobile-session',
    resultReady: Boolean(result) && taskState.status === 'success',
    resultUpdatedAt: taskState.updatedAt,
    resultDetail: resultActivityDetail,
    activityTitle: COPY.globalAsk.appActivity(app?.name || appKey),
  });

  // 挂载时自动执行
  useEffect(() => {
    if (!result && taskState.status === 'idle') {
      void execute();
    }
  }, [result, taskState.status, execute]);

  if (!app) {
    return (
      <div className="flex flex-col items-center justify-center h-full">
        <p className="text-[12px] text-ink-muted">{COPY.apps.matrix.failed}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {taskState.status === 'running' && !result && (
        <div className="flex flex-col items-center justify-center py-12">
          <div className="h-16 w-16 rounded-full bg-pine-mist flex items-center justify-center overflow-hidden mb-4 animate-pulse">
            <img src="/images/octo-buddy/thinking.png" alt="" className="h-full w-full object-cover" />
          </div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-pine mb-1">{COPY.apps.matrix.running}</p>
          <p className="text-[12px] text-ink-muted">{COPY.apps.matrix.workingOn(app.learningAction)}</p>
        </div>
      )}
      {taskState.status === 'error' && (
        <div className="flex flex-col items-center justify-center py-12">
          <p className="text-[12px] text-vermilion mb-3">{COPY.apps.matrix.failedWithoutLoss}</p>
          <button onClick={() => void rerun()} className="rounded-full bg-ink px-4 py-2 text-[12px] font-medium text-white active:scale-95">
            {COPY.apps.matrix.retry}
          </button>
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-hidden">
        <AppRenderSurface
          appKey={appKey}
          result={result}
          transcript={segments}
          taskState={taskState}
          sessionId={sessionId}
          contentContext={contentContext}
          onSeek={onSeek}
          onRegenerate={rerun}
          onGenerateDraft={() => (hasResult ? rerun() : execute())}
          onResultUpdate={updateResult}
          onLearningActivity={recordInteraction}
          mindmapDefaultFullscreen
        />
      </div>
    </div>
  );
}

export default MobileAppRunner;
