'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Mic, RotateCcw } from 'lucide-react';
import type {
  AppExecutionResult,
  TeachBackEvaluation,
  TeachBackEvaluationItem,
  TeachBackTurn,
} from '@/lib/ai-native/types';
import type { TranscriptSegment } from '@/types';
import { AppWindowPlaceholder } from '@/components/apps/windows/AppWindowPlaceholder';
import { TeachBackClassroom } from '@/components/apps/windows/TeachBackClassroom';
import { TeachBackQuadrantMap } from '@/components/apps/windows/TeachBackQuadrantMap';
import { TeachBackSpeakPanel } from '@/components/apps/windows/TeachBackSpeakPanel';
import { useTeachBackVoice } from '@/components/apps/windows/use-teach-back-voice';
import { formatTeachBackCompleteActivity } from '@/components/review-learning-activity';
import { COPY } from '@/lib/ui/copy';
import {
  buildTeachBackResultView,
  formatEvidenceTimestamp,
  normalizeTeachBackTargets,
  type TeachBackQuadrantGroup,
} from './teach-back-window-model';

interface TeachBackWindowProps {
  result: AppExecutionResult | null;
  transcript: TranscriptSegment[];
  contentContext?: string;
  onSeek?: (startMs: number) => void;
  onLearningActivity?: (line: string) => void;
}

// 2026-09：半双工语音版——学生用嘴分段讲（VoiceMicButton → /api/asr/oneshot，
// 可打字补充），每段讲完调 /api/apps/teach-back/respond 让同桌决定是否开口，
// 同桌的话经 useTeachSpeech（/api/teach/tts）出声；核对链路（/api/apps/teach-back/evaluate）不变。
type Phase = 'targets' | 'teach' | 'evaluating' | 'result';

const GROUP_STYLES: Record<TeachBackQuadrantGroup, { dot: string; text: string }> = {
  'blind-spot': { dot: 'bg-vermilion', text: 'text-vermilion' },
  'aware-gap': { dot: 'bg-ink-secondary', text: 'text-ink-secondary' },
  'productive-struggle': { dot: 'bg-pine', text: 'text-pine' },
  mastery: { dot: 'bg-pine', text: 'text-pine' },
  uncovered: { dot: 'bg-divider', text: 'text-ink-muted' },
};

function groupLabel(group: TeachBackQuadrantGroup): string {
  const copy = COPY.apps.teachBack;
  if (group === 'blind-spot') return copy.quadrantBlindSpot;
  if (group === 'aware-gap') return copy.quadrantGap;
  if (group === 'productive-struggle') return copy.quadrantStruggle;
  if (group === 'mastery') return copy.quadrantMastery;
  return copy.quadrantUncovered;
}

function EvidenceButton({ item, onSeek }: { item: TeachBackEvaluationItem; onSeek?: (startMs: number) => void }) {
  if (!item.evidence) return null;
  const label = `[${formatEvidenceTimestamp(item.evidence.startMs)}] ${COPY.apps.teachBack.backToEvidence}`;
  if (!onSeek) return <span className="font-mono-cite text-[11px] text-ink-muted">{label}</span>;
  return (
    <button
      type="button"
      onClick={() => onSeek(item.evidence!.startMs)}
      className="font-mono-cite text-[11px] text-pine underline decoration-pine/40 underline-offset-2 transition-colors hover:text-pine-mist"
    >
      {label}
    </button>
  );
}

