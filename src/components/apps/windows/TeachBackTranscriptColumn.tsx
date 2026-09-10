'use client';

/**
 * TeachBackTranscriptColumn — 面试间的左边：你的话。
 *
 * 开场是这节课要讲的几点（一张素列表，不是黑板）；开讲后几点淡出，转写从底部长出来往上流：
 * 当前这段大而安静（17px 墨色），讲过的段 15px 次级色、越早越淡。没有卡片、没有边框。
 * 自动跟到最新；你往上翻就停下，底部浮一枚「回到当前」（与播客同一套跟随思路）。
 * 点右边一条反馈 / 复盘句子 → 这里滚到那一段并高亮两秒。
 *
 * 底部一行状态：细波形 · 已讲 mm:ss · 一句状态词（在听你讲 / 停了一下 / 直言在说）；停顿只是一枚呼吸点。
 * 动作行（讲完了 / 实时反馈 开关 / 出声 开关 / 打字兜底）是独立组件 TeachBackControls，
 * 双栏时放在这一栏底部，堆叠时由窗口放到固定底栏。
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowDown, Mic } from 'lucide-react';
import type { TeachBackTarget } from '@/lib/ai-native/types';
import { APPS_COPY } from '@/lib/ui/copy-apps';
import type { StageMood, TurnPhase } from './teach-back-turn-machine';
import type { MicStatus } from './use-teach-back-panel';
import { formatClock, type TranscriptTurn } from './teach-back-room-model';

export type RoomStage = 'opening' | 'talking' | 'finished';

interface TranscriptColumnProps {
  stage: RoomStage;
  targets: TeachBackTarget[];
  turns: TranscriptTurn[];
  liveText: string;
  /** 点反馈后要滚到并高亮的回合；每次点击换一个新的 token 以便重复点同一条 */
  highlight: { turnIndex: number; token: number } | null;
  /** 堆叠单栏（复习页中栏 / 手机 / 小浮窗）：字号 16 / 14 */
  compact: boolean;
  children?: React.ReactNode;
}

/** 讲过的段：越早越淡，最近三段 1 → 0.85 → 0.7，再往前都是 0.6 */
function agedOpacity(distanceFromLatest: number): number {
  return [1, 0.85, 0.7][distanceFromLatest] ?? 0.6;
}

