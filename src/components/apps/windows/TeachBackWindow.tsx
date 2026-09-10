'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Mic, RotateCcw } from 'lucide-react';
import type {
  AppExecutionResult,
  TeachBackEvaluation,
  TeachBackEvaluationItem,
  TeachBackQuadrant,
  TeachBackTurn,
} from '@/lib/ai-native/types';
import type { TranscriptSegment } from '@/types';
import { AppWindowPlaceholder } from '@/components/apps/windows/AppWindowPlaceholder';
import { TeachBackClassroom } from '@/components/apps/windows/TeachBackClassroom';
import { TeachBackQuadrantMap } from '@/components/apps/windows/TeachBackQuadrantMap';
import { TeachBackPodium } from '@/components/apps/windows/TeachBackPodium';
import { useTeachBackPanel } from '@/components/apps/windows/use-teach-back-panel';
import { formatTeachBackCompleteActivity } from '@/components/review-learning-activity';
import { buildTeachBackAssessment, type AssessmentDraft } from './assessment-events';
import { NextStepCard, type NextStepCardProps } from './NextStepCard';
import { APPS_COPY } from '@/lib/ui/copy-apps';
import {
  buildTeachBackResultView,
  formatEvidenceTimestamp,
  normalizeTeachBackTargets,
  type TeachBackQuadrantGroup,
} from './teach-back-window-model';

interface TeachBackWindowProps {
  result: AppExecutionResult | null;
  transcript: TranscriptSegment[];
  /**
   * 课名（黑板抬头 + 请求 metadata.title）。此前这里接的是 AppRenderSurface 的信息图正文上下文——
   * 1400 字转录正文——黑板抬头滚着整段转录，metadata.title 也超过接口 200 字上限，
   * respond / evaluate 全部 400「请求内容不完整」，讲给同桌听在所有宿主里都核对不了。
   */
  contextTitle?: string;
  onSeek?: (startMs: number) => void;
  onLearningActivity?: (line: string) => void;
  /** 评估完成后把每个目标点的象限 + 证据交给记忆（结构化） */
  onAssessment?: (draft: AssessmentDraft) => void;
  /** 完成态里同桌接着说的下一步 */
  nextStep?: NextStepCardProps;
}

// 2026-09-10：连续讲述版——走上讲台后麦克风常开（课堂录音同一条实时 ASR 通道），
// 能量 VAD + 句末事件判"这一段讲完了"→ 评委席（直言 / 引导 / 追问）一位开口（/api/apps/teach-back/turn SSE）
// → 气泡流式 + TTS 出声（三种声音）→ 你一开口评委就停；编排在 use-teach-back-panel.ts，
// 判定在 teach-back-turn-machine.ts。核对链路（/api/apps/teach-back/evaluate）与象限语义不变。
type Phase = 'targets' | 'teach' | 'evaluating' | 'result';

const GROUP_STYLES: Record<TeachBackQuadrantGroup, { dot: string; text: string }> = {
  'blind-spot': { dot: 'bg-vermilion', text: 'text-vermilion' },
  'aware-gap': { dot: 'bg-ink-secondary', text: 'text-ink-secondary' },
  'productive-struggle': { dot: 'bg-pine', text: 'text-pine' },
  mastery: { dot: 'bg-pine', text: 'text-pine' },
  uncovered: { dot: 'bg-divider', text: 'text-ink-muted' },
};

function groupLabel(group: TeachBackQuadrantGroup): string {
  const copy = APPS_COPY.teachBack;
  if (group === 'blind-spot') return copy.quadrantBlindSpot;
  if (group === 'aware-gap') return copy.quadrantGap;
  if (group === 'productive-struggle') return copy.quadrantStruggle;
  if (group === 'mastery') return copy.quadrantMastery;
  return copy.quadrantUncovered;
}

