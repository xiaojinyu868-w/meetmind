'use client';

import { useMemo } from 'react';
import { ArrowLeft, RotateCw } from 'lucide-react';
import type { TranscriptSegment } from '@/types';
import type { Anchor } from '@/lib/services/anchor-service';
import type { DataSourceType } from '@/lib/ai-native/types';
import { getWorkshopAppByKey, type WorkshopAppKey } from '@/lib/ai-native/app-catalog';
import { useAppExecution } from '@/components/apps/hooks/useAppExecution';
import { AppRenderSurface } from '@/components/apps/windows/AppRenderSurface';
import { COPY } from '@/lib/ui/copy';
import { useAppLearningActivity } from '@/hooks/useAppLearningActivity';
import { buildAppResultActivityDetail } from '@/lib/utils/app-learning-activity';

interface ReviewLearningWorkspaceProps {
  appKey: WorkshopAppKey;
  sessionId: string;
  dataSource: DataSourceType;
  transcript: TranscriptSegment[];
  anchors: Anchor[];
  summaryOverview?: string;
  keyDifficulties?: string[];
  terminologyHint?: string;
  contextTitle?: string;
  onSeek?: (timeMs: number) => void;
  onBack: () => void;
  onLearningActivity?: (line: string) => void;
}

function buildInfographicContentContext(summaryOverview: string | undefined, transcript: TranscriptSegment[]): string {
  const normalizedSummary = (summaryOverview || '').trim();
  if (normalizedSummary) return normalizedSummary;
  return transcript
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(' ')
    .slice(0, 1400);
}

export function ReviewLearningWorkspace({
  appKey,
  sessionId,
  dataSource,
  transcript,
  anchors,
  summaryOverview,
  keyDifficulties,
  terminologyHint,
  contextTitle,
  onSeek,
  onBack,
  onLearningActivity,
}: ReviewLearningWorkspaceProps) {
  const app = getWorkshopAppByKey(appKey) || getWorkshopAppByKey('flashcards')!;
  const isImmersiveApp = app.key === 'flashcards';
  const infographicContentContext = useMemo(
    () => buildInfographicContentContext(summaryOverview, transcript),
    [summaryOverview, transcript],
  );
  const execution = useAppExecution({
    app,
    sessionId,
    dataSource,
    transcript,
    anchors,
    summaryOverview,
    keyDifficulties,
    terminologyHint,
    contextTitle,
    autoRun: app.key !== 'infographic',
  });

  const resultActivityDetail = buildAppResultActivityDetail(
    execution.result,
    COPY.globalAsk.appResultSummary,
  );
  const { recordInteraction } = useAppLearningActivity({
    appKey: app.key,
    sessionId,
    resultReady: Boolean(execution.result) && execution.taskState.status === 'success',
    resultUpdatedAt: execution.taskState.updatedAt,
    resultDetail: resultActivityDetail,
    activityTitle: COPY.globalAsk.appActivity(app.name),
    onLearningActivity,
  });

  return (
    <section className={`flex h-full min-h-0 flex-col ${isImmersiveApp ? 'bg-[#11110F]' : 'bg-canvas'}`} data-testid="review-learning-workspace">
      <header className={`flex shrink-0 items-center gap-3 border-b px-4 py-3 ${isImmersiveApp ? 'border-white/[0.08] bg-ink-secondary text-white' : 'border-divider bg-white'}`}>
        <button
          type="button"
          onClick={onBack}
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium transition ${isImmersiveApp ? 'border-white/[0.10] bg-white/[0.04] text-white/62 hover:border-white/[0.18] hover:text-white' : 'border-divider bg-white text-ink-secondary hover:border-ink-muted hover:text-ink'}`}
        >
          <ArrowLeft size={13} strokeWidth={1.8} />
          {COPY.apps.matrix.backToMatrix}
        </button>
        <div className="min-w-0 flex-1">
          <p className={`truncate text-[14px] font-semibold tracking-[-0.01em] ${isImmersiveApp ? 'text-white/92' : 'text-ink'}`}>{app.name}</p>
          <p className={`truncate text-[12px] ${isImmersiveApp ? 'text-white/42' : 'text-ink-muted'}`}>{COPY.apps.matrix.workspaceSubtitle(app.learningAction, app.bestFor)}</p>
        </div>
        <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] ${isImmersiveApp ? 'border-white/[0.10] bg-white/[0.04] text-white/45' : 'border-divider bg-white text-ink-muted'}`}>
          {execution.taskState.status === 'running' ? COPY.apps.matrix.running : execution.taskState.status === 'success' ? COPY.apps.matrix.ready : execution.taskState.status === 'error' ? COPY.apps.matrix.failed : COPY.apps.matrix.waiting}
        </span>
        <button
          type="button"
          onClick={() => void execution.rerun()}
          disabled={execution.taskState.status === 'running'}
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium transition ${isImmersiveApp ? 'border-white/[0.10] bg-white/[0.04] text-white/62 hover:border-white/[0.18] hover:text-white' : 'border-divider bg-white text-ink-secondary hover:border-ink-muted hover:text-ink'}`}
        >
          <RotateCw size={12} strokeWidth={1.8} />
          {COPY.apps.matrix.remake}
        </button>
      </header>
      <div className={`min-h-0 flex-1 overflow-auto ${isImmersiveApp ? 'bg-[#11110F] p-0' : 'p-3'}`}>
        <AppRenderSurface
          appKey={app.key}
          result={execution.result}
          transcript={transcript}
          taskState={execution.taskState}
          sessionId={sessionId}
          contentContext={infographicContentContext}
          onSeek={onSeek}
          onRegenerate={() => void execution.rerun()}
          onGenerateDraft={() => (execution.hasResult ? execution.rerun() : execution.execute())}
          onResultUpdate={execution.updateResult}
          onLearningActivity={recordInteraction}
          mindmapDefaultFullscreen
        />
      </div>
    </section>
  );
}