export function TeachBackTranscriptColumn({ stage, targets, turns, liveText, highlight, compact, children }: TranscriptColumnProps) {
  const copy = APPS_COPY.teachBack;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [following, setFollowing] = useState(true);
  const [flashTurn, setFlashTurn] = useState<number | null>(null);
  const [pointsVisible, setPointsVisible] = useState(stage === 'opening');
  const programmaticUntil = useRef(0);

  /* 开场那几点：开讲后淡出 450ms 再卸载 */
  useEffect(() => {
    if (stage === 'opening') {
      setPointsVisible(true);
      return undefined;
    }
    const timer = window.setTimeout(() => setPointsVisible(false), 450);
    return () => window.clearTimeout(timer);
  }, [stage]);

  const scrollToBottom = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    programmaticUntil.current = performance.now() + 400;
    node.scrollTop = node.scrollHeight;
  }, []);

  /* 自动跟随：内容长了就贴到底 */
  useLayoutEffect(() => {
    if (stage !== 'talking' || !following) return;
    scrollToBottom();
  }, [turns, liveText, following, stage, scrollToBottom]);

  /* 你往上翻 → 停止跟随；翻回底部 → 恢复 */
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return undefined;
    const onUserScroll = () => {
      if (performance.now() < programmaticUntil.current) return;
      setFollowing(false);
    };
    const onScroll = () => {
      if (performance.now() < programmaticUntil.current) return;
      const gap = node.scrollHeight - node.scrollTop - node.clientHeight;
      if (gap < 32) setFollowing(true);
    };
    node.addEventListener('wheel', onUserScroll, { passive: true });
    node.addEventListener('touchmove', onUserScroll, { passive: true });
    node.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      node.removeEventListener('wheel', onUserScroll);
      node.removeEventListener('touchmove', onUserScroll);
      node.removeEventListener('scroll', onScroll);
    };
  }, []);

  /* 点一条反馈：滚到那一段、高亮两秒、停止跟随 */
  useEffect(() => {
    if (!highlight) return undefined;
    const node = scrollRef.current;
    const target = node?.querySelector<HTMLElement>(`[data-turn-index="${highlight.turnIndex}"]`);
    if (!node || !target) return undefined;
    setFollowing(false);
    programmaticUntil.current = performance.now() + 600;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFlashTurn(highlight.turnIndex);
    const timer = window.setTimeout(() => setFlashTurn((current) => (current === highlight.turnIndex ? null : current)), 2400);
    return () => window.clearTimeout(timer);
  }, [highlight]);

  const backToCurrent = () => {
    setFollowing(true);
    scrollToBottom();
  };

  const currentSize = compact ? 'text-[16px] leading-7' : 'text-[18px] leading-8';
  const pastSize = compact ? 'text-[14px] leading-6' : 'text-[15px] leading-7';

  return (
    <section className="relative flex h-full min-h-0 flex-col" data-testid="teach-back-transcript" data-following={following || undefined}>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-6 pt-6 pb-4 sm:px-8">
        {/* 开场：这节课要讲的几点 */}
        {pointsVisible ? (
          <div className={`transition-opacity duration-[450ms] motion-reduce:transition-none ${stage === 'opening' ? 'opacity-100' : 'opacity-0'}`} data-testid="teach-back-opening-points">
            <p className="font-mono text-[11px] uppercase tracking-caps text-ink-muted">{copy.yourWords}</p>
            <h2 className={`mt-3 font-semibold text-ink ${compact ? 'text-[17px]' : 'text-[20px]'}`}>{copy.openingPointsTitle}</h2>
            <ol className="mt-5 flex flex-col gap-4">
              {targets.map((target, index) => (
                <li key={target.id} className="flex gap-4">
                  <span className="mt-1 w-5 shrink-0 font-mono text-[12px] text-ink-muted">{String(index + 1).padStart(2, '0')}</span>
                  <div className="min-w-0">
                    <p className={`text-ink ${compact ? 'text-[15px] leading-6' : 'text-[16px] leading-7'}`}>{target.point}</p>
                    {target.why ? <p className="mt-0.5 text-[13px] leading-5 text-ink-muted">{target.why}</p> : null}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        ) : null}

        {/* 讲述：从底部长出来，往上流 */}
        {stage !== 'opening' ? (
          <div className="flex min-h-full flex-col justify-end">
            <p className="mb-4 font-mono text-[11px] uppercase tracking-caps text-ink-muted">{copy.yourWords}</p>
            <div className="flex flex-col gap-4">
              {turns.map((turn, index) => {
                const distance = turns.length - 1 - index + (liveText.trim() ? 1 : 0);
                const flashing = flashTurn === turn.turnIndex;
                return (
                  <p
                    key={turn.turnIndex}
                    data-turn-index={turn.turnIndex}
                    title={`${formatClock(turn.startedAt)} – ${formatClock(turn.endedAt)}`}
                    className={`-mx-2 rounded px-2 text-ink-secondary transition-[background-color,opacity] duration-500 motion-reduce:transition-none ${pastSize} ${flashing ? 'bg-pine-fog text-ink' : ''}`}
                    style={{ opacity: flashing ? 1 : agedOpacity(distance) }}
                  >
                    {turn.text}
                  </p>
                );
              })}
              {liveText.trim() ? (
                <p className={`text-ink ${currentSize}`} data-testid="teach-back-live-transcript">{liveText}</p>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {stage === 'talking' && !following ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-[68px] z-10 flex justify-center">
          <button
            type="button"
            onClick={backToCurrent}
            className="mm-pop-in mm-press mm-focus pointer-events-auto inline-flex h-8 items-center gap-1.5 rounded-full bg-ink px-3.5 text-[12px] font-medium text-white shadow-float"
            data-testid="teach-back-back-to-current"
          >
            <ArrowDown size={13} strokeWidth={2} aria-hidden />
            {copy.backToCurrent}
          </button>
        </div>
      ) : null}

      {children}
    </section>
  );
}

/* ── 底部状态行：细波形 · 已讲 mm:ss · 状态词 ── */

interface StatusLineProps {
  stage: RoomStage;
  status: MicStatus;
  phase: TurnPhase;
  mood: StageMood;
  levels: number[];
  elapsedMs: number;
  activeJudgeName: string | null;
  requestInFlight: boolean;
  onRetryMic: () => void;
}

function Waveform({ levels, quiet }: { levels: number[]; quiet: boolean }) {
  const bars = Array.from({ length: 24 }, (_, index) => levels[levels.length - 24 + index] ?? 0);
  return (
    <div className="flex h-4 items-center gap-[2px]" aria-hidden>
      {bars.map((level, index) => (
        <span
          key={index}
          className={`w-[2px] rounded-full ${quiet ? 'bg-divider' : 'bg-pine'}`}
          style={{ height: `${Math.max(2, Math.round(level * 16))}px`, transition: 'height 80ms linear' }}
        />
      ))}
    </div>
  );
}

export function TeachBackStatusLine({ stage, status, phase, mood, levels, elapsedMs, activeJudgeName, requestInFlight, onRetryMic }: StatusLineProps) {
  const copy = APPS_COPY.teachBack;
  const trouble = status === 'mic-denied' ? copy.micDenied
    : status === 'mic-lost' ? copy.micLost
      : status === 'mic-busy' ? copy.micBusy
        : status === 'asr-down' ? copy.asrDown
          : null;
  const word = stage === 'finished' ? copy.statusFinished
    : phase === 'calibrating' || status === 'connecting' ? copy.statusCalibrating
      : mood === 'judge' && activeJudgeName ? copy.statusSpeaking(activeJudgeName)
        : requestInFlight ? copy.statusThinking
          : mood === 'pausing' ? copy.statusPausing
            : copy.statusListening;

  return (
    <div className="flex min-h-[32px] items-center gap-4 px-6 sm:px-8" data-testid="teach-back-status" data-word={word}>
      {stage === 'talking' && !trouble ? <Waveform levels={levels} quiet={mood !== 'speaking'} /> : null}
      <span className="font-mono text-[12px] tabular-nums text-ink-muted">{copy.elapsed(formatClock(elapsedMs))}</span>
      {trouble && stage === 'talking' ? (
        <span className="flex min-w-0 items-center gap-3 text-[13px] text-ink-secondary">
          <span className="truncate">{trouble}</span>
          {status !== 'mic-busy' ? (
            <button type="button" onClick={onRetryMic} className="mm-focus inline-flex shrink-0 items-center gap-1 rounded text-[13px] font-medium text-pine">
              <Mic size={12} strokeWidth={2} aria-hidden />
              {copy.reconnectMic}
            </button>
          ) : null}
        </span>
      ) : (
        <span className="flex items-center gap-2 text-[13px] text-ink-secondary">
          {mood === 'pausing' && stage === 'talking' ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-muted motion-reduce:animate-none" aria-hidden /> : null}
          {word}
        </span>
      )}
    </div>
  );
}

/* ── 动作行：讲完了 · 实时反馈 开/关 · 出声 开/关 · 打字兜底 ── */

interface ControlsProps {
  stage: RoomStage;
  finishDisabled: boolean;
  onStart: () => void;
  onFinish: () => void;
  liveFeedback: boolean;
  onLiveFeedbackChange: (enabled: boolean) => void;
  voiceEnabled: boolean;
  onVoiceEnabledChange: (enabled: boolean) => void;
  /** 麦克风不可用时才显示打字的一小行 */
  typedFallback: boolean;
  onSubmitTyped: (text: string) => void;
  compact: boolean;
}

function WordSwitch({ label, on, onChange, testId }: { label: string; on: boolean; onChange: (next: boolean) => void; testId: string }) {
  const copy = APPS_COPY.teachBack;
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      aria-pressed={on}
      data-testid={testId}
      className="mm-focus inline-flex items-center gap-1.5 rounded text-[13px] text-ink-secondary transition-colors hover:text-ink"
    >
      <span>{label}</span>
      <span className={`underline-offset-[5px] ${on ? 'font-medium text-ink underline decoration-ink' : 'text-ink-muted'}`}>{on ? copy.toggleOn : copy.toggleOff}</span>
    </button>
  );
}

export function TeachBackControls({
  stage, finishDisabled, onStart, onFinish, liveFeedback, onLiveFeedbackChange, voiceEnabled, onVoiceEnabledChange, typedFallback, onSubmitTyped, compact,
}: ControlsProps) {
  const copy = APPS_COPY.teachBack;
  const [typed, setTyped] = useState('');
  const submitTyped = (event: FormEvent) => {
    event.preventDefault();
    const text = typed.trim();
    if (!text) return;
    onSubmitTyped(text);
    setTyped('');
  };
  if (stage === 'finished') return null;
  return (
    <div className={`flex flex-col gap-2 ${compact ? 'px-4 py-3' : 'px-6 pb-6 pt-3 sm:px-8'}`} data-testid="teach-back-controls">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {stage === 'opening' ? (
          <button
            type="button"
            onClick={onStart}
            className="mm-press mm-focus inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full bg-pine px-6 text-[14px] font-medium text-white hover:opacity-90"
            data-testid="teach-back-start"
          >
            <Mic size={15} strokeWidth={2} aria-hidden />
            {copy.startVoice}
          </button>
        ) : (
          <button
            type="button"
            onClick={onFinish}
            disabled={finishDisabled}
            title={finishDisabled ? copy.finishDisabledHint : undefined}
            className="mm-press mm-focus inline-flex min-h-[44px] items-center justify-center rounded-full bg-ink px-6 text-[14px] font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            data-testid="teach-back-finish"
          >
            {copy.finishText}
          </button>
        )}
        <WordSwitch label={copy.liveFeedbackLabel} on={liveFeedback} onChange={onLiveFeedbackChange} testId="teach-back-live-feedback" />
        <WordSwitch label={copy.voiceLabel} on={voiceEnabled} onChange={onVoiceEnabledChange} testId="teach-back-voice" />
      </div>
      {stage === 'opening' ? <p className="text-[12px] leading-5 text-ink-muted">{liveFeedback ? copy.voiceHint : copy.liveFeedbackOffHint}</p> : null}
      {stage === 'talking' && typedFallback ? (
        <form onSubmit={submitTyped}>
          <input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder={copy.typeFallbackPlaceholder}
            className="w-full max-w-[420px] border-b border-divider bg-transparent py-1 text-[13px] text-ink placeholder:text-ink-muted focus:border-ink focus:outline-none"
            data-testid="teach-back-typed-input"
          />
        </form>
      ) : null}
    </div>
  );
}
