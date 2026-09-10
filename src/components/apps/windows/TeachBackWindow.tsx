'use client';

/**
 * TeachBackWindow — 「讲给同桌听」= 一间安静的面试间（v3，2026-09-10 表现层重做；底层连续讲述链路不变）。
 *
 * 讲者看到的是一排评委，不是自己的字：
 *   - 主舞台 = 评委席（TeachBackBench）：三位大肖像立在桌沿上，桌沿下是名字；谁开口，他脚下长出他的话，
 *     说完留几秒淡成灰字滑进下面的对话记录（TeachBackRecord，默认只露最近几条）。
 *   - 要讲的几点 = 手卡（TeachBackCueCards）：开场在画面中央，开讲后收成左侧一列小卡（窄容器是顶部横向条），
 *     点一张翻过去提醒自己讲到哪了。
 *   - 讲者自己 = 讲台栏（TeachBackPodium）：麦克风点 + 细波形 · 已讲时长 · 三个图标开关（实时反馈 / 出声 / 转写）· 讲完了。
 *   - 复盘在同一界面：评委席留在上方，三位依次把 evaluate 的核对结论说出来（buildReviewBlocks 规则不变），
 *     说完进记录；记录下面是可展开的「整场转写」和 再讲一次 / 只讲没讲清的 / 回到目标。
 *
 * 为什么隐藏转写：讲者面对评委站在讲台上，转写很可能有错，转错一个字注意力就被吸走了。转写只在两处存在——
 * 讲台栏的「转写」开关（默认关，开了在讲台上方出一行 12px 灰字）与复盘里可展开的整场文字。
 *
 * 这里只接线和排版：编排在 use-teach-back-panel（麦克风 / ASR / 回合 / TTS）与 use-teach-back-stage（谁的话在台上、
 * 对话记录），判断在 teach-back-turn-machine + teach-back-room-model；evaluate 契约、记忆事件不变。
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
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
  CUE_COLUMN_MIN_WIDTH,
  heldCounts as countHeld,
  listenerStatusOf,
  reteachTargetIds,
  toggleFlipped,
  type ListenerStatus,
  type ReviewBlock,
  type RoomStage,
} from './teach-back-room-model';
import { useTeachBackPanel } from './use-teach-back-panel';
import { useTeachBackStage, type ReviewUtterance } from './use-teach-back-stage';
import { TeachBackBench } from './TeachBackBench';
import { TeachBackCueCards, TeachBackOpening } from './TeachBackCueCards';
import { TeachBackPodium, TeachBackTicker } from './TeachBackPodium';
import { TeachBackEndActions, TeachBackRecord, TeachBackTranscript } from './TeachBackRecord';

/** 首次进入说一句「麦克风常开…」的一次性 toast（localStorage） */
const INTRO_SEEN_KEY = 'meetmind:teach-back:intro-seen';

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

/** 复盘的一段话 + 它能回到的课堂原声时间点 */
interface ReviewLineOut extends ReviewUtterance {
  evidence: number[];
}

function evidenceOf(lines: Array<{ item: { evidence: { startMs: number } | null } }>): number[] {
  return Array.from(new Set(lines.map((line) => line.item.evidence?.startMs).filter((value): value is number => typeof value === 'number')));
}

/**
 * 复盘：把 evaluate 的核对结论改写成三位评委要说的话（buildReviewBlocks 的分配规则不变），渲染进评委脚下。
 * 脚下一次最多三四行，所以直言的每一处没讲清单独说一段——主句就是核对结论（note），不再把目标点原文
 * 复述一遍：说到哪一点，左边那张手卡会亮（targetIds），记录里也带着卡号。引导两句一段；追问一段
 * （没讲到的目标点都短）。画面与朗读同一套文案。
 */
