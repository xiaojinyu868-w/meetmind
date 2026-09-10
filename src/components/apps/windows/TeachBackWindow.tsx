'use client';

/**
 * TeachBackWindow — 「讲给同桌听」= 一间面试间（2026-09-10 表现层重做；底层连续讲述链路不变）。
 *
 * 一个界面走完开场 → 讲 → 讲完了，不换页：
 *   左（62%）你的话——开场是要讲的几点，开讲后转写从底部长出来往上流；底部一行状态 + 动作行。
 *   右（38%）听你讲的人——三位一人一行 + 反馈流（最新在上）；讲完了以后上面长出「复盘」（三位各说各的）。
 * 容器窄于 TWO_COLUMN_MIN_WIDTH（复习页中栏 / 手机 / 小浮窗）→ 堆叠单栏：听众一条横排在上、转写、
 * 反馈在转写下面长、固定底栏 讲完了 / 实时反馈 / 出声。
 *
 * 为什么不是看板：反馈由听众去听、去说；核对结论（evaluate，契约不变）也改写成三个人的话，
 * 没有象限、没有颜色标签、没有分数。编排在 use-teach-back-panel.ts，判断在 teach-back-turn-machine.ts
 * 与 teach-back-room-model.ts；这里只接线和排版。
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AppExecutionResult, TeachBackEvaluation, TeachBackJudgeId, TeachBackTurn } from '@/lib/ai-native/types';
import type { TranscriptSegment } from '@/types';
import { AppWindowPlaceholder } from '@/components/apps/windows/AppWindowPlaceholder';
import { TEACH_BACK_JUDGE_IDS } from '@/lib/ai-native/teach-back-panel';
import { formatTeachBackCompleteActivity } from '@/components/review-learning-activity';
import { APPS_COPY } from '@/lib/ui/copy-apps';
import { buildTeachBackAssessment, type AssessmentDraft } from './assessment-events';
import type { NextStepCardProps } from './NextStepCard';
import { buildTeachBackResultView, normalizeTeachBackTargets } from './teach-back-window-model';
import {
  buildReviewBlocks,
  heldCounts as countHeld,
  listenerStatusOf,
  reteachTargetIds,
  TWO_COLUMN_MIN_WIDTH,
  visibleFeedback,
  type ListenerStatus,
  type ReviewBlock,
} from './teach-back-room-model';
import { useTeachBackPanel } from './use-teach-back-panel';
import { TeachBackControls, TeachBackStatusLine, TeachBackTranscriptColumn, type RoomStage } from './TeachBackTranscriptColumn';
import { TeachBackEndActions, TeachBackFeedbackStream, TeachBackListeners, TeachBackReview } from './TeachBackListenersColumn';

interface TeachBackWindowProps {
  result: AppExecutionResult | null;
  transcript: TranscriptSegment[];
  /** 课名（请求 metadata.title，≤200 字；不是信息图那 1400 字正文上下文） */
  contextTitle?: string;
  onSeek?: (startMs: number) => void;
  onLearningActivity?: (line: string) => void;
  /** 评估完成后把每个目标点的象限 + 证据交给记忆（结构化，契约不变） */
  onAssessment?: (draft: AssessmentDraft) => void;
  /** 完成态里同桌接着说的下一步 */
  nextStep?: NextStepCardProps;
}

/** 复盘朗读：把一块复盘拼成要读出来的句子（与画面同一套文案） */
function reviewSpeech(block: ReviewBlock): string {
  const copy = APPS_COPY.teachBack;
  if (block.kind === 'unclear') {
    if (block.lines.length === 0) return copy.reviewUnclearNone;
    return `${copy.reviewUnclearLead(block.lines.length)}${block.lines.map((line) => line.item.point).join('；')}。`;
  }
  if (block.kind === 'steady') {
    const parts = [
      block.lines[0] ? copy.reviewSteady(block.lines[0].item.point) : '',
      block.next ? copy.reviewNext(block.next.item.point) : '',
    ].filter(Boolean);
    return parts.length > 0 ? parts.join('') : copy.reviewSteadyNone;
  }
  if (block.lines.length === 0) return copy.reviewUncoveredNone;
  return `${copy.reviewUncoveredLead}${block.lines.map((line) => line.item.point).join('；')}。`;
}

