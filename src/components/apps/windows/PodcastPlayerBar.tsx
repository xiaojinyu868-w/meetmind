'use client';

/**
 * PodcastPlayerBar — 课堂播客的播放条（v7 皮肤）。
 *
 * 此前播客窗口和"做好即弹"的预览卡里都是浏览器原生 <audio controls>：灰色系统控件浮在米白纸面上，
 * 是整套应用里唯一一块不属于产品的皮肤。这里用同一套语言重画：墨色圆形播放键（与测验 / 闪卡的主按钮同色）、
 * 松石绿进度、等宽时间、倍速小胶囊。<audio> 仍在（隐藏），外面拿 audioRef 做章节跳转与逐行高亮，接口不变。
 *
 * 2026-09-10：进度条从原生 range 换成自绘 scrub——拖动跟手、拖时头顶一枚时间气泡、悬停也显示落点时间；
 * 键盘：条上 ←→ 5 秒、Home / End；hotkeys 开着时窗口级 空格 / K 播放暂停、←→ / J L 5 秒（app-keys）；
 * 倍速 1 → 1.25 → 1.5 → 2；时间用 podcast-player-model 的纯函数。
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Pause, Play } from 'lucide-react';
import { APPS_COPY } from '@/lib/ui/copy-apps';
import { cn } from '@/lib/utils';
import { isTypingTarget, resolvePlayerKey } from './app-keys';
import { formatClock, nextRate, SEEK_STEP_SEC, stepTime, timeAtPointer, type PlaybackRate } from './podcast-player-model';

export interface PodcastPlayerBarProps {
  src: string;
  title?: string;
  autoPlay?: boolean;
  className?: string;
  /** 窗口级快捷键（空格 / ←→）；试听卡等场合也可以开 */
  hotkeys?: boolean;
}

