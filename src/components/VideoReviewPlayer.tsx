'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ImportedVideoSource } from '@/types';

interface VideoReviewPlayerProps {
  source: ImportedVideoSource | null;
  className?: string;
  seekToMs?: number;
  seekNonce?: number;
  /** 播放进度回调（毫秒） */
  onTimeUpdate?: (currentTimeMs: number) => void;
  /** 视频总时长（毫秒），用于 iframe 进度条 */
  totalDurationMs?: number;
}

function isDirectVideo(source: ImportedVideoSource): boolean {
  return source.provider === 'direct-file' && !!source.playableUrl;
}

function isBilibili(source: ImportedVideoSource): boolean {
  return source.provider === 'bilibili';
}

function buildBilibiliEmbedUrl(source: ImportedVideoSource, seekToMs: number): string {
  const bvid = source.bvid || '';
  const base = bvid
    ? `https://player.bilibili.com/player.html?bvid=${encodeURIComponent(bvid)}&page=1&high_quality=1&danmaku=0&autoplay=0`
    : source.embedUrl || '';
  if (!base) return '';
  if (seekToMs <= 0) return base;
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}t=${Math.max(0, Math.floor(seekToMs / 1000))}`;
}

function withStartTime(url: string, seekToMs: number, seekNonce: number): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('t', String(Math.max(0, Math.floor(seekToMs / 1000))));
    parsed.searchParams.set('seek_nonce', String(seekNonce));
    return parsed.toString();
  } catch {
    return url;
  }
}

/** 格式化 ms → M:SS */
function fmtTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

// ─── iframe 字幕同步控制条 ───

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

interface IframeSyncBarProps {
  seekToMs: number;
  seekNonce: number;
  totalDurationMs: number;
  onTimeUpdate?: (ms: number) => void;
}

function IframeSyncBar({ seekToMs, seekNonce, totalDurationMs, onTimeUpdate }: IframeSyncBarProps) {
  const [playing, setPlaying] = useState(false);
  const [simTime, setSimTime] = useState(seekToMs);
  const [speed, setSpeed] = useState(1);
  const [dragging, setDragging] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const simTimeRef = useRef(simTime);
  const barRef = useRef<HTMLDivElement>(null);
  simTimeRef.current = simTime;

  const duration = totalDurationMs > 0 ? totalDurationMs : 1;
  const progress = Math.min(1, Math.max(0, simTime / duration));

  // 外部 seek 时同步
  useEffect(() => {
    setSimTime(seekToMs);
    onTimeUpdate?.(seekToMs);
  }, [seekToMs, seekNonce]);

  // 计时器
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (playing && !dragging) {
      const tickMs = 200;
      intervalRef.current = setInterval(() => {
        const next = Math.min(simTimeRef.current + tickMs * speed, duration);
        setSimTime(next);
        onTimeUpdate?.(next);
        if (next >= duration) {
          setPlaying(false);
        }
      }, tickMs);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [playing, speed, dragging, duration, onTimeUpdate]);

  const togglePlay = useCallback(() => {
    setPlaying(p => {
      if (!p && simTimeRef.current >= duration) {
        setSimTime(0);
        onTimeUpdate?.(0);
      }
      return !p;
    });
  }, [duration, onTimeUpdate]);

  const cycleSpeed = useCallback(() => {
    setSpeed(prev => {
      const idx = SPEED_OPTIONS.indexOf(prev as (typeof SPEED_OPTIONS)[number]);
      return SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length];
    });
  }, []);

  // 进度条拖拽
  const handleBarInteraction = useCallback((clientX: number) => {
    if (!barRef.current) return;
    const rect = barRef.current.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const newTime = ratio * duration;
    setSimTime(newTime);
    onTimeUpdate?.(newTime);
  }, [duration, onTimeUpdate]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    handleBarInteraction(e.clientX);

    const onMove = (ev: MouseEvent) => handleBarInteraction(ev.clientX);
    const onUp = () => {
      setDragging(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [handleBarInteraction]);

  return (
    <div className="bg-gray-900/90 backdrop-blur-sm px-3 py-2 select-none">
      {/* 进度条 */}
      <div
        ref={barRef}
        className="relative h-1.5 bg-white/10 rounded-full cursor-pointer group mb-2"
        onMouseDown={handleMouseDown}
      >
        {/* 已播放部分 */}
        <div
          className="absolute left-0 top-0 h-full bg-yellow-400 rounded-full transition-[width] duration-100"
          style={{ width: `${progress * 100}%` }}
        />
        {/* 拖拽手柄 */}
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 bg-yellow-400 rounded-full shadow-md opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ left: `${progress * 100}%` }}
        />
      </div>

      {/* 控制按钮行 */}
      <div className="flex items-center gap-2">
        {/* 播放/暂停 */}
        <button
          onClick={togglePlay}
          className="flex items-center justify-center w-7 h-7 rounded-full bg-yellow-400/20 hover:bg-yellow-400/30 transition-colors"
          title={playing ? '暂停字幕同步' : '开始字幕同步'}
        >
          {playing ? (
            <svg className="w-3.5 h-3.5 text-yellow-300" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5 text-yellow-300 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        {/* 时间 */}
        <span className="text-xs font-mono text-white/80 tabular-nums min-w-[6rem]">
          {fmtTime(simTime)} / {fmtTime(duration)}
        </span>

        {/* 倍速 */}
        <button
          onClick={cycleSpeed}
          className="px-1.5 py-0.5 text-[11px] font-mono rounded bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors tabular-nums"
          title="切换倍速"
        >
          {speed}x
        </button>

        {/* 状态提示 */}
        <div className="flex-1" />
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
          playing
            ? 'bg-yellow-400/20 text-yellow-300 animate-pulse'
            : 'bg-white/5 text-white/30'
        }`}>
          {playing ? '字幕同步中' : '在B站播放视频后，点 ▶ 同步字幕高亮'}
        </span>
      </div>
    </div>
  );
}