export function TeachBackWindow({ result, transcript, contentContext, onSeek, onLearningActivity }: TeachBackWindowProps) {
  const targets = useMemo(() => normalizeTeachBackTargets(result), [result]);
  const [phase, setPhase] = useState<Phase>('targets');
  const [typedText, setTypedText] = useState('');
  const [evaluation, setEvaluation] = useState<TeachBackEvaluation | null>(null);
  const [evalFailed, setEvalFailed] = useState(false);
  const [rateLimited, setRateLimited] = useState(false);
  const [evalStage, setEvalStage] = useState(0);
  const [evalAttempt, setEvalAttempt] = useState(0);
  const [focusTargetIds, setFocusTargetIds] = useState<string[] | null>(null);
  const turnsRef = useRef<TeachBackTurn[]>([]);
  const evalRequestRef = useRef(0);
  const autoRetriedRef = useRef(false);
  const activityWrittenRef = useRef(false);

  /** 盲区单项重讲时只带这一个目标进教室；默认全部目标 */
  const activeTargets = useMemo(
    () => (focusTargetIds ? targets.filter((target) => focusTargetIds.includes(target.id)) : targets),
    [targets, focusTargetIds],
  );

  /* ── 半双工语音：分段讲述 → 同桌应答 → TTS 出声 ── */

  const voice = useTeachBackVoice({
    turnsRef,
    targets: activeTargets,
    metadata: contentContext ? { title: contentContext } : undefined,
  });
  const silenceRef = useRef(voice.silence);
  silenceRef.current = voice.silence;

  /** 离开窗口（卸载）时同桌立刻闭嘴 */
  useEffect(() => () => silenceRef.current(), []);

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
    const turns = turnsRef.current;
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
            metadata: contentContext ? { title: contentContext } : undefined,
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
  }, [phase, evalAttempt, activeTargets, transcript, contentContext]);

  /* ── 评估成功：写一次课后学习黑板（同时进客观学习动态流） ── */

  useEffect(() => {
    if (phase !== 'result' || !evaluation || activityWrittenRef.current) return;
    activityWrittenRef.current = true;
    if (evaluation.headline) {
      voice.feedDelta(evaluation.headline);
      voice.feedBreak();
    }
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
  }, [phase, evaluation, onLearningActivity, voice]);

  /* ── 核对：讲完进入 evaluating 阶段 ── */

  const startEvaluation = () => {
    autoRetriedRef.current = false;
    setRateLimited(false);
    setEvalFailed(false);
    setPhase('evaluating');
  };

  /** 提交输入框里这一段给同桌（同步 push 进 turnsRef，evaluate 读得到） */
  const submitPendingSegment = () => {
    const text = typedText.trim();
    if (!text) return;
    voice.submitUserSegment(text);
    setTypedText('');
  };

  const handleFinish = () => {
    submitPendingSegment();
    startEvaluation();
  };

  const handleRetry = () => {
    voice.silence();
    turnsRef.current = [];
    activityWrittenRef.current = false;
    setFocusTargetIds(null);
    setTypedText('');
    setEvaluation(null);
    setEvalFailed(false);
    setPhase('targets');
  };

  /* ── 渲染 ── */

  if (!result) {
    return <AppWindowPlaceholder status="loading" appName={COPY.apps.teachBack.appName} />;
  }
  if (targets.length === 0) {
    return <AppWindowPlaceholder status="empty" appName={COPY.apps.teachBack.appName} />;
  }

  if (phase === 'teach') {
    const hasUserTurn = turnsRef.current.some((turn) => turn.role === 'user');
    return (
      <div className="relative h-full min-h-0">
        <TeachBackClassroom
          lessonTitle={contentContext}
          targets={activeTargets}
        />

        {/* 半双工讲课：留在教室里，粉笔目标仍在黑板上；同桌在听，偶尔会开口 */}
        <TeachBackSpeakPanel
          speaking={voice.speaking}
          deskmateLines={voice.deskmateLines}
          pendingText={typedText}
          onPendingTextChange={setTypedText}
          onMicTranscript={(text) => setTypedText((prev) => prev + text)}
          onMicStart={voice.silence}
          onSubmitSegment={submitPendingSegment}
          onFinish={handleFinish}
          onBack={() => setPhase('targets')}
          finishDisabled={!hasUserTurn && !typedText.trim()}
        />
      </div>
    );
  }

  if (phase === 'evaluating') {
    const teachingChars = turnsRef.current
      .filter((turn) => turn.role === 'user')
      .reduce((total, turn) => total + turn.text.length, 0);
    const stageCopy = [
      COPY.apps.teachBack.evaluating,
      COPY.apps.teachBack.evaluatingStage2,
      COPY.apps.teachBack.evaluatingStage3,
    ][evalStage];
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-4 bg-paper px-6">
        {evalFailed ? (
          <>
            <p className="max-w-[320px] text-center text-[13px] leading-6 text-ink-secondary">
              {rateLimited ? COPY.apps.teachBack.evalRateLimited : COPY.apps.teachBack.evalFailed}
            </p>
            <p className="text-[12px] text-ink-muted">{COPY.apps.teachBack.yourTeachingStats(teachingChars)}</p>
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
                {COPY.apps.teachBack.retryEval}
              </button>
              <button type="button" onClick={handleRetry} className="text-[12px] text-ink-muted transition-colors hover:text-ink">
                {COPY.apps.teachBack.retry}
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
    return (
      <div className="flex h-full min-h-0 flex-col bg-paper">
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <h2 className="text-[17px] font-semibold text-ink">{COPY.apps.teachBack.resultTitle}</h2>
          {view.headline ? <p className="mt-1.5 text-[13px] leading-6 text-ink-secondary">{view.headline}</p> : null}
          <div className="mt-4">
            <TeachBackQuadrantMap items={evaluation.items} />
          </div>
          <div className="mt-5 flex flex-col gap-5">
            {view.groups.map((group) => (
              <section key={group.key}>
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${GROUP_STYLES[group.key].dot}`} />
                  <p className={`text-[13px] font-semibold ${GROUP_STYLES[group.key].text}`}>
                    {groupLabel(group.key)} · {group.items.length}
                  </p>
                </div>
                {group.key === 'blind-spot' ? (
                  <p className="mt-1 text-[12px] leading-5 text-ink-muted">{COPY.apps.teachBack.blindSpotHint}</p>
                ) : null}
                <div className="mt-2 flex flex-col gap-2">
                  {group.items.map((item) => (
                    <div
                      key={item.targetId}
                      className={`rounded-[14px] border bg-card px-4 py-3 ${
                        group.key === 'blind-spot' ? 'border-vermilion/35' : 'border-divider'
                      }`}
                    >
                      <p className="text-[14px] font-medium leading-6 text-ink">{item.point}</p>
                      <p className="mt-1 text-[12px] leading-5 text-ink-secondary">{item.note}</p>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <EvidenceButton item={item} onSeek={onSeek} />
                        {group.key === 'blind-spot' || group.key === 'aware-gap' ? (
                          <button
                            type="button"
                            onClick={() => {
                              voice.silence();
                              turnsRef.current = [];
                              activityWrittenRef.current = false;
                              setEvaluation(null);
                              setFocusTargetIds([item.targetId]);
                              setTypedText('');
                              voice.unlockAudio();
                              setPhase('teach');
                            }}
                            className="flex-shrink-0 rounded-full border border-pine/40 px-2.5 py-1 text-[11px] font-medium text-pine transition-colors hover:bg-pine-mist"
                          >
                            {COPY.apps.teachBack.reteachPoint}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center justify-between border-t border-divider bg-card px-5 py-3">
          <button type="button" onClick={handleRetry} className="text-[12px] text-ink-muted transition-colors hover:text-ink">
            {COPY.apps.teachBack.backToTargets}
          </button>
          <button
            type="button"
            onClick={() => {
              voice.silence();
              turnsRef.current = [];
              activityWrittenRef.current = false;
              setFocusTargetIds(null);
              setEvaluation(null);
              setTypedText('');
              voice.unlockAudio();
              setPhase('teach');
            }}
            className="rounded-full bg-pine px-5 py-2.5 text-[13px] font-medium text-white"
          >
            {COPY.apps.teachBack.retry}
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
        lessonTitle={contentContext}
        targets={activeTargets}
      />

      {/* 底部上台面板：毛玻璃浮在教室下方 */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-2.5 px-5 pb-6 pt-14" style={{ background: 'linear-gradient(180deg, transparent, rgba(242,240,233,0.92) 38%)' }}>
        <div className="pointer-events-auto flex w-full max-w-[420px] flex-col items-center gap-2.5 rounded-2xl border border-divider/80 bg-card/90 px-5 py-4 shadow-card backdrop-blur-md">
          <div className="text-center">
            <p className="text-[14px] font-semibold text-ink">{COPY.apps.teachBack.targetsTitle}</p>
            <p className="mt-0.5 text-[12px] text-ink-muted">{COPY.apps.teachBack.targetsSubtitle}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              turnsRef.current = [];
              setTypedText('');
              voice.unlockAudio();
              setPhase('teach');
            }}
            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-pine px-5 py-3 text-[14px] font-medium text-white transition-opacity hover:opacity-90"
          >
            <Mic size={15} strokeWidth={2} />
            {COPY.apps.teachBack.startVoice}
          </button>
          <p className="text-center text-[11px] leading-5 text-ink-muted">{COPY.apps.teachBack.voiceHint}</p>
        </div>
      </div>
    </div>
  );
}

export default TeachBackWindow;
