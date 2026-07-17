'use client';

/**
 * ClassroomHero — 课堂页首屏（零存量态）。
 *
 * Taste：直觉到不需要引导。
 * - 首屏用一句定位、一个主动作和一段可验证的课堂证据表达产品价值。
 * - 示例卡呈现“听见原话 → 有依据地解释”的核心时刻；主叙事下只露出材料与搜索两条次入口。
 * - 「电脑声音」必须第一眼可见，因为这是能力本身，不是帮助文档。
 */

import * as React from 'react';
import { ArrowRight, Headphones, Mic, Monitor, Play } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { COPY } from '@/lib/ui/copy';
import { cn } from '@/lib/utils';
import type { RecorderAudioSource } from '@/stores/capture-editor-store';
import { ClassroomLaunchpad } from './ClassroomLaunchpad';

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
  /** 把文件/网页/音视频放入学习上下文 */
  onAddMaterial?: () => void;
  /** 搜索已有课堂和资料 */
  onSearch?: () => void;
  /** 已有学习上下文时，在主叙事上方显示“接着上次学”。 */
  recoverySlot?: React.ReactNode;
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
    <div className="flex flex-col items-start">
      <p className="mb-2.5 text-[12px] font-medium text-ink-secondary">
        {COPY.recording.sourcePrompt}
      </p>
      <div className="inline-grid w-full grid-cols-1 gap-1 rounded-[14px] border border-divider bg-paper-warm/70 p-1 sm:w-auto sm:grid-cols-3">
        {options.map((option) => {
          const Icon = option.icon;
          const active = value === option.key;
          return (
            <button
              key={option.key}
              type="button"
              onClick={() => onChange(option.key)}
              className={cn(
                'inline-flex min-w-[112px] items-center justify-center gap-1.5 rounded-[10px] px-4 py-2.5 text-[13px] font-medium transition-all',
                active
                  ? 'bg-white text-pine shadow-[0_1px_2px_rgba(28,27,25,0.06)] ring-1 ring-pine/10'
                  : 'text-ink-secondary hover:bg-white/70 hover:text-ink',
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
        <p className="mt-2.5 text-[11px] leading-5 text-ink-muted">
          {COPY.recording.sourceSystemHint}
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
  onAddMaterial,
  onSearch,
  recoverySlot,
  className,
}: ClassroomHeroProps) {
  return (
    <div
      className={cn(
        'flex min-h-full flex-1 items-center justify-center px-6 py-12 lg:px-12 lg:py-16',
        className,
      )}
    >
      <div className="w-full max-w-[1120px]">
        {recoverySlot ? <div className="mb-7 max-w-[720px]">{recoverySlot}</div> : null}
        <div className="grid w-full items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(340px,430px)] lg:gap-16">
        <section className="min-w-0">
          <div className="mb-5 flex items-center gap-2 font-mono text-[10px] font-semibold tracking-[0.14em] text-pine">
            <span className="h-1.5 w-1.5 rounded-full bg-pine" aria-hidden />
            <span>{COPY.hero.eyebrow}</span>
          </div>

          <h1 className="max-w-[720px] text-[44px] font-semibold leading-[1.04] tracking-[-0.055em] text-ink sm:text-[58px] lg:text-[68px]">
            {COPY.hero.title}
          </h1>
          <p className="mt-6 max-w-[620px] text-[16px] leading-8 text-ink-secondary sm:text-[17px]">
            {COPY.hero.subtitle}
          </p>

          <div className="mt-9">
            {onChangeAudioSource ? (
              <AudioSourceRail value={audioSource} onChange={onChangeAudioSource} />
            ) : null}
          </div>

          <div className="mt-7 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={onStartRecording}
              className={cn(
                'inline-flex items-center gap-2 rounded-[12px] bg-pine px-6 py-3.5 text-[14px] font-medium text-white',
                'transition-all hover:-translate-y-px hover:bg-pine-deep active:translate-y-0',
              )}
            >
              <Mic size={15} strokeWidth={2} />
              <span>{COPY.cta.record}</span>
            </button>

            <button
              type="button"
              onClick={onTryDemo}
              className="group inline-flex items-center gap-2 text-[13px] font-medium text-ink-secondary transition-colors hover:text-ink"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full border border-divider bg-white transition-colors group-hover:border-ink-muted">
                <Play size={12} fill="currentColor" />
              </span>
              <span>{COPY.hero.sideHint}</span>
            </button>
          </div>

          <p className="mt-5 text-[11.5px] leading-5 text-ink-muted">
            {COPY.hero.evidencePromise}
          </p>

          {(onAddMaterial || onSearch) ? (
            <div className="mt-7 max-w-[620px]">
              <ClassroomLaunchpad
                onStartRecording={onStartRecording}
                onAddMaterial={onAddMaterial}
                onSearch={onSearch}
                showRecord={false}
                compact
              />
            </div>
          ) : null}
        </section>

        <aside className="relative mx-auto w-full max-w-[430px] lg:mx-0">
          <div
            aria-hidden
            className="absolute -inset-8 rounded-full bg-pine/[0.045] blur-2xl"
          />
          <button
            type="button"
            onClick={onTryDemo}
            className="group relative w-full overflow-hidden rounded-[24px] border border-divider bg-white p-5 text-left shadow-[0_18px_60px_rgba(28,27,25,0.075)] transition-all hover:-translate-y-0.5 hover:border-pine/25 hover:shadow-[0_22px_70px_rgba(28,27,25,0.10)] sm:p-6"
          >
            <div className="flex items-center justify-between gap-4">
              <span className="inline-flex items-center gap-2 text-[11px] font-medium text-pine">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-pine opacity-20" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-pine" />
                </span>
                {COPY.hero.proofStatus}
              </span>
              <span className="font-mono text-[10px] text-ink-muted">{COPY.hero.proofTime}</span>
            </div>

            <blockquote className="mt-6 text-[19px] font-medium leading-8 tracking-[-0.018em] text-ink">
              “{COPY.hero.proofQuote}”
            </blockquote>

            <div className="my-6 h-px bg-divider/80" />

            <div className="rounded-[16px] bg-paper-warm/80 p-4">
              <p className="font-mono text-[9px] font-semibold tracking-[0.12em] text-pine">
                {COPY.hero.proofLabel}
              </p>
              <p className="mt-2 text-[14px] leading-7 text-ink-secondary">
                {COPY.hero.proofAnswer}
              </p>
              <span className="mt-3 inline-flex rounded-md bg-white px-2 py-1 font-mono text-[10px] text-pine ring-1 ring-divider">
                [{COPY.hero.proofTime}]
              </span>
            </div>

            <div className="mt-5 flex items-center justify-between text-[12.5px] font-medium text-ink-secondary">
              <span>{COPY.hero.proofAction}</span>
              <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
            </div>
          </button>
        </aside>
        </div>
      </div>
    </div>
  );
}

export default ClassroomHero;
