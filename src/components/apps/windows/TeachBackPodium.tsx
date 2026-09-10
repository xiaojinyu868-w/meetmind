'use client';

/**
 * TeachBackPodium — 讲者自己 = 一个安静的讲台：画面底部一条讲台栏。
 *
 * 左边麦克风状态（一枚呼吸的圆点 + 细波形；麦克风出问题时同位置一行人话 + 重新开麦；拿不到麦克风时打字一小行），
 * 中间已讲时长（mono），右边三个图标开关（实时反馈 = 一只耳朵 / 出声 = 一个喇叭 / 转写 = 一卷字；选中态实心，
 * `title` 里才有字）和主按钮「讲完了」。开场时主按钮在画面中央（TeachBackOpening），讲台栏只摆开关。
 *
 * 没有实时转写：转写默认藏着——「转写」开着时讲台上方出一条 12px 灰字的单行（TeachBackTicker），
 * 给需要确认识别的人；整场文字在复盘里可展开。
 */

import { useState, type FormEvent } from 'react';
import { Ear, Mic, MicOff, ScrollText, Volume2, VolumeX } from 'lucide-react';
import { APPS_COPY } from '@/lib/ui/copy-apps';
import type { StageMood } from './teach-back-turn-machine';
import type { MicStatus } from './use-teach-back-panel';
import { formatClock, type RoomStage } from './teach-back-room-model';

function Waveform({ levels, active, bars }: { levels: number[]; active: boolean; bars: number }) {
  const shown = Array.from({ length: bars }, (_, index) => levels[levels.length - bars + index] ?? 0);
  return (
    <div className="flex h-4 items-center gap-[2px]" aria-hidden>
      {shown.map((level, index) => (
        <span
          key={index}
          className={`w-[2px] rounded-full ${active ? 'bg-pine' : 'bg-divider'}`}
          style={{ height: `${Math.max(2, Math.round(level * 16))}px`, transition: 'height 80ms linear' }}
        />
      ))}
    </div>
  );
}

interface IconToggleProps {
  on: boolean;
  onChange: (next: boolean) => void;
  title: string;
  icon: React.ReactNode;
  testId: string;
  disabled?: boolean;
}

function IconToggle({ on, onChange, title, icon, testId, disabled }: IconToggleProps) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      aria-pressed={on}
      aria-label={title}
      title={title}
      disabled={disabled}
      data-testid={testId}
      className={`mm-press mm-focus inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors disabled:cursor-default disabled:opacity-40 ${
        on ? 'bg-ink text-white' : 'text-ink-muted ring-1 ring-inset ring-divider hover:text-ink'
      }`}
    >
      {icon}
    </button>
  );
}

interface PodiumProps {
  stage: RoomStage;
  status: MicStatus;
  mood: StageMood;
  levels: number[];
  elapsedMs: number;
  liveFeedback: boolean;
  onLiveFeedbackChange: (enabled: boolean) => void;
  voiceEnabled: boolean;
  onVoiceEnabledChange: (enabled: boolean) => void;
  transcriptShown: boolean;
  onTranscriptShownChange: (shown: boolean) => void;
  finishDisabled: boolean;
  onFinish: () => void;
  /** 麦克风不可用时才显示打字的一小行 */
  typedFallback: boolean;
  onSubmitTyped: (text: string) => void;
  onRetryMic: () => void;
  compact: boolean;
}