export const PodcastPlayerBar = forwardRef<HTMLAudioElement, PodcastPlayerBarProps>(function PodcastPlayerBar(
  { src, title, autoPlay = false, className, hotkeys = true },
  ref,
) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  useImperativeHandle(ref, () => audioRef.current as HTMLAudioElement, []);

  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState<PlaybackRate>(1);
  /** 拖动中的预览时间（松手才真正 seek） */
  const [scrubTime, setScrubTime] = useState<number | null>(null);
  /** 悬停落点（只显示，不改进度） */
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setTime(audio.currentTime);
    const onMeta = () => setDuration(audio.duration || 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('durationchange', onMeta);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onPause);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('durationchange', onMeta);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onPause);
    };
  }, [src]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => undefined);
    else audio.pause();
  }, []);

  const seekTo = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = seconds;
    setTime(seconds);
  }, []);

  const seekBy = useCallback((delta: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    seekTo(stepTime(audio.currentTime, delta, audio.duration));
  }, [seekTo]);

  // 窗口级快捷键：空格 / K 播放暂停，←→（J / L）5 秒；正在输入时不抢
  useEffect(() => {
    if (!hotkeys) return undefined;
    const onKey = (event: KeyboardEvent) => {
      const action = resolvePlayerKey(event.key, isTypingTarget(event.target as HTMLElement | null));
      if (!action) return;
      // 播放器的空格永远是播放 / 暂停（焦点停在倍速上时也不让它被空格再点一次）
      event.preventDefault();
      if (action === 'toggle') toggle();
      else seekBy(action === 'back' ? -SEEK_STEP_SEC : SEEK_STEP_SEC);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hotkeys, seekBy, toggle]);

  const cycleRate = () => {
    const next = nextRate(rate);
    setRate(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  };

  // 自绘 scrub：按下即预览、拖动跟手、松手 seek
  const pointerTime = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return timeAtPointer(event.clientX, rect, duration);
  };
  const onTrackPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!duration) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setScrubTime(pointerTime(event));
  };
  const onTrackPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!duration) return;
    const t = pointerTime(event);
    if (scrubTime !== null) setScrubTime(t);
    else if (event.pointerType === 'mouse') setHoverTime(t);
  };
  const onTrackPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (scrubTime === null) return;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* 无捕获 */ }
    seekTo(pointerTime(event));
    setScrubTime(null);
  };
  const onTrackKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); seekBy(event.key === 'ArrowLeft' ? -SEEK_STEP_SEC : SEEK_STEP_SEC); }
    if (event.key === 'Home') { event.preventDefault(); seekTo(0); }
    if (event.key === 'End' && duration) { event.preventDefault(); seekTo(duration); }
  };

  const shownTime = scrubTime ?? time;
  const ratio = duration > 0 ? Math.min(1, Math.max(0, shownTime / duration)) : 0;
  const bubbleTime = scrubTime ?? hoverTime;
  const bubbleRatio = bubbleTime !== null && duration > 0 ? Math.min(1, Math.max(0, bubbleTime / duration)) : null;
  const copy = APPS_COPY.podcast;

  return (
    <div className={cn('flex items-center gap-3.5 rounded-[18px] border border-divider bg-paper-warm px-3.5 py-3', className)} data-testid="podcast-player-bar">
      <audio ref={audioRef} src={src} autoPlay={autoPlay} preload="auto" className="hidden" />
      <button
        type="button"
        onClick={toggle}
        className="mm-press mm-focus flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-ink text-white shadow-soft hover:opacity-90"
        aria-label={playing ? copy.pause : copy.play}
        title={playing ? copy.pause : copy.play}
      >
        {playing ? <Pause size={16} strokeWidth={2.2} /> : <Play size={16} strokeWidth={2.2} fill="currentColor" className="ml-0.5" />}
      </button>
      <div className="min-w-0 flex-1">
        {title ? <p className="truncate text-[13px] font-semibold text-ink">{title}</p> : null}
        <div className={cn('flex items-center gap-2.5', title && 'mt-1')}>
          {/* 进度：24px 高的命中区里一根 4px 的轨，拖动时把手变大、头顶一枚时间气泡 */}
          <div
            ref={trackRef}
            role="slider"
            tabIndex={0}
            aria-label={copy.seek}
            aria-valuemin={0}
            aria-valuemax={Math.round(duration) || 0}
            aria-valuenow={Math.round(shownTime)}
            aria-valuetext={`${formatClock(shownTime)} / ${formatClock(duration)}`}
            className="mm-focus group relative h-6 min-w-0 flex-1 cursor-pointer touch-none rounded-full outline-none"
            onPointerDown={onTrackPointerDown}
            onPointerMove={onTrackPointerMove}
            onPointerUp={onTrackPointerUp}
            onPointerCancel={() => setScrubTime(null)}
            onPointerLeave={() => setHoverTime(null)}
            onKeyDown={onTrackKeyDown}
          >
            <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-divider" />
            <div className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-pine" style={{ width: `${ratio * 100}%`, transition: scrubTime !== null ? 'none' : 'width 120ms linear' }} />
            <div
              className={cn('absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-pine shadow-soft transition-[width,height] duration-150 motion-reduce:transition-none', scrubTime !== null ? 'h-4 w-4' : 'h-3 w-3 group-hover:h-3.5 group-hover:w-3.5')}
              style={{ left: `${ratio * 100}%` }}
            />
            {bubbleRatio !== null ? (
              <div
                className="mm-pop-in pointer-events-none absolute -top-7 -translate-x-1/2 rounded-md bg-ink px-1.5 py-0.5 font-mono text-[10.5px] tabular-nums text-white"
                style={{ left: `${bubbleRatio * 100}%` }}
                aria-hidden
              >
                {formatClock(bubbleTime ?? 0)}
              </div>
            ) : null}
          </div>
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-muted">
            {formatClock(shownTime)} / {formatClock(duration)}
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={cycleRate}
        className="mm-press mm-focus flex h-8 min-w-[44px] shrink-0 items-center justify-center rounded-full border border-divider bg-white px-2 font-mono text-[11px] font-medium text-ink-secondary hover:border-pine/40 hover:text-ink"
        aria-label={copy.rate(rate)}
        title={copy.rate(rate)}
      >
        {rate}x
      </button>
    </div>
  );
});
