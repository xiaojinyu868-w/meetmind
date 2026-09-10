'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, RotateCw } from 'lucide-react';
import { animateEnter } from '@/components/apps/windows/app-motion';
import type { TranscriptSegment } from '@/types';
import type { Anchor } from '@/lib/services/anchor-service';
import type { DataSourceType } from '@/lib/ai-native/types';
import { getWorkshopAppByKey, type WorkshopAppKey } from '@/lib/ai-native/app-catalog';
import { useAppExecution } from '@/components/apps/hooks/useAppExecution';
import { AppRenderSurface } from '@/components/apps/windows/AppRenderSurface';
import { COPY } from '@/lib/ui/copy';
import { APPS_COPY } from '@/lib/ui/copy-apps';
import { GLOBAL_ASK_COPY } from '@/lib/ui/copy-global-ask';
import { useAppLearningActivity } from '@/hooks/useAppLearningActivity';
import { recordSessionAssessment, useSessionOutcomes } from '@/components/apps/review-session-outcomes';
import { LEARNING_PATH, buildOutcomeAnchors, recommendNextStep, summarizeSessionOutcomes } from '@/components/apps/lesson-path-model';
import { readCachedAppResult } from '@/components/apps/hooks/useAppExecution';
import { WORKSHOP_APP_CATALOG } from '@/lib/ai-native/app-catalog';
import type { NextStepCardProps } from '@/components/apps/windows/NextStepCard';
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
  /** 打开另一个应用（完成态的「接下来」卡用）；不传则完成态不出下一步 */
  onOpenApp?: (appKey: WorkshopAppKey) => void;
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