// ─── 主组件 ───

function VideoReviewPlayerComponent({
  source,
  className,
  seekToMs = 0,
  seekNonce = 0,
  onTimeUpdate,
  totalDurationMs = 0,
}: VideoReviewPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [iframeError, setIframeError] = useState(false);

  const embedSrc = useMemo(() => {
    if (!source) return '';
    if (isBilibili(source)) return buildBilibiliEmbedUrl(source, seekToMs);
    if (source.embedUrl) return withStartTime(source.embedUrl, seekToMs, seekNonce);
    return '';
  }, [source, seekToMs, seekNonce]);

  useEffect(() => {
    if (source && isDirectVideo(source) && videoRef.current && seekToMs >= 0) {
      videoRef.current.currentTime = seekToMs / 1000;
    }
  }, [source, seekToMs, seekNonce]);

  const isEmbed = !!source && !isDirectVideo(source) && !!embedSrc && !iframeError;

  // 从 source.durationSec 或 prop 获取总时长
  const effectiveDuration = totalDurationMs > 0
    ? totalDurationMs
    : (source?.durationSec ? source.durationSec * 1000 : 0);

  if (!source) return null;

  const originalUrl = source.resolvedUrl || source.originalUrl;

  // 直链视频 - 原生 video 标签（timeupdate 天然支持）
  if (isDirectVideo(source)) {
    return (
      <div className={className}>
        <video
          ref={videoRef}
          src={source.playableUrl}
          controls
          preload="metadata"
          className="aspect-video w-full bg-black"
          onTimeUpdate={onTimeUpdate ? (e) => onTimeUpdate((e.target as HTMLVideoElement).currentTime * 1000) : undefined}
        />
      </div>
    );
  }

  // iframe 嵌入（B站/YouTube 等）+ 字幕同步控制条
  if (isEmbed) {
    return (
      <div className={className}>
        <div className="relative aspect-video w-full overflow-hidden bg-black">
          <iframe
            src={embedSrc}
            title={source.title || 'video'}
            className="absolute inset-0 h-full w-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-top-navigation"
            onError={() => setIframeError(true)}
          />
        </div>
        {/* 字幕同步控制条 — B站/YouTube iframe 跨域无法直接获取播放进度 */}
        {onTimeUpdate && effectiveDuration > 0 && (
          <IframeSyncBar
            seekToMs={seekToMs}
            seekNonce={seekNonce}
            totalDurationMs={effectiveDuration}
            onTimeUpdate={onTimeUpdate}
          />
        )}
      </div>
    );
  }

  // fallback: 无法嵌入，显示跳转按钮
  return (
    <div className={className}>
      <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 bg-gray-900">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10">
          <svg className="h-7 w-7 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        </div>
        <p className="text-sm text-white/50">无法嵌入播放</p>
        <a
          href={originalUrl}
          target="_blank"
          rel="noreferrer"
          className="rounded-lg bg-white/10 px-4 py-1.5 text-sm text-white transition hover:bg-white/20"
        >
          在新窗口打开
        </a>
      </div>
    </div>
  );
}

export const VideoReviewPlayer = memo(VideoReviewPlayerComponent);
