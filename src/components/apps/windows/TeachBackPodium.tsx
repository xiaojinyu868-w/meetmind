'use client';

/**
 * TeachBackPodium — 「讲给同桌听」连续讲述版的讲台（2026-09-10）。
 *
 * 浮在像素教室底部的毛玻璃面板，是麦克风常开时"你这一侧"的全部画面：
 *   状态一行（在听 / 你在讲 + rec 点 / 等你说完 + 呼吸点 / ×× 在说） · 出声 / 只看文字
 *   → 波形（你在讲）或一个安静的呼吸指示（停顿等待）
 *   → 实时转写（上一段淡出一行 + 当前这段）
 *   → 回到目标 · 讲完了
 * 麦克风拿不到 / 断了 / 正在录课 / 转写连不上时，同一位置一行人话 + 重新上台，
 * 并露出打字兜底（回车算一段）。没有倒计时数字，没有"AI 正在思考"。
 * 用户面字符串全部走 APPS_COPY.teachBack。
 */

import { useState, type KeyboardEvent } from 'react';
import type { TeachBackJudgeId } from '@/lib/ai-native/types';
import { APPS_COPY } from '@/lib/ui/copy-apps';
import { WordToggle } from './InfographicPanels';
import type { PodiumStatus } from './use-teach-back-panel';
import type { StageMood, TurnPhase } from './teach-back-turn-machine';

const BAR_COUNT = 24;

interface TeachBackPodiumProps {
  status: PodiumStatus;
  phase: TurnPhase;
  mood: StageMood;
  levels: number[];
  liveText: string;
  lastCommitted: string;
  activeJudge: TeachBackJudgeId | null;
  voiceEnabled: boolean;
  onVoiceEnabledChange: (enabled: boolean) => void;
  onFinish: () => void;
  finishDisabled: boolean;
  onBack: () => void;
  onRestart: () => void;
  onSubmitTyped: (text: string) => void;
}

function Waveform({ levels }: { levels: number[] }) {
  const padded = [...Array<number>(Math.max(0, BAR_COUNT - levels.length)).fill(0), ...levels.slice(-BAR_COUNT)];
  return (
    <div className="flex h-9 items-center justify-center gap-[3px]" aria-hidden>
      {padded.map((level, index) => (
        <span
          key={index}
          className="w-[3px] rounded-full bg-pine transition-[height,opacity] duration-100 ease-out motion-reduce:transition-none"
          style={{ height: `${Math.max(3, Math.round(level * 34))}px`, opacity: 0.35 + level * 0.65 }}
        />
      ))}
    </div>
  );
}

/** 停顿等待：一个安静的呼吸点，不是倒计时 */
function Breath() {
  return (
    <div className="flex h-9 items-center justify-center" aria-hidden>
      <span className="tbp-breath block h-2.5 w-2.5 rounded-full bg-pine/70" />
    </div>
  );
}

function statusLine(status: PodiumStatus): string | null {
  const copy = APPS_COPY.teachBack;
  switch (status) {
    case 'connecting':
      return copy.micConnecting;
    case 'mic-denied':
      return copy.micDenied;
    case 'mic-lost':
      return copy.micLost;
    case 'mic-busy':
      return copy.micBusy;
    case 'asr-down':
      return copy.asrDown;
    default:
      return null;
  }
}

