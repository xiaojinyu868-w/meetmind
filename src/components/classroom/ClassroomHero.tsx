'use client';

/**
 * ClassroomHero — 课堂页首屏（零存量态）。
 *
 * Taste：直觉到不需要引导。
 * - 没有产品说明卡、没有步骤卡、没有同桌占位说明。
 * - 只保留一句话、一个主动作、一个可见的录音来源选择。
 * - 「电脑声音」必须第一眼可见，因为这是能力本身，不是帮助文档。
 */

import * as React from 'react';
import { Headphones, Mic, Monitor } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { COPY } from '@/lib/ui/copy';
import { cn } from '@/lib/utils';
import type { RecorderAudioSource } from '@/stores/capture-editor-store';

export interface ClassroomHeroProps {
  /** 点“想先看看”——由父组件调 loadDemoLesson + 跳转 */
  onTryDemo: () => void;
  /** 点“开始录课”——等同老版 onStart */
  onStartRecording: () => void;
  /** 兼容旧 props，Hero 不再渲染能力预览卡 */
  onCapabilityClick?: (appKey: string) => void;
  /** 当前录音来源；空课堂首屏也要暴露“电脑声音”能力 */
  audioSource?: RecorderAudioSource;
  /** 切换录音来源 */
  onChangeAudioSource?: (source: RecorderAudioSource) => void;
  className?: string;
}

function canCaptureSystemAudio(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof navigator === 'undefined') return false;
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
    return false;
  }

  const ua = navigator.userAgent || '';
  const isIOS =
    /iPhone|iPad|iPod/i.test(ua) ||
    (/Macintosh/i.test(ua) && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);

  return !isIOS && !isAndroid;
}

function AudioSourceRail({
  value,
  onChange,
}: {
  value: RecorderAudioSource;
  onChange: (source: RecorderAudioSource) => void;
}) {
  const [canSystem, setCanSystem] = React.useState(true);

  React.useEffect(() => {
    setCanSystem(canCaptureSystemAudio());
  }, []);

  React.useEffect(() => {
    if (!canSystem && value !== 'mic') onChange('mic');
  }, [canSystem, onChange, value]);

  const options: Array<{
    key: RecorderAudioSource;
    label: string;
    icon: LucideIcon;
  }> = canSystem
    ? [
        { key: 'mic', label: COPY.recording.sourceMic, icon: Mic },
        { key: 'system', label: COPY.recording.sourceSystem, icon: Monitor },
        { key: 'mixed', label: COPY.recording.sourceMixed, icon: Headphones },
      ]
    : [{ key: 'mic', label: COPY.recording.sourceMic, icon: Mic }];

  return (
    <div className="flex flex-col items-center">
      <div className="inline-grid grid-cols-1 overflow-hidden rounded-full border border-divider bg-white sm:grid-cols-3">
        {options.map((option) => {
          const Icon = option.icon;
          const active = value === option.key;
          return (
            <button
              key={option.key}
              type="button"
              onClick={() => onChange(option.key)}
              className={cn(
                'inline-flex min-w-[116px] items-center justify-center gap-1.5 px-4 py-2.5 text-[13px] transition-colors',
                active ? 'bg-ink text-white' : 'text-ink-secondary hover:bg-[#FAF7F2] hover:text-ink',
              )}
              aria-pressed={active}
            >
              <Icon size={14} strokeWidth={2} />
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>
      {canSystem && value !== 'mic' ? (
        <p className="mt-3 text-[11px] leading-5 text-ink-muted">
          开始后，在系统窗口勾选“分享音频”。
        </p>
      ) : null}
    </div>
  );
}

export function ClassroomHero({
  onTryDemo,
  onStartRecording,
  audioSource = 'mic',
  onChangeAudioSource,
  className,
}: ClassroomHeroProps) {
  return (
    <div
      className={cn(
        'flex min-h-full flex-1 items-center justify-center px-6 pb-20 pt-16 text-center lg:px-10',
        className,
      )}
    >
      <div className="flex w-full max-w-[920px] flex-col items-center">
        <h2 className="text-[46px] font-semibold leading-[1.02] tracking-[-0.05em] text-ink sm:text-[64px] lg:text-[76px]">
          {COPY.identity.tagline}
        </h2>

        <div className="mt-10">
          {onChangeAudioSource ? (
            <AudioSourceRail value={audioSource} onChange={onChangeAudioSource} />
          ) : null}
        </div>

        <button
          type="button"
          onClick={onStartRecording}
          className={cn(
            'mt-8 inline-flex items-center gap-2 rounded-full bg-ink px-7 py-3.5 text-[15px] font-medium text-white',
            'transition-colors hover:bg-[#1a1a19] active:scale-[0.99]',
          )}
        >
          <Mic size={15} strokeWidth={2} />
          <span>{COPY.cta.record}</span>
        </button>

        <button
          type="button"
          onClick={onTryDemo}
          className="mt-5 text-[13px] text-ink-muted underline-offset-[6px] transition-colors hover:text-ink-secondary hover:underline"
        >
          {COPY.hero.sideHint}
        </button>
      </div>
    </div>
  );
}

export default ClassroomHero;
