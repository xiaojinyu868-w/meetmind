'use client';

import { useCallback, useMemo } from 'react';
import { ArrowLeft, RotateCw } from 'lucide-react';
import type { TranscriptSegment } from '@/types';
import type { Anchor } from '@/lib/services/anchor-service';
import type { DataSourceType } from '@/lib/ai-native/types';
import { getWorkshopAppByKey, type WorkshopAppKey } from '@/lib/ai-native/app-catalog';
import { useAppExecution } from '@/components/apps/hooks/useAppExecution';
import { AppRenderSurface } from '@/components/apps/windows/AppRenderSurface';
import { COPY } from '@/lib/ui/copy';
import { useAppLearningActivity } from '@/hooks/useAppLearningActivity';
import { recordSessionAssessment, useSessionOutcomes } from '@/components/apps/review-session-outcomes';
import { buildOutcomeAnchors, summarizeSessionOutcomes } from '@/components/apps/lesson-path-model';
import type { LearningAssessmentDraft } from '@/types/learning-event';
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
  // 会话内结果（测验错的点 / 闪卡没记住的 / 讲给同桌听没讲清的）→ 合成困惑锚点进本应用的 prompt，
  // 让闪卡知道你刚在测验里错了什么。刷新不丢（localStorage 按 sessionId）。
  const sessionOutcomes = useSessionOutcomes(sessionId);
  const anchorsWithOutcomes = useMemo(
    () => [...anchors, ...buildOutcomeAnchors(sessionId, app.key, summarizeSessionOutcomes(sessionOutcomes))],
    [anchors, app.key, sessionId, sessionOutcomes],
  );
  const execution = useAppExecution({
    app,
    sessionId,
    dataSource,
    transcript,
    anchors: anchorsWithOutcomes,
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
  const { recordInteraction, recordAssessment: recordAssessmentEvent } = useAppLearningActivity({
    appKey: app.key,
    sessionId,
    resultReady: Boolean(execution.result) && execution.taskState.status === 'success',
    resultUpdatedAt: execution.taskState.updatedAt,
    resultDetail: resultActivityDetail,
    activityTitle: COPY.globalAsk.appActivity(app.name),
    lessonTitle: contextTitle,
    onLearningActivity,
  });
  const recordAssessment = useCallback((draft: LearningAssessmentDraft) => {
    recordSessionAssessment(sessionId, draft); // 会话层：路径卡摘要 + 下一步的困惑上下文
    recordAssessmentEvent(draft); // 长期记忆：LearningEvent（登录用户）
  }, [recordAssessmentEvent, sessionId]);

  return (
    <section className={`flex h-full min-h-0 flex-col ${isImmersiveApp ? 'bg-[var(--mm-immersive)]' : 'bg-canvas'}`} data-testid="review-learning-workspace">
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
      <div className={`min-h-0 flex-1 overflow-auto ${isImmersiveApp ? 'bg-[var(--mm-immersive)] p-0' : 'p-3'}`}>
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
          onAssessment={recordAssessment}
        />
      </div>
    </section>
  );
}