export function TeachBackWindow({ result, transcript, contextTitle, onSeek, onLearningActivity, onAssessment, nextStep }: TeachBackWindowProps) {
  const lessonTitle = contextTitle?.trim().slice(0, 200) || undefined;
  const targets = useMemo(() => normalizeTeachBackTargets(result), [result]);
  const [stage, setStage] = useState<RoomStage>('opening');
  const [evaluation, setEvaluation] = useState<TeachBackEvaluation | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [evalFailed, setEvalFailed] = useState(false);
  const [rateLimited, setRateLimited] = useState(false);
  const [evalStage, setEvalStage] = useState(0);
  const [evalAttempt, setEvalAttempt] = useState(0);
  const [focusTargetIds, setFocusTargetIds] = useState<string[] | null>(null);
  const [highlight, setHighlight] = useState<{ turnIndex: number; token: number } | null>(null);
  const [wide, setWide] = useState(true);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const turnsRef = useRef<TeachBackTurn[]>([]);
  const evalRequestRef = useRef(0);
  const autoRetriedRef = useRef(false);
  const activityWrittenRef = useRef(false);

  /** 「只讲没讲清的」时只带那几个目标；默认全部 */
  const activeTargets = useMemo(
    () => (focusTargetIds ? targets.filter((target) => focusTargetIds.includes(target.id)) : targets),
    [targets, focusTargetIds],
  );
  const metadata = useMemo(() => (lessonTitle ? { title: lessonTitle } : undefined), [lessonTitle]);

  const panel = useTeachBackPanel({ turnsRef, targets: activeTargets, transcript, metadata });

  /* ── 双栏 / 堆叠按容器真实宽度定（不是视口：复习页中栏 400px 也在桌面上） ── */

  useLayoutEffect(() => {
    const node = rootRef.current;
    if (!node) return undefined;
    const measure = () => setWide(node.clientWidth >= TWO_COLUMN_MIN_WIDTH);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  /* ── 评估等待：分阶段文案 ── */

  useEffect(() => {
    if (!evaluating || evalFailed) return undefined;
    setEvalStage(0);
    const timer = window.setInterval(() => setEvalStage((current) => Math.min(current + 1, 2)), 4_500);
    return () => window.clearInterval(timer);
  }, [evaluating, evalFailed]);

  /* ── 评估：讲完了就跑；首次失败静默重试一次 ── */

  useEffect(() => {
    if (!evaluating) return;
    const requestId = ++evalRequestRef.current;
    setEvalFailed(false);
    // evaluate 契约只认 role / text（judgeId 是听众席自己的事）
    const turns = turnsRef.current.map((turn) => ({ role: turn.role, text: turn.text }));
    const slimTranscript = transcript.map((segment) => ({
      id: segment.id,
      text: segment.text,
      startMs: segment.startMs,
      endMs: segment.endMs,
      confidence: segment.confidence ?? 1,
      isFinal: segment.isFinal ?? true,
    }));
    void (async () => {
      try {
        const response = await fetch('/api/apps/teach-back/evaluate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targets: activeTargets, teachingTurns: turns, transcript: slimTranscript, metadata }),
        });
        if (response.status === 429) {
          if (evalRequestRef.current !== requestId) return;
          setRateLimited(true);
          setEvalFailed(true);
          return;
        }
        const data = await response.json().catch(() => null);
        if (evalRequestRef.current !== requestId) return;
        if (!response.ok || !data?.ok || !data.evaluation) throw new Error('EVAL_FAILED');
        setEvaluation(data.evaluation as TeachBackEvaluation);
        setEvaluating(false);
      } catch {
        if (evalRequestRef.current !== requestId) return;
        if (!autoRetriedRef.current) {
          autoRetriedRef.current = true;
          window.setTimeout(() => {
            if (evalRequestRef.current === requestId) setEvalAttempt((attempt) => attempt + 1);
          }, 2_500);
          return;
        }
        setEvalFailed(true);
      }
    })();
  }, [evaluating, evalAttempt, activeTargets, transcript, metadata]);

  const reviewBlocks = useMemo(
    () => (evaluation ? buildReviewBlocks(evaluation, panel.turns) : null),
    [evaluation, panel.turns],
  );

  /* ── 复盘到了：三位各读自己那几句；写一次课后学习黑板 + 记忆（契约不变） ── */

  useEffect(() => {
    if (stage !== 'finished' || !evaluation || !reviewBlocks || activityWrittenRef.current) return;
    activityWrittenRef.current = true;
    for (const block of reviewBlocks) panel.speakAs(block.judgeId, reviewSpeech(block));
    const view = buildTeachBackResultView(evaluation);
    onLearningActivity?.(formatTeachBackCompleteActivity({
      total: view.total,
      mastery: view.counts.mastery,
      struggle: view.counts['productive-struggle'],
      gap: view.counts['aware-gap'],
      blindSpot: view.counts['blind-spot'],
      uncovered: view.counts.uncovered,
      blindSpotPoints: view.groups.find((group) => group.key === 'blind-spot')?.items.map((item) => item.point) ?? [],
    }));
    const assessment = buildTeachBackAssessment(evaluation.items);
    if (assessment) onAssessment?.(assessment);
  }, [stage, evaluation, reviewBlocks, onAssessment, onLearningActivity, panel]);

  /* ── 开讲 / 讲完了 / 再来 ── */

  const enterStage = useCallback((focus: string[] | null) => {
    panel.reset();
    turnsRef.current = [];
    activityWrittenRef.current = false;
    setEvaluation(null);
    setEvaluating(false);
    setEvalFailed(false);
    setHighlight(null);
    setFocusTargetIds(focus);
    setStage('talking');
    // 同一个用户手势里拿麦克风权限（getUserMedia 是 start 里的第一个 await）
    void panel.start();
  }, [panel]);

  const startEvaluation = () => {
    autoRetriedRef.current = false;
    setRateLimited(false);
    setEvalFailed(false);
    setEvaluating(true);
  };

  const handleFinish = () => {
    panel.finish(); // 同步把没提交的尾巴记进 turnsRef，停麦；记下的反馈开始揭示
    setStage('finished');
    startEvaluation();
  };

  const handleBackToTargets = () => {
    panel.reset();
    turnsRef.current = [];
    activityWrittenRef.current = false;
    setFocusTargetIds(null);
    setEvaluation(null);
    setEvaluating(false);
    setEvalFailed(false);
    setHighlight(null);
    setStage('opening');
  };

  const selectTurn = useCallback((turnIndex: number) => {
    setHighlight({ turnIndex, token: Date.now() });
  }, []);

  /* ── 派生 ── */

  const held = useMemo(() => countHeld(panel.feedback), [panel.feedback]);
  const statuses = useMemo(() => {
    const context = {
      activeJudge: panel.activeJudge,
      requestInFlight: panel.requestInFlight,
      liveFeedback: panel.liveFeedback,
      finished: stage === 'finished',
    };
    return Object.fromEntries(
      TEACH_BACK_JUDGE_IDS.map((id) => [id, listenerStatusOf(id, { ...context, heldCount: held[id] })]),
    ) as Record<TeachBackJudgeId, ListenerStatus>;
  }, [panel.activeJudge, panel.requestInFlight, panel.liveFeedback, stage, held]);
  const shownFeedback = useMemo(() => visibleFeedback(panel.feedback), [panel.feedback]);
  const activeJudgeName = panel.activeJudge ? APPS_COPY.teachBack.judges[panel.activeJudge].name : null;
  const hasUserTurn = panel.turnCount > 0 || turnsRef.current.some((turn) => turn.role === 'user');
  const finishDisabled = !hasUserTurn && !panel.liveText.trim();
  const typedFallback = panel.status === 'mic-denied' || panel.status === 'asr-down' || panel.status === 'mic-lost' || panel.status === 'mic-busy';
  const teachingChars = turnsRef.current.filter((turn) => turn.role === 'user').reduce((total, turn) => total + turn.text.length, 0);
  const unclearIds = evaluation ? reteachTargetIds(evaluation) : [];
  const compact = !wide;

  /* ── 渲染 ── */

  if (!result) {
    return <AppWindowPlaceholder status="loading" appName={APPS_COPY.teachBack.appName} transcript={transcript} />;
  }
  if (targets.length === 0) {
    return <AppWindowPlaceholder status="empty" appName={APPS_COPY.teachBack.appName} />;
  }

  const statusLine = (
    <TeachBackStatusLine
      stage={stage}
      status={panel.status}
      phase={panel.phase}
      mood={panel.mood}
      levels={panel.levels}
      elapsedMs={panel.elapsedMs}
      activeJudgeName={activeJudgeName}
      requestInFlight={panel.requestInFlight && panel.liveFeedback}
      onRetryMic={() => { void panel.start(); }}
    />
  );
  const controls = (
    <TeachBackControls
      stage={stage}
      finishDisabled={finishDisabled}
      onStart={() => enterStage(null)}
      onFinish={handleFinish}
      liveFeedback={panel.liveFeedback}
      onLiveFeedbackChange={panel.setLiveFeedback}
      voiceEnabled={panel.voiceEnabled}
      onVoiceEnabledChange={panel.setVoiceEnabled}
      typedFallback={typedFallback}
      onSubmitTyped={panel.submitTyped}
      compact={compact}
    />
  );
  const review = stage === 'finished' ? (
    <>
      <TeachBackReview
        blocks={reviewBlocks}
        evaluating={evaluating}
        evalStage={evalStage}
        evalFailed={evalFailed}
        rateLimited={rateLimited}
        teachingChars={teachingChars}
        onRetryEval={() => { setRateLimited(false); setEvalFailed(false); setEvalAttempt((attempt) => attempt + 1); }}
        onSelectTurn={selectTurn}
        onSeek={onSeek}
        speakingJudge={panel.speakingJudge}
        compact={compact}
      />
      {reviewBlocks ? (
        <TeachBackEndActions
          onRetry={() => enterStage(null)}
          onReteachUnclear={unclearIds.length > 0 ? () => enterStage(unclearIds) : null}
          onBackToTargets={handleBackToTargets}
          nextStep={nextStep}
        />
      ) : null}
    </>
  ) : null;
  const stream = (
    <TeachBackFeedbackStream
      entries={shownFeedback}
      activeJudge={panel.activeJudge}
      thinking={panel.requestInFlight && panel.liveFeedback && panel.activeJudge === null}
      liveFeedback={panel.liveFeedback}
      stage={stage}
      onSelect={selectTurn}
      compact={compact}
    />
  );

  if (wide) {
    return (
      <div ref={rootRef} className="flex h-full min-h-0 bg-paper" data-testid="teach-back-room" data-layout="wide" data-stage={stage}>
        <div className="flex min-h-0 flex-col" style={{ width: '62%' }}>
          <TeachBackTranscriptColumn stage={stage} targets={activeTargets} turns={panel.turns} liveText={panel.liveText} highlight={highlight} compact={false} />
          {stage !== 'opening' ? statusLine : null}
          {controls}
        </div>
        <aside className="flex min-h-0 flex-col border-l border-divider bg-paper" style={{ width: '38%' }}>
          <TeachBackListeners stage={stage} statuses={statuses} heldCounts={held} variant="rows" />
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-5">
            {review}
            {stream}
          </div>
        </aside>
      </div>
    );
  }

  const showPane = stage === 'finished' || shownFeedback.length > 0 || (panel.requestInFlight && panel.liveFeedback);
  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col bg-paper" data-testid="teach-back-room" data-layout="stacked" data-stage={stage}>
      <div className="border-b border-divider">
        <TeachBackListeners stage={stage} statuses={statuses} heldCounts={held} variant="strip" />
      </div>
      <div className={`min-h-0 ${stage === 'finished' ? 'basis-[45%] shrink-0' : 'flex-1'}`}>
        <TeachBackTranscriptColumn stage={stage} targets={activeTargets} turns={panel.turns} liveText={panel.liveText} highlight={highlight} compact />
      </div>
      {stage !== 'opening' ? <div className="py-1">{statusLine}</div> : null}
      {showPane ? (
        <div className={`min-h-0 overflow-y-auto border-t border-divider px-4 pt-3 ${stage === 'finished' ? 'flex-1' : 'max-h-[38%]'}`}>
          {review}
          {stream}
        </div>
      ) : null}
      {stage !== 'finished' ? <div className="shrink-0 border-t border-divider bg-card">{controls}</div> : null}
    </div>
  );
}

export default TeachBackWindow;