export function TeachBackPodium({
  status,
  phase,
  mood,
  levels,
  liveText,
  lastCommitted,
  activeJudge,
  voiceEnabled,
  onVoiceEnabledChange,
  onFinish,
  finishDisabled,
  onBack,
  onRestart,
  onSubmitTyped,
}: TeachBackPodiumProps) {
  const copy = APPS_COPY.teachBack;
  const [typed, setTyped] = useState('');
  const live = status === 'live';
  const trouble = status === 'mic-denied' || status === 'mic-lost' || status === 'mic-busy' || status === 'asr-down';
  const line = statusLine(status);

  const stageWord = !live
    ? null
    : phase === 'calibrating'
      ? copy.stageCalibrating
      : mood === 'speaking'
        ? copy.stageSpeaking
        : mood === 'pausing'
          ? copy.stagePausing
          : mood === 'judge' && activeJudge
            ? copy.stageJudge(copy.judges[activeJudge].name)
            : copy.stageListening;

  const submitTyped = () => {
    const text = typed.trim();
    if (!text) return;
    onSubmitTyped(text);
    setTyped('');
  };
  const onTypedKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submitTyped();
    }
  };

  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col items-center px-4 pb-4 pt-12 sm:px-5 sm:pb-5"
      style={{ background: 'linear-gradient(180deg, transparent, rgba(242,240,233,0.94) 30%)' }}
      data-testid="teach-back-podium"
      data-phase={phase}
      data-status={status}
    >
      <div className="mm-app-enter pointer-events-auto flex w-full max-w-[560px] flex-col gap-2.5 rounded-2xl border border-divider/80 bg-card/92 px-4 py-3.5 shadow-card backdrop-blur-md sm:px-5">
        {/* 状态一行 + 出声开关 */}
        <div className="flex items-center justify-between gap-3">
          <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-ink-secondary" aria-live="polite" data-testid="teach-back-stage-word">
            {live && mood === 'speaking' ? <span className="rec-dot" aria-hidden /> : null}
            {live && mood === 'judge' ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-pine" aria-hidden /> : null}
            {status === 'connecting' ? <span className="thinking-strip h-1 w-10 rounded-full" aria-hidden /> : null}
            <span className={`truncate ${live && mood === 'speaking' ? 'text-ink' : ''}`}>{stageWord ?? line ?? ''}</span>
          </span>
          <WordToggle
            value={voiceEnabled ? 'on' : 'off'}
            options={[{ value: 'on', label: copy.voiceOn }, { value: 'off', label: copy.voiceOff }]}
            onChange={(next) => onVoiceEnabledChange(next === 'on')}
          />
        </div>

        {/* 波形 / 呼吸点 */}
        {live ? (
          mood === 'speaking' || mood === 'listening' ? <Waveform levels={mood === 'speaking' ? levels : []} /> : <Breath />
        ) : null}

        {/* 实时转写：上一段淡一行，当前这段是主角 */}
        {live || liveText ? (
          <div className="min-h-[44px] rounded-[12px] bg-paper px-3.5 py-2.5" data-testid="teach-back-live-transcript">
            {lastCommitted && !liveText ? (
              <p className="truncate text-[12px] leading-5 text-ink-muted">{lastCommitted}</p>
            ) : null}
            {liveText ? (
              <p className="max-h-[72px] overflow-hidden text-[13.5px] leading-6 text-ink [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:3]">
                {liveText}
              </p>
            ) : !lastCommitted ? (
              <p className="text-[12px] leading-5 text-ink-muted">{copy.liveTranscriptEmpty}</p>
            ) : null}
          </div>
        ) : null}

        {/* 麦克风出问题：一行人话 + 重新上台 + 打字兜底 */}
        {trouble ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[12px] leading-5 text-ink-secondary">{line}</p>
              {status !== 'mic-busy' ? (
                <button type="button" onClick={onRestart} className="mm-focus shrink-0 rounded text-[12px] font-medium text-pine underline decoration-pine/30 underline-offset-[3px] hover:decoration-pine">
                  {copy.reconnectMic}
                </button>
              ) : null}
            </div>
            <input
              type="text"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={onTypedKeyDown}
              placeholder={copy.typeFallbackPlaceholder}
              className="h-10 rounded-[12px] border border-divider bg-paper px-3 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-muted focus:border-pine/50"
              data-testid="teach-back-typed-input"
            />
          </div>
        ) : null}

        {/* 动作行 */}
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onBack}
            className="mm-focus min-h-[40px] rounded-md px-1 text-[12px] text-ink-muted transition-colors hover:text-ink"
          >
            {copy.backToTargets}
          </button>
          <button
            type="button"
            onClick={onFinish}
            disabled={finishDisabled}
            title={finishDisabled ? copy.finishDisabledHint : undefined}
            className="mm-press mm-focus min-h-[40px] shrink-0 whitespace-nowrap rounded-full bg-pine px-5 text-[13px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
            data-testid="teach-back-finish"
          >
            {copy.finishText}
          </button>
        </div>
      </div>

      <style jsx>{`
        .tbp-breath {
          animation: tbpBreath 1.8s ease-in-out infinite;
        }
        @keyframes tbpBreath {
          0%, 100% { transform: scale(1); opacity: 0.45; }
          50% { transform: scale(1.5); opacity: 0.95; }
        }
        @media (prefers-reduced-motion: reduce) {
          .tbp-breath { animation: none; opacity: 0.8; }
        }
      `}</style>
    </div>
  );
}

export default TeachBackPodium;