/** 桌面上默认进全屏舞台的应用：中栏 400px 里只能缩成缩略图的"一张面" */
const STAGE_APPS: ReadonlySet<string> = new Set(['explainer', 'teach-back', 'cheatsheet', 'mindmap']);

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
  onOpenApp,
}: ReviewLearningWorkspaceProps) {
  const app = getWorkshopAppByKey(appKey) || getWorkshopAppByKey('flashcards')!;
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
    GLOBAL_ASK_COPY.appResultSummary,
  );
  const { recordInteraction, recordAssessment: recordAssessmentEvent } = useAppLearningActivity({
    appKey: app.key,
    sessionId,
    resultReady: Boolean(execution.result) && execution.taskState.status === 'success',
    resultUpdatedAt: execution.taskState.updatedAt,
    resultDetail: resultActivityDetail,
    activityTitle: GLOBAL_ASK_COPY.appActivity(app.name),
    lessonTitle: contextTitle,
    onLearningActivity,
  });
  const recordAssessment = useCallback((draft: LearningAssessmentDraft) => {
    recordSessionAssessment(sessionId, draft); // 会话层：路径卡摘要 + 下一步的困惑上下文
    recordAssessmentEvent(draft); // 长期记忆：LearningEvent（登录用户）
  }, [recordAssessmentEvent, sessionId]);

  // 完成态里同桌接着说的下一步：与课后学习页同一份判断（上一步的结果 > 课堂事实）。
  // generated 从产物缓存读——本窗口刚做完的结果在 sessionOutcomes 变化时重新算。
  const nextStep = useMemo<NextStepCardProps | undefined>(() => {
    if (!onOpenApp) return undefined;
    const outcomes = summarizeSessionOutcomes(sessionOutcomes);
    const generated = new Set(LEARNING_PATH.filter((key) => key === app.key || Boolean(readCachedAppResult(sessionId, key))));
    const allowed = new Set(LEARNING_PATH);
    const rec = recommendNextStep({ anchors, keyDifficulties, transcript, outcomes, generated, allowed });
    if (!rec.key || rec.key === app.key) return undefined;
    const target = WORKSHOP_APP_CATALOG.find((item) => item.key === rec.key);
    if (!target) return undefined;
    const targetKey = rec.key;
    return { action: target.learningAction, appName: target.name, reason: rec.reason, onOpen: () => onOpenApp(targetKey) };
  }, [anchors, app.key, keyDifficulties, onOpenApp, sessionId, sessionOutcomes, transcript]);

  // 全屏舞台：复习页中栏又窄又高，板书 / 教室 / 速查表这类"一张面"的应用在 400px 里只能缩成缩略图。
  // 这里给所有应用一个统一的「全屏」——同一棵组件树换到 fixed 覆盖层，执行状态与结果都不丢；Esc 退出。
  // 「一张面」的应用（板书 / 讲给同桌听 / 速查表 / 导图）在中栏里根本看不清，桌面上默认就进全屏——
  // 全屏后才是完整产品；退出全屏回到中栏仍可用。测验 / 闪卡 / 播客 / 信息图适合中栏，保持原样。
  const [fullscreen, setFullscreen] = useState(() => (
    STAGE_APPS.has(app.key) && typeof window !== 'undefined' && window.innerWidth >= 768
  ));
  useEffect(() => {
    setFullscreen(STAGE_APPS.has(app.key) && window.innerWidth >= 768);
  }, [app.key]);
  useEffect(() => {
    if (!fullscreen) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);
  // 全屏 ⇄ 中栏是同一棵树换容器：不重挂载（窗口内部状态不丢），只重放一次 220ms 进场
  const sectionRef = useRef<HTMLElement | null>(null);
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) { mountedRef.current = true; return; }
    animateEnter(sectionRef.current);
  }, [fullscreen]);

  const status = execution.taskState.status;
  const running = status === 'running';
  // 状态词只在"成品在眼前、正在重做 / 刚没做好"时跟在课名后面；没有成品时正文的进入态自己会说，头部不再重复
  const statusWord = execution.hasResult
    ? running ? APPS_COPY.shell.generating : status === 'error' ? COPY.apps.matrix.failed : null
    : null;
  const textAction = 'mm-focus shrink-0 rounded-md text-[12px] text-ink-muted transition hover:text-ink disabled:opacity-40 disabled:hover:text-ink-muted';

  return (
    <section
      ref={sectionRef}
      className={`mm-app-enter flex min-h-0 flex-col bg-canvas ${fullscreen ? 'fixed inset-0 z-[200] h-full' : 'h-full'}`}
      data-testid="review-learning-workspace"
      data-fullscreen={fullscreen || undefined}
    >
      {/* 头部：一行字——返回 · 应用名 · 全屏 · 再做一版。此前还有第二行「检验理解 · 想做题测一测…」的说明句，
          与正文里的产物重复；闪卡的深色房间（--mm-immersive）也一并去掉：纸底 + 牌本身的纸感与投影已经足够 */}
      <header className="flex shrink-0 items-center gap-3 border-b border-divider bg-white px-4 py-2.5">
        {/* 返回永远回应用矩阵（默认进全屏的应用不该要点两次才回得去）；退出全屏是右侧另一个文字动作 */}
        <button type="button" onClick={onBack} className={`${textAction} inline-flex items-center gap-1`}>
          <ArrowLeft size={13} strokeWidth={1.8} aria-hidden />
          <span className="hidden sm:inline">{COPY.apps.matrix.backToMatrix}</span>
        </button>
        <p className="min-w-0 flex-1 truncate text-[14px] font-semibold tracking-[-0.01em] text-ink">
          {app.name}
          {statusWord ? <span className={`ml-2 text-[12px] font-normal ${status === 'error' ? 'text-vermilion' : 'text-ink-muted'}`}>{statusWord}</span> : null}
        </p>
        <button type="button" onClick={() => setFullscreen((value) => !value)} className={`${textAction} hidden md:inline`}>
          {fullscreen ? APPS_COPY.shell.exitFullscreen : APPS_COPY.shell.fullscreen}
        </button>
        <button type="button" onClick={() => void execution.rerun()} disabled={running} className={`${textAction} inline-flex items-center gap-1`}>
          <RotateCw size={12} strokeWidth={1.8} aria-hidden />
          {COPY.apps.matrix.remake}
        </button>
      </header>
      <div className={`min-h-0 flex-1 overflow-auto ${fullscreen ? 'p-4 sm:p-6' : 'p-3'}`}>
        <AppRenderSurface
          appKey={app.key}
          result={execution.result}
          transcript={transcript}
          taskState={execution.taskState}
          sessionId={sessionId}
          contentContext={infographicContentContext}
          contextTitle={contextTitle}
          onSeek={onSeek}
          onRegenerate={() => void execution.rerun()}
          onGenerateDraft={() => (execution.hasResult ? execution.rerun() : execution.execute())}
          onResultUpdate={execution.updateResult}
          onLearningActivity={recordInteraction}
          onAssessment={recordAssessment}
          nextStep={nextStep}
          hostFullscreen={fullscreen}
        />
      </div>
    </section>
  );
}