/**
 * 回到老师原话——最轻的存在：一枚 ↩，hover 这一条时才出现，title 里才有时间戳。
 * 此前是「[MM:SS] 回到老师原话」一整行绿链接，把核对结果页做成了引用系统的展示柜。
 */
function EvidenceButton({ item, onSeek }: { item: TeachBackEvaluationItem; onSeek?: (startMs: number) => void }) {
  if (!item.evidence || !onSeek) return null;
  const startMs = item.evidence.startMs;
  return (
    <button
      type="button"
      onClick={() => onSeek(startMs)}
      title={`${APPS_COPY.teachBack.backToEvidence} · ${formatEvidenceTimestamp(startMs)}`}
      aria-label={`${APPS_COPY.teachBack.backToEvidence} ${formatEvidenceTimestamp(startMs)}`}
      className="text-[12px] text-ink-muted opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-ink"
    >
      ↩
    </button>
  );
}

/** 结果页：回看本场每个回合——你讲了什么 / 谁说了什么（细线列表，评委名字是小字眉题） */
function RoundsReview({ turns }: { turns: TeachBackTurn[] }) {
  const copy = APPS_COPY.teachBack;
  const userTurns = turns.filter((turn) => turn.role === 'user').length;
  return (
    <section data-testid="teach-back-rounds">
      <div className="flex items-baseline justify-between">
        <p className="text-[13px] font-semibold text-ink">{copy.roundsTitle}</p>
        <p className="text-[11px] text-ink-muted">{copy.roundCount(userTurns)}</p>
      </div>
      {turns.length === 0 ? (
        <p className="mt-2 text-[12px] leading-5 text-ink-muted">{copy.roundsEmpty}</p>
      ) : (
        <div className="mt-2 divide-y divide-divider">
          {turns.map((turn, index) => {
            const speaker = turn.role === 'user'
              ? copy.roundYou
              : turn.judgeId ? copy.judges[turn.judgeId].name : copy.roundDeskmate;
            return (
              <div key={`${index}-${turn.text.slice(0, 12)}`} className={`py-2.5 ${turn.role === 'user' ? '' : 'pl-4'}`}>
                <p className={`font-mono text-[10px] uppercase tracking-caps ${turn.role === 'user' ? 'text-ink-muted' : 'text-pine'}`}>{speaker}</p>
                <p className={`mt-0.5 text-[13px] leading-6 ${turn.role === 'user' ? 'text-ink' : 'text-ink-secondary'}`}>{turn.text}</p>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function TeachBackWindow({ result, transcript, contextTitle, onSeek, onLearningActivity, onAssessment, nextStep }: TeachBackWindowProps) {
  // 接口 metadata.title 上限 200 字；课名再长也只取这么多
  const lessonTitle = contextTitle?.trim().slice(0, 200) || undefined;
  const targets = useMemo(() => normalizeTeachBackTargets(result), [result]);
  const [phase, setPhase] = useState<Phase>('targets');
  const [evaluation, setEvaluation] = useState<TeachBackEvaluation | null>(null);
  const [evalFailed, setEvalFailed] = useState(false);
  const [rateLimited, setRateLimited] = useState(false);
  const [evalStage, setEvalStage] = useState(0);
  const [evalAttempt, setEvalAttempt] = useState(0);
  const [focusTargetIds, setFocusTargetIds] = useState<string[] | null>(null);
  /** 结果页：点象限格子后高亮的那一组（1.4s 后自动褪去） */
  const [activeGroup, setActiveGroup] = useState<TeachBackQuadrant | null>(null);
  /** 结果页回看用：evaluate 时快照一份本场记录 */
  const [roundsSnapshot, setRoundsSnapshot] = useState<TeachBackTurn[]>([]);
  const groupRefs = useRef<Partial<Record<TeachBackQuadrantGroup, HTMLElement | null>>>({});
  const turnsRef = useRef<TeachBackTurn[]>([]);
  const evalRequestRef = useRef(0);
  const autoRetriedRef = useRef(false);
  const activityWrittenRef = useRef(false);

  /** 盲区单项重讲时只带这一个目标进教室；默认全部目标 */
  const activeTargets = useMemo(
    () => (focusTargetIds ? targets.filter((target) => focusTargetIds.includes(target.id)) : targets),
    [targets, focusTargetIds],
  );
  const metadata = useMemo(() => (lessonTitle ? { title: lessonTitle } : undefined), [lessonTitle]);

  /* ── 连续讲述：麦克风常开 → 回合 → 评委席 ── */

  const panel = useTeachBackPanel({ turnsRef, targets: activeTargets, transcript, metadata });

  /* ── 评估等待：分阶段文案，让 10-40 秒的等待有进展感 ── */

  useEffect(() => {
    if (phase !== 'evaluating' || evalFailed) return undefined;
    setEvalStage(0);
    const timer = window.setInterval(() => setEvalStage((stage) => Math.min(stage + 1, 2)), 4_500);
    return () => window.clearInterval(timer);
  }, [phase, evalFailed]);

  /* ── 评估：进入 evaluating 阶段时执行；首次失败自动重试一次，二次才示弱 ── */

  useEffect(() => {
    if (phase !== 'evaluating') return;
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
          body: JSON.stringify({
            targets: activeTargets,
            teachingTurns: turns,
            transcript: slimTranscript,
            metadata,
          }),
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
        setPhase('result');
      } catch {
        if (evalRequestRef.current !== requestId) return;
        // 第一次失败：静默自动重试一次（部署重启窗口、模型抖动都不该打扰用户）
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
  }, [phase, evalAttempt, activeTargets, transcript, metadata]);

  /* ── 评估成功：写一次课后学习黑板（同时进客观学习动态流） ── */

  useEffect(() => {
    if (phase !== 'result' || !evaluation || activityWrittenRef.current) return;
    activityWrittenRef.current = true;
    if (evaluation.headline) panel.speakLine(evaluation.headline);
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
  }, [phase, evaluation, onAssessment, onLearningActivity, panel]);

  /* ── 上台 / 核对 / 重讲 ── */

  const enterStage = (focus: string[] | null) => {
    turnsRef.current = [];
    activityWrittenRef.current = false;
    setEvaluation(null);
    setFocusTargetIds(focus);
    setPhase('teach');
    // 同一个用户手势里拿麦克风权限（getUserMedia 是 start 里的第一个 await）
    void panel.start();
  };

  const startEvaluation = () => {
    autoRetriedRef.current = false;
    setRateLimited(false);
    setEvalFailed(false);
    setPhase('evaluating');
  };

  const handleFinish = () => {
    panel.finish(); // 同步把没提交的尾巴记进 turnsRef，并停掉麦克风与声音
    setRoundsSnapshot(turnsRef.current);
    startEvaluation();
  };

  const handleBackToTargets = () => {
    panel.stop();
    turnsRef.current = [];
    activityWrittenRef.current = false;
    setFocusTargetIds(null);
    setEvaluation(null);
    setEvalFailed(false);
    setPhase('targets');
  };

  /* ── 渲染 ── */

  if (!result) {
    return <AppWindowPlaceholder status="loading" appName={APPS_COPY.teachBack.appName} transcript={transcript} />;
  }
  if (targets.length === 0) {
    return <AppWindowPlaceholder status="empty" appName={APPS_COPY.teachBack.appName} />;
  }

  if (phase === 'teach') {
    const hasUserTurn = panel.turnCount > 0 || turnsRef.current.some((turn) => turn.role === 'user');
    return (
      <div className="relative h-full min-h-0">
        <TeachBackClassroom
          lessonTitle={lessonTitle}
          targets={activeTargets}
          judges={panel.judges}
          mood={panel.mood}
        />
        <TeachBackPodium
          status={panel.status}
          phase={panel.phase}
          mood={panel.mood}
          levels={panel.levels}
          liveText={panel.liveText}
          lastCommitted={panel.lastCommitted}
          activeJudge={panel.activeJudge}
          voiceEnabled={panel.voiceEnabled}
          onVoiceEnabledChange={panel.setVoiceEnabled}
          onFinish={handleFinish}
          finishDisabled={!hasUserTurn && !panel.liveText.trim()}
          onBack={handleBackToTargets}
          onRestart={() => { void panel.start(); }}
          onSubmitTyped={panel.submitTyped}
        />
      </div>
    );
  }

  if (phase === 'evaluating') {
    const teachingChars = turnsRef.current
      .filter((turn) => turn.role === 'user')
      .reduce((total, turn) => total + turn.text.length, 0);
    const stageCopy = [
      APPS_COPY.teachBack.evaluating,
      APPS_COPY.teachBack.evaluatingStage2,
      APPS_COPY.teachBack.evaluatingStage3,
    ][evalStage];
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-4 bg-paper px-6" data-testid="teach-back-evaluating">
        {evalFailed ? (
          <>
            <p className="max-w-[320px] text-center text-[13px] leading-6 text-ink-secondary">
              {rateLimited ? APPS_COPY.teachBack.evalRateLimited : APPS_COPY.teachBack.evalFailed}
            </p>
            <p className="text-[12px] text-ink-muted">{APPS_COPY.teachBack.yourTeachingStats(teachingChars)}</p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setRateLimited(false);
                  setEvalAttempt((attempt) => attempt + 1);
                }}
                className="inline-flex items-center gap-1.5 rounded-full bg-pine px-4 py-2 text-[12px] font-medium text-white"
              >
                <RotateCcw size={13} strokeWidth={2} />
                {APPS_COPY.teachBack.retryEval}
              </button>
              <button type="button" onClick={handleBackToTargets} className="text-[12px] text-ink-muted transition-colors hover:text-ink">
                {APPS_COPY.teachBack.retry}
              </button>
            </div>
          </>
        ) : (
          <>
            <span className="thinking-strip h-1 w-40 rounded-full" />
            <p className="max-w-[320px] text-center text-[13px] leading-6 text-ink-secondary">{stageCopy}</p>
          </>
        )}
      </div>
    );
  }

  if (phase === 'result' && evaluation) {
    const view = buildTeachBackResultView(evaluation);
    const jumpToGroup = (quadrant: TeachBackQuadrant) => {
      const section = groupRefs.current[quadrant];
      section?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveGroup(quadrant);
      window.setTimeout(() => setActiveGroup((current) => (current === quadrant ? null : current)), 1400);
    };
    // 结果揭示：标题 → 一句话 → 象限地图 → 一组一张纸依次浮出（mm-stagger）→ 本场回合
    return (
      <div className="flex h-full min-h-0 flex-col bg-paper" data-testid="teach-back-result">
        <div className="mm-stagger min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <h2 className="text-[17px] font-semibold text-ink">{APPS_COPY.teachBack.resultTitle}</h2>
          {view.headline ? <p className="mt-1.5 text-[13px] leading-6 text-ink-secondary">{view.headline}</p> : null}
          <div className="mt-4">
            <TeachBackQuadrantMap items={evaluation.items} onSelectQuadrant={jumpToGroup} activeQuadrant={activeGroup} />
          </div>
          <div className="mm-stagger mt-5 flex flex-col gap-5">
            {view.groups.map((group) => (
              <section
                key={group.key}
                ref={(node) => { groupRefs.current[group.key] = node; }}
                data-group={group.key}
                className={`-mx-2 rounded-xl px-2 transition-[background-color] duration-300 motion-reduce:transition-none ${activeGroup === group.key ? 'bg-pine-fog/70' : ''}`}
              >
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${GROUP_STYLES[group.key].dot}`} />
                  <p className={`text-[13px] font-semibold ${GROUP_STYLES[group.key].text}`}>
                    {groupLabel(group.key)} · {group.items.length}
                  </p>
                </div>
                {group.key === 'blind-spot' ? (
                  <p className="mt-1 text-[12px] leading-5 text-ink-muted">{APPS_COPY.teachBack.blindSpotHint}</p>
                ) : null}
                {/* 一组一张纸：条目之间只有一道细线；盲区用左侧一道朱批竖线标出，不再一条一个描边卡片 */}
                <div className="mt-2 divide-y divide-divider">
                  {group.items.map((item) => (
                    <div
                      key={item.targetId}
                      className={`group flex gap-3 py-3 ${group.key === 'blind-spot' ? 'border-l-2 border-vermilion pl-3' : ''}`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] font-medium leading-6 text-ink">{item.point}</p>
                        <p className="mt-0.5 text-[12px] leading-5 text-ink-secondary">{item.note}</p>
                      </div>
                      <div className="flex shrink-0 items-start gap-3 pt-1">
                        <EvidenceButton item={item} onSeek={onSeek} />
                        {group.key === 'blind-spot' || group.key === 'aware-gap' ? (
                          <button
                            type="button"
                            onClick={() => enterStage([item.targetId])}
                            className="mm-focus rounded text-[12px] font-medium text-pine underline decoration-pine/30 underline-offset-[3px] transition-colors hover:decoration-pine"
                          >
                            {APPS_COPY.teachBack.reteachPoint}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
            <RoundsReview turns={roundsSnapshot} />
          </div>
          {nextStep ? <NextStepCard {...nextStep} /> : null}
        </div>
        <div className="flex flex-shrink-0 items-center justify-between border-t border-divider bg-card px-5 py-3">
          <button type="button" onClick={handleBackToTargets} className="mm-focus rounded text-[12px] text-ink-muted transition-colors hover:text-ink">
            {APPS_COPY.teachBack.backToTargets}
          </button>
          <button
            type="button"
            onClick={() => enterStage(null)}
            className="mm-press mm-focus rounded-full bg-pine px-5 py-2.5 text-[13px] font-medium text-white"
          >
            {APPS_COPY.teachBack.retry}
          </button>
        </div>
      </div>
    );
  }

  /* phase === 'targets'（含 evaluating 完成后 evaluation 缺失的兜底）：
     入口就是教室——粉笔目标在黑板上，学生在等你，不用再读一张清单 */
  return (
    <div className="relative h-full min-h-0">
      <TeachBackClassroom
        lessonTitle={lessonTitle}
        targets={activeTargets}
      />

      {/* 底部上台面板：毛玻璃浮在教室下方 */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-2.5 px-5 pb-6 pt-14" style={{ background: 'linear-gradient(180deg, transparent, rgba(242,240,233,0.92) 38%)' }}>
        <div className="mm-app-enter pointer-events-auto flex w-full max-w-[420px] flex-col items-center gap-2.5 rounded-2xl border border-divider/80 bg-card/90 px-5 py-4 shadow-card backdrop-blur-md">
          <div className="text-center">
            <p className="text-[14px] font-semibold text-ink">{APPS_COPY.teachBack.targetsTitle}</p>
            <p className="mt-0.5 text-[12px] text-ink-muted">{APPS_COPY.teachBack.targetsSubtitle}</p>
          </div>
          <button
            type="button"
            onClick={() => enterStage(null)}
            className="mm-press mm-focus inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-full bg-pine px-5 py-3 text-[14px] font-medium text-white hover:opacity-90"
            data-testid="teach-back-start"
          >
            <Mic size={15} strokeWidth={2} />
            {APPS_COPY.teachBack.startVoice}
          </button>
          <p className="text-center text-[11px] leading-5 text-ink-muted">{APPS_COPY.teachBack.voiceHint}</p>
        </div>
      </div>
    </div>
  );
}

export default TeachBackWindow;