export function TeachBackPodium({
  stage, status, mood, levels, elapsedMs, liveFeedback, onLiveFeedbackChange, voiceEnabled, onVoiceEnabledChange,
  transcriptShown, onTranscriptShownChange, finishDisabled, onFinish, typedFallback, onSubmitTyped, onRetryMic, compact,
}: PodiumProps) {
  const copy = APPS_COPY.teachBack;
  const [typed, setTyped] = useState('');
  const submitTyped = (event: FormEvent) => {
    event.preventDefault();
    const text = typed.trim();
    if (!text) return;
    onSubmitTyped(text);
    setTyped('');
  };
  const talking = stage === 'talking';
  const trouble = talking
    ? status === 'mic-denied' ? copy.micDenied
      : status === 'mic-lost' ? copy.micLost
        : status === 'mic-busy' ? copy.micBusy
          : status === 'asr-down' ? copy.asrDown
            : null
    : null;
  const micLive = talking && status === 'live';
  const connecting = talking && status === 'connecting';

  return (
    <div
      className={`flex shrink-0 items-center border-t border-divider bg-paper ${compact ? 'h-14 gap-3 px-4' : 'h-16 gap-5 px-6'}`}
      data-testid="teach-back-podium"
      data-mic={micLive ? 'live' : connecting ? 'connecting' : trouble ? 'trouble' : 'off'}
    >
      {/* 麦克风：一枚呼吸的圆点 + 细波形 */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {trouble ? (
          <span className="flex min-w-0 items-center gap-2.5 text-[13px] text-ink-secondary" data-testid="teach-back-mic-trouble">
            <MicOff size={14} strokeWidth={2} className="shrink-0 text-vermilion" aria-hidden />
            <span className="truncate">{trouble}</span>
            {status !== 'mic-busy' ? (
              <button type="button" onClick={onRetryMic} className="mm-focus inline-flex shrink-0 items-center gap-1 rounded text-[13px] font-medium text-pine">
                <Mic size={12} strokeWidth={2} aria-hidden />
                {copy.reconnectMic}
              </button>
            ) : null}
          </span>
        ) : (
          <>
            <span
              className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                micLive ? 'rec-dot' : connecting ? 'animate-pulse bg-ink-muted motion-reduce:animate-none' : 'bg-divider'
              }`}
              title={micLive ? copy.micOnTitle : undefined}
              aria-hidden
            />
            {talking && typedFallback ? (
              <form onSubmit={submitTyped} className="min-w-0 flex-1">
                <input
                  value={typed}
                  onChange={(event) => setTyped(event.target.value)}
                  placeholder={copy.typeFallbackPlaceholder}
                  className="w-full max-w-[360px] border-b border-divider bg-transparent py-1 text-[13px] text-ink placeholder:text-ink-muted focus:border-ink focus:outline-none"
                  data-testid="teach-back-typed-input"
                />
              </form>
            ) : (
              <Waveform levels={micLive ? levels : []} active={micLive && mood === 'speaking'} bars={compact ? 14 : 24} />
            )}
          </>
        )}
      </div>

      {/* 已讲时长 */}
      <span className="font-mono text-[13px] tabular-nums text-ink-secondary" title={copy.elapsedTitle} data-testid="teach-back-clock">
        {formatClock(elapsedMs)}
      </span>

      {/* 三个开关 + 主按钮 */}
      <div className={`flex items-center ${compact ? 'gap-1.5' : 'gap-2'}`}>
        <IconToggle
          on={liveFeedback}
          onChange={onLiveFeedbackChange}
          title={liveFeedback ? copy.liveFeedbackOnTitle : copy.liveFeedbackOffTitle}
          icon={<Ear size={16} strokeWidth={1.9} aria-hidden />}
          testId="teach-back-live-feedback"
          disabled={stage === 'finished'}
        />
        <IconToggle
          on={voiceEnabled}
          onChange={onVoiceEnabledChange}
          title={voiceEnabled ? copy.voiceOnTitle : copy.voiceOffTitle}
          icon={voiceEnabled ? <Volume2 size={16} strokeWidth={1.9} aria-hidden /> : <VolumeX size={16} strokeWidth={1.9} aria-hidden />}
          testId="teach-back-voice"
        />
        <IconToggle
          on={transcriptShown}
          onChange={onTranscriptShownChange}
          title={transcriptShown ? copy.transcriptOnTitle : copy.transcriptOffTitle}
          icon={<ScrollText size={16} strokeWidth={1.9} aria-hidden />}
          testId="teach-back-transcript-toggle"
          disabled={stage === 'finished'}
        />
        {talking ? (
          <button
            type="button"
            onClick={onFinish}
            disabled={finishDisabled}
            title={finishDisabled ? copy.finishDisabledHint : undefined}
            className={`mm-press mm-focus inline-flex items-center justify-center rounded-full bg-ink font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 ${
              compact ? 'ml-1 h-10 px-4 text-[13px]' : 'ml-2 h-11 px-6 text-[14px]'
            }`}
            data-testid="teach-back-finish"
          >
            {copy.finishText}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** 「转写」开着时讲台上方的一行：只看得见最后一截（给需要确认识别的人） */
export function TeachBackTicker({ text }: { text: string }) {
  return (
    <div className="flex h-6 shrink-0 items-center justify-end overflow-hidden px-6" data-testid="teach-back-ticker" aria-live="off">
      <span className="shrink-0 whitespace-nowrap text-[12px] leading-none text-ink-muted">{text}</span>
    </div>
  );
}