function reviewUtterancesOf(blocks: ReviewBlock[]): ReviewLineOut[] {
  const copy = APPS_COPY.teachBack;
  const out: ReviewLineOut[] = [];
  for (const block of blocks) {
    const id = (suffix: string) => `review-${block.judgeId}-${suffix}`;
    if (block.kind === 'unclear') {
      if (block.lines.length === 0) {
        out.push({ id: id('none'), judgeId: block.judgeId, text: copy.reviewUnclearNone, evidence: [], targetIds: [] });
        continue;
      }
      block.lines.forEach((line, index) => {
        const body = line.item.note.trim() || line.item.point;
        out.push({
          id: id(line.item.targetId),
          judgeId: block.judgeId,
          text: index === 0 ? `${copy.reviewUnclearLead(block.lines.length)}${body}` : body,
          evidence: evidenceOf([line]),
          targetIds: [line.item.targetId],
        });
      });
      continue;
    }
    if (block.kind === 'steady') {
      const parts = [
        block.lines[0] ? copy.reviewSteady(block.lines[0].item.point) : '',
        block.next ? copy.reviewNext(block.next.item.point) : '',
      ].filter(Boolean);
      out.push({
        id: id('steady'),
        judgeId: block.judgeId,
        text: parts.length > 0 ? parts.join('') : copy.reviewSteadyNone,
        evidence: evidenceOf(block.lines),
        targetIds: [...block.lines, ...(block.next ? [block.next] : [])].map((line) => line.item.targetId),
      });
      continue;
    }
    out.push({
      id: id('uncovered'),
      judgeId: block.judgeId,
      text: block.lines.length === 0 ? copy.reviewUncoveredNone : `${copy.reviewUncoveredLead}${block.lines.map((line) => line.item.point).join('；')}。`,
      evidence: [],
      targetIds: block.lines.map((line) => line.item.targetId),
    });
  }
  return out;
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
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(() => new Set());
  const [transcriptShown, setTranscriptShown] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [cueOrigins, setCueOrigins] = useState<Map<string, DOMRect> | null>(null);
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

  /* ── 手卡放左边一列还是顶部横条：按容器真实宽度定（复习页中栏 400px 也在桌面上） ── */

  useLayoutEffect(() => {
    const node = rootRef.current;
    if (!node) return undefined;
    const measure = () => setWide(node.clientWidth >= CUE_COLUMN_MIN_WIDTH);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  /* ── 首次进入：一句话的 toast，说一次就够 ── */

  useEffect(() => {
    if (!result || targets.length === 0) return;
    try {
      if (window.localStorage.getItem(INTRO_SEEN_KEY) === '1') return;
      window.localStorage.setItem(INTRO_SEEN_KEY, '1');
    } catch {
      /* 隐私模式：这次说一遍，下次可能再说一遍，无妨 */
    }
    toast(APPS_COPY.teachBack.voiceHint, { duration: 5_000 });
  }, [result, targets.length]);

  /* ── 评估等待：分阶段文案 ── */

  useEffect(() => {
    if (!evaluating || evalFailed) return undefined;
    setEvalStage(0);
    const timer = window.setInterval(() => setEvalStage((current) => Math.min(current + 1, 2)), 4_500);
    return () => window.clearInterval(timer);
  }, [evaluating, evalFailed]);

  /* ── 评估：讲完了就跑；首次失败静默重试一次（契约不变） ── */

  useEffect(() => {
    if (!evaluating) return;
    const requestId = ++evalRequestRef.current;
    setEvalFailed(false);
    // evaluate 契约只认 role / text（judgeId 是评委席自己的事）
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
  const reviewUtterances = useMemo(() => (reviewBlocks ? reviewUtterancesOf(reviewBlocks) : null), [reviewBlocks]);
  const evidence = useMemo(() => {
    if (!reviewUtterances || !onSeek) return undefined;
    const out: Record<string, number[]> = {};
    for (const line of reviewUtterances) if (line.evidence.length > 0) out[line.id] = line.evidence;
    return out;
  }, [reviewUtterances, onSeek]);
  /** 复盘条目说的是第几张手卡（记录里带卡号；说的时候那张卡亮） */
  const cueNumbers = useMemo(() => {
    if (!reviewUtterances) return undefined;
    const out: Record<string, number[]> = {};
    for (const line of reviewUtterances) {
      const numbers = line.targetIds.map((targetId) => activeTargets.findIndex((target) => target.id === targetId) + 1).filter((n) => n > 0);
      if (numbers.length > 0) out[line.id] = numbers;
    }
    return out;
  }, [reviewUtterances, activeTargets]);

  /* ── 台上的话 / 对话记录（讲完后记下的与复盘由评委依次说出来） ── */

  const bench = useTeachBackStage({
    stage,
    feedback: panel.feedback,
    activeJudge: panel.activeJudge,
    speakingJudge: panel.speakingJudge,
    voiceEnabled: panel.voiceEnabled,
    review: stage === 'finished' ? reviewUtterances : null,
    speakAs: panel.speakAs,
    finishedAt: panel.elapsedMs,
  });

  /* ── 复盘到了：写一次课后学习黑板 + 记忆（契约不变） ── */

  useEffect(() => {
    if (stage !== 'finished' || !evaluation || activityWrittenRef.current) return;
    activityWrittenRef.current = true;
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
  }, [stage, evaluation, onAssessment, onLearningActivity]);

  /* ── 开讲 / 讲完了 / 再来 ── */

  const enterStage = useCallback((focus: string[] | null) => {
    // 量好几点在中央的位置，手卡从那里飞到左边（reduced-motion 下不飞）
    const origins = new Map<string, DOMRect>();
    rootRef.current?.querySelectorAll<HTMLElement>('[data-cue-origin]').forEach((node) => {
      const id = node.dataset.cueOrigin;
      if (id) origins.set(id, node.getBoundingClientRect());
    });
    setCueOrigins(origins.size > 0 ? origins : null);
    panel.reset();
    turnsRef.current = [];
    activityWrittenRef.current = false;
    setEvaluation(null);
    setEvaluating(false);
    setEvalFailed(false);
    setHighlight(null);
    setFlipped(new Set());
    setTranscriptOpen(false);
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
    setFlipped(new Set());
    setStage('opening');
  };

  const selectTurn = useCallback((turnIndex: number) => {
    setTranscriptOpen(true);
    setHighlight({ turnIndex, token: Date.now() });
  }, []);

  const toggleCue = useCallback((id: string) => setFlipped((current) => toggleFlipped(current, id)), []);

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
      TEACH_BACK_JUDGE_IDS.map((id) => {
        if (bench.current?.judgeId === id && bench.current.phase === 'speaking') return [id, 'speaking'];
        const status = listenerStatusOf(id, { ...context, heldCount: held[id] });
        return [id, status === 'closing' ? 'listening' : status];
      }),
    ) as Record<TeachBackJudgeId, ListenerStatus>;
  }, [panel.activeJudge, panel.requestInFlight, panel.liveFeedback, stage, held, bench]);
  const thinking = stage === 'talking' && panel.liveFeedback && panel.requestInFlight && panel.activeJudge === null;
  const hasUserTurn = panel.turnCount > 0 || turnsRef.current.some((turn) => turn.role === 'user');
  const finishDisabled = !hasUserTurn && !panel.liveText.trim();
  const typedFallback = panel.status === 'mic-denied' || panel.status === 'asr-down' || panel.status === 'mic-lost' || panel.status === 'mic-busy';
  const unclearIds = evaluation ? reteachTargetIds(evaluation) : [];
  const compact = !wide;
  const tickerText = panel.liveText.trim() || panel.turns[panel.turns.length - 1]?.text || '';
  const reviewState = stage !== 'finished' ? undefined : evalFailed ? 'failed' : evaluating ? 'evaluating' : reviewBlocks ? 'ready' : undefined;

  /* ── 渲染 ── */

  if (!result) {
    return <AppWindowPlaceholder status="loading" appName={APPS_COPY.teachBack.appName} transcript={transcript} />;
  }
  if (targets.length === 0) {
    return <AppWindowPlaceholder status="empty" appName={APPS_COPY.teachBack.appName} />;
  }

  const copy = APPS_COPY.teachBack;
  const notice = stage !== 'finished' ? null
    : evalFailed ? (
      <span className="inline-flex flex-wrap items-center justify-center gap-x-3 gap-y-1" data-testid="teach-back-eval-failed">
        <span>{rateLimited ? copy.evalRateLimited : copy.evalFailed}</span>
        <button
          type="button"
          onClick={() => { setRateLimited(false); setEvalFailed(false); setEvalAttempt((attempt) => attempt + 1); }}
          className="mm-focus inline-flex items-center gap-1 rounded text-[13px] font-medium text-pine"
        >
          <RotateCcw size={12} strokeWidth={2} aria-hidden />
          {copy.retryEval}
        </button>
      </span>
    ) : evaluating ? (
      <span className="inline-flex items-center gap-3" data-testid="teach-back-evaluating">
        <span className="thinking-strip h-1 w-16 rounded-full" aria-hidden />
        <span>{[copy.evaluating, copy.evaluatingStage2, copy.evaluatingStage3][Math.min(evalStage, 2)]}</span>
      </span>
    ) : null;

  const litCues = bench.current?.kind === 'review' ? bench.current.targetIds : undefined;
  const cueCards = (variant: 'column' | 'strip') => (
    <TeachBackCueCards targets={activeTargets} flipped={flipped} onToggle={toggleCue} variant={variant} origins={cueOrigins} lit={litCues} />
  );

  return (
    <div
      ref={rootRef}
      className="flex h-full min-h-0 flex-col bg-paper"
      data-testid="teach-back-room"
      data-layout={wide ? 'wide' : 'stacked'}
      data-stage={stage}
      data-review={reviewState}
      data-review-done={bench.reviewDone || undefined}
    >
      {!wide && stage !== 'opening' ? <div className="shrink-0 border-b border-divider">{cueCards('strip')}</div> : null}
      <div className="flex min-h-0 flex-1">
        {wide && stage !== 'opening' ? (
          <aside className="w-[252px] shrink-0 overflow-y-auto py-6 pl-6 pr-2" data-testid="teach-back-cue-column">
            {cueCards('column')}
          </aside>
        ) : null}
        <main className={`min-h-0 flex-1 overflow-y-auto ${compact ? 'pb-6 pt-4' : 'pb-8 pt-10'}`}>
          <TeachBackBench
            statuses={statuses}
            heldCounts={held}
            current={bench.current}
            thinking={thinking}
            compact={compact}
            finished={stage === 'finished'}
            opening={stage === 'opening'}
            notice={notice}
          />
          {stage === 'opening' ? <TeachBackOpening targets={activeTargets} onStart={() => enterStage(null)} compact={compact} /> : null}
          {stage !== 'opening' ? (
            <div className="mt-6">
              <TeachBackRecord
                entries={bench.record}
                compact={compact}
                onSelectTurn={stage === 'finished' ? selectTurn : undefined}
                evidence={evidence}
                cueNumbers={cueNumbers}
                onSeek={onSeek}
              />
            </div>
          ) : null}
          {stage === 'finished' ? (
            <div className="mt-4">
              <TeachBackTranscript turns={panel.turns} open={transcriptOpen} onOpenChange={setTranscriptOpen} highlight={highlight} compact={compact} />
            </div>
          ) : null}
          {stage === 'finished' && reviewBlocks ? (
            <div className="mt-6">
              <TeachBackEndActions
                onRetry={() => enterStage(null)}
                onReteachUnclear={unclearIds.length > 0 ? () => enterStage(unclearIds) : null}
                onBackToTargets={handleBackToTargets}
                nextStep={nextStep}
                compact={compact}
              />
            </div>
          ) : null}
        </main>
      </div>
      {transcriptShown && stage === 'talking' ? <TeachBackTicker text={tickerText} /> : null}
      <TeachBackPodium
        stage={stage}
        status={panel.status}
        mood={panel.mood}
        levels={panel.levels}
        elapsedMs={panel.elapsedMs}
        liveFeedback={panel.liveFeedback}
        onLiveFeedbackChange={panel.setLiveFeedback}
        voiceEnabled={panel.voiceEnabled}
        onVoiceEnabledChange={panel.setVoiceEnabled}
        transcriptShown={transcriptShown}
        onTranscriptShownChange={setTranscriptShown}
        finishDisabled={finishDisabled}
        onFinish={handleFinish}
        typedFallback={typedFallback}
        onSubmitTyped={panel.submitTyped}
        onRetryMic={() => { void panel.start(); }}
        compact={compact}
      />
    </div>
  );
}

export default TeachBackWindow;
