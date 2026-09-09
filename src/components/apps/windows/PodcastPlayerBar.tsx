'use client';

/**
 * PodcastPlayerBar — 课堂播客的播放条（v7 皮肤）。
 *
 * 此前播客窗口和"做好即弹"的预览卡里都是浏览器原生 <audio controls>：灰色系统控件浮在米白纸面上，
 * 是整套应用里唯一一块不属于产品的皮肤。这里用同一套语言重画：墨色圆形播放键（与测验 / 闪卡的主按钮同色）、
 * 松石绿进度、等宽时间、倍速小胶囊。<audio> 仍在（隐藏），外面拿 audioRef 做章节跳转与逐行高亮，接口不变。
 */

import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ChangeEvent } from 'react';
import { Pause, Play } from 'lucide-react';
import { APPS_COPY } from '@/lib/ui/copy-apps';
import { cn } from '@/lib/utils';

const RATES = [1, 1.25, 1.5] as const;

export interface PodcastPlayerBarProps {
  src: string;
  title?: string;
  autoPlay?: boolean;
  className?: string;
}

function fmt(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const PodcastPlayerBar = forwardRef<HTMLAudioElement, PodcastPlayerBarProps>(function PodcastPlayerBar(
  { src, title, autoPlay = false, className },
  ref,
) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  useImperativeHandle(ref, () => audioRef.current as HTMLAudioElement, []);

  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState<(typeof RATES)[number]>(1);

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

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => undefined);
    else audio.pause();
  };

  const seek = (event: ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    audio.currentTime = (Number(event.target.value) / 1000) * duration;
    setTime(audio.currentTime);
  };

  const cycleRate = () => {
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    setRate(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  };

  const progress = duration > 0 ? Math.min(1000, Math.round((time / duration) * 1000)) : 0;
  const copy = APPS_COPY.podcast;

  return (
    <div className={cn('flex items-center gap-3.5 rounded-[18px] border border-divider bg-paper-warm px-3.5 py-3', className)} data-testid="podcast-player-bar">
      <audio ref={audioRef} src={src} autoPlay={autoPlay} preload="auto" className="hidden" />
      <button
        type="button"
        onClick={toggle}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-ink text-white shadow-soft transition hover:opacity-90 active:scale-95"
        aria-label={playing ? copy.pause : copy.play}
        title={playing ? copy.pause : copy.play}
      >
        {playing ? <Pause size={16} strokeWidth={2.2} /> : <Play size={16} strokeWidth={2.2} fill="currentColor" className="ml-0.5" />}
      </button>
      <div className="min-w-0 flex-1">
        {title ? <p className="truncate text-[13px] font-semibold text-ink">{title}</p> : null}
        <div className={cn('flex items-center gap-2.5', title && 'mt-1.5')}>
          <input
            type="range"
            min={0}
            max={1000}
            value={progress}
            onChange={seek}
            aria-label={copy.seek}
            className="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-divider accent-pine [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-pine"
            style={{ background: `linear-gradient(to right, var(--mm-pine) ${progress / 10}%, var(--mm-divider) ${progress / 10}%)` }}
          />
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-muted">
            {fmt(time)} / {fmt(duration)}
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={cycleRate}
        className="shrink-0 rounded-full border border-divider bg-white px-2 py-1 font-mono text-[11px] font-medium text-ink-secondary transition hover:border-pine/40 hover:text-ink"
        aria-label={copy.rate(rate)}
        title={copy.rate(rate)}
      >
        {rate}x
      </button>
    </div>
  );
});
