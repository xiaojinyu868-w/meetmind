'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ImportedVideoSource } from '@/types';
import { resolveBilibiliVideoIdentifiers } from '@/lib/utils/video-source';
import { resolveVideoThumbnailUrl } from '@/lib/utils/video-thumbnail-url';

interface VideoReviewPlayerProps {
  source: ImportedVideoSource | null;
  className?: string;
  seekToMs?: number;
  seekNonce?: number;
  playNonce?: number;
  /** 递增此值命令播放器暂停（与 playNonce 对称） */
  pauseNonce?: number;
  onTimeUpdate?: (currentTimeMs: number) => void;
  /** 播放/暂停状态变化回调 — 同步给父组件以驱动 classCheck 等依赖 isPlaying 的逻辑 */
  onPlayingChange?: (isPlaying: boolean) => void;
  totalDurationMs?: number;
}

function isDirectVideo(source: ImportedVideoSource): boolean {
  return source.provider === 'direct-file' && !!source.playableUrl;
}

function isBilibili(source: ImportedVideoSource): boolean {
  return source.provider === 'bilibili';
}

/**
 * 构建 B站音频代理 URL（通过我们自己的 /api/video/proxy 代理）
 */
function buildBiliProxyAudioUrl(source: ImportedVideoSource): string | null {
  const { bvid, cid } = resolveBilibiliVideoIdentifiers(source);
  if (!bvid) return null;
  const params = new URLSearchParams({ bvid, type: 'audio' });
  if (cid) params.set('cid', String(cid));
  return `/api/video/proxy?${params.toString()}`;
}

/**
 * 构建 B站视频代理 URL（Dash 视频流，720p）
 */
function buildBiliProxyVideoUrl(source: ImportedVideoSource): string | null {
  const { bvid, cid } = resolveBilibiliVideoIdentifiers(source);
  if (!bvid) return null;
  const params = new URLSearchParams({ bvid, type: 'video' });
  if (cid) params.set('cid', String(cid));
  return `/api/video/proxy?${params.toString()}`;
}

function fmtTime(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function fmtSpeed(speed: number): string {
  return Number.isInteger(speed) ? `${speed}.0x` : `${speed}x`;
}

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

// ─── 原生播放器控制栏 ─────────────────────────────────────────

interface NativePlayerBarProps {
  playing: boolean;
  currentTimeMs: number;
  totalDurationMs: number;
  speed: number;
  buffered: number; // 0-1
  onTogglePlay: () => void;
  onSeek: (timeMs: number) => void;
  onSpeedChange: () => void;
  onToggleFullscreen?: () => void;
  hasVideo?: boolean;
  title?: string;
}

function NativePlayerBar({
  playing,
  currentTimeMs,
  totalDurationMs,
  speed,
  buffered,
  onTogglePlay,
  onSeek,
  onSpeedChange,
  onToggleFullscreen,
  hasVideo,
  title,
}: NativePlayerBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const dragTimeRef = useRef(currentTimeMs);

  const duration = totalDurationMs > 0 ? totalDurationMs : 1;
  const displayTime = dragging ? dragTimeRef.current : currentTimeMs;
  const progress = Math.min(1, Math.max(0, displayTime / duration));

  const seekFromClientX = useCallback((clientX: number) => {
    if (!barRef.current) return;
    const rect = barRef.current.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const timeMs = ratio * duration;
    dragTimeRef.current = timeMs;
    onSeek(timeMs);
  }, [duration, onSeek]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    seekFromClientX(e.clientX);

    const onMove = (ev: MouseEvent) => seekFromClientX(ev.clientX);
    const onUp = () => {
      setDragging(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [seekFromClientX]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    setDragging(true);
    seekFromClientX(e.touches[0].clientX);
  }, [seekFromClientX]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (dragging) {
      seekFromClientX(e.touches[0].clientX);
    }
  }, [dragging, seekFromClientX]);

  const handleTouchEnd = useCallback(() => {
    setDragging(false);
  }, []);

  return (
    <div className="select-none bg-black/95">
      {/* 进度条区域 — 整个宽度可点击/拖动 */}
      <div
        ref={barRef}
        className="relative h-9 cursor-pointer group flex items-center px-3"
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* 轨道容器 — 与 px-3 对齐 */}
        <div className="relative w-full h-1 bg-white/15 group-hover:h-1.5 transition-all rounded-full">
          {/* 缓冲进度 */}
          <div
            className="absolute left-0 top-0 h-full bg-white/20 rounded-full"
            style={{ width: `${buffered * 100}%` }}
          />
          {/* 已播放进度 */}
          <div
            className="absolute left-0 top-0 h-full bg-white rounded-full transition-[width] duration-75"
            style={{ width: `${progress * 100}%` }}
          />
          {/* 拖动头 — 始终可见（移动端没有 hover） */}
          <div
            className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full bg-white transition-all ${
              dragging ? 'w-4 h-4' : 'w-3 h-3'
            }`}
            style={{ left: `${progress * 100}%` }}
          />
        </div>
      </div>

      {/* 控制按钮行 */}
      <div className="flex items-center gap-2.5 px-3 pb-2.5 pt-0">
        {/* 播放/暂停 */}
        <button
          type="button"
          onClick={onTogglePlay}
          className="flex items-center justify-center w-8 h-8 rounded-full hover:bg-white/10 active:bg-white/15 transition-colors"
          title={playing ? '暂停' : '播放'}
          aria-label={playing ? '暂停' : '播放'}
        >
          {playing ? (
            <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          ) : (
            <svg className="w-4 h-4 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        {/* 时间 */}
        <span className="text-[12px] font-mono text-white/80 tabular-nums whitespace-nowrap">
          {fmtTime(displayTime)} / {fmtTime(duration)}
        </span>

        {/* 标题（中间填充，仅桌面端） */}
        {title && (
          <span className="flex-1 min-w-0 text-[12px] text-white/50 truncate hidden sm:block">
            {title}
          </span>
        )}

        <div className="flex-1 sm:hidden" />

        {/* 倍速 */}
        <button
          type="button"
          onClick={onSpeedChange}
          className="px-2 py-1 text-[12px] font-mono rounded bg-white/10 hover:bg-white/20 active:bg-white/25 text-white/70 hover:text-white transition-colors tabular-nums"
          title="切换播放倍速"
        >
          {fmtSpeed(speed)}
        </button>

        {/* 全屏 */}
        {hasVideo && onToggleFullscreen && (
          <button
            type="button"
            onClick={onToggleFullscreen}
            className="flex items-center justify-center w-8 h-8 rounded hover:bg-white/10 active:bg-white/15 transition-colors"
            title="全屏"
            aria-label="全屏"
          >
            <svg className="w-4 h-4 text-white/70" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

// ─── 点击画面时的播放/暂停动画指示器（像 YouTube/B站） ────────

function PlayPauseIndicator({ action }: { action: 'play' | 'pause' | null }) {
  if (!action) return null;
  return (
    <div
      key={action + Date.now()}
      className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none"
      style={{ animation: 'vp-indicator 0.45s ease-out forwards' }}
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-black/50">
        {action === 'pause' ? (
          <svg className="h-8 w-8 text-white" fill="currentColor" viewBox="0 0 24 24">
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
        ) : (
          <svg className="h-8 w-8 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </div>
    </div>
  );
}

const INDICATOR_CSS = `@keyframes vp-indicator { 0% { opacity:0.9; transform:scale(0.85); } 100% { opacity:0; transform:scale(1.15); } }`;

// ─── 主播放器组件 ─────────────────────────────────────────

function VideoReviewPlayerComponent({
  source,
  className,
  seekToMs = 0,
  seekNonce = 0,
  playNonce = 0,
  pauseNonce = 0,
  onTimeUpdate,
  onPlayingChange,
  totalDurationMs = 0,
}: VideoReviewPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const seekNonceRef = useRef(seekNonce);
  const playNonceRef = useRef(playNonce);
  const pauseNonceRef = useRef(pauseNonce);

  const [playing, setPlaying] = useState(false);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [buffered, setBuffered] = useState(0);
  const [proxyError, setProxyError] = useState(false);
  const [audioLoading, setAudioLoading] = useState(false);
  const [showOverlayControls, setShowOverlayControls] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const overlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 用于检测隐性卡顿（playing=true 但 currentTime 不动） */
  const stallCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastProgressTimeRef = useRef(0);

  // 点击画面时的瞬态指示器
  const [indicator, setIndicator] = useState<{ action: 'play' | 'pause'; key: number } | null>(null);
  const indicatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 倍速 ref（用于 visibilitychange 恢复）
  const speedRef = useRef(speed);
  speedRef.current = speed;

  // playing ref（用于 keyboard handler 等闭包场景）
  const playingRef = useRef(playing);
  playingRef.current = playing;

  // 解析出播放源 URL
  const { audioSrc, videoSrc, thumbnailUrl } = useMemo(() => {
    if (!source) return { audioSrc: null, videoSrc: null, thumbnailUrl: null };

    if (isDirectVideo(source)) {
      return {
        audioSrc: null,
        videoSrc: source.playableUrl || null,
        thumbnailUrl: source.thumbnailUrl || null,
      };
    }

    if (isBilibili(source)) {
      const importedAudio = source.audioUrl || null;
      const proxyAudio = !importedAudio ? buildBiliProxyAudioUrl(source) : null;
      const proxyVideo = buildBiliProxyVideoUrl(source);

      return {
        audioSrc: importedAudio || proxyAudio,
        videoSrc: proxyVideo,
        thumbnailUrl: source.thumbnailUrl || null,
      };
    }

    // 通用 provider（youtube / douyin / generic 等）：
    // 尝试用 playableUrl 作为 video 源，audioUrl 作为 audio 源
    const genericVideo = source.playableUrl || null;
    const genericAudio = source.audioUrl || null;
    return {
      audioSrc: genericAudio,
      videoSrc: genericVideo,
      thumbnailUrl: source.thumbnailUrl || null,
    };
  }, [source]);

  const safeThumbnailUrl = useMemo(() => resolveVideoThumbnailUrl(thumbnailUrl), [thumbnailUrl]);

  const effectiveDuration = totalDurationMs > 0
    ? totalDurationMs
    : (source?.durationSec ? source.durationSec * 1000 : 0);

  // B 站 Dash 双轨模式：video（muted 画面）+ audio（声音/进度）同时存在
  const isDualTrack = isBilibili(source!) && !!videoSrc && !!audioSrc;

  // 主控制媒体：双轨模式下 audio 是进度主源；单轨模式下取 video 或 audio
  const getMedia = useCallback((): HTMLMediaElement | null => {
    if (isDualTrack) return audioRef.current;
    return videoRef.current || audioRef.current;
  }, [isDualTrack]);

  // 辅助：同时操作 video 和 audio（双轨同步）
  const forEachMedia = useCallback((fn: (media: HTMLMediaElement) => void) => {
    if (audioRef.current) fn(audioRef.current);
    if (isDualTrack && videoRef.current) fn(videoRef.current);
  }, [isDualTrack]);

  // ── Pause（外部命令式暂停，与 playNonce 对称） ──
  useEffect(() => {
    if (pauseNonceRef.current === pauseNonce) return;
    pauseNonceRef.current = pauseNonce;
    forEachMedia((m) => m.pause());
    setPlaying(false);
  }, [pauseNonce, forEachMedia]);

  // ── Seek ──
  useEffect(() => {
    if (seekNonceRef.current === seekNonce) return;
    seekNonceRef.current = seekNonce;
    const timeSec = Math.max(0, seekToMs) / 1000;
    forEachMedia((media) => {
      try { media.currentTime = timeSec; } catch { /* ignore */ }
    });
    setCurrentTimeMs(Math.max(0, seekToMs));
  }, [seekToMs, seekNonce, forEachMedia]);

  // ── Play ──
  useEffect(() => {
    if (playNonceRef.current === playNonce) return;
    playNonceRef.current = playNonce;
    const timeSec = seekToMs / 1000;
    const media = getMedia();
    if (media) {
      try {
        if (Math.abs(media.currentTime - timeSec) > 0.2) {
          forEachMedia((m) => { try { m.currentTime = timeSec; } catch { /* ignore */ } });
        }
      } catch { /* ignore */ }
      // 双轨模式：同时播放 video 和 audio
      if (isDualTrack && videoRef.current) {
        void videoRef.current.play().catch(() => { /* video 播放失败不影响功能 */ });
      }
      void media.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    }
  }, [playNonce, seekToMs, getMedia, forEachMedia, isDualTrack]);

  // ── Speed sync ──
  useEffect(() => {
    forEachMedia((media) => { media.playbackRate = speed; });
  }, [speed, forEachMedia]);

  // ── visibilitychange：页面回来后强制恢复播放状态 ──
  // 浏览器会在页面切到后台时节流/暂停媒体播放，回到前台时内部状态可能不一致
  // （paused=false 但实际已停滞、playbackRate 被重置、双轨脱节）。
  // 策略：回到前台时如果之前在播放，执行 pause→play 硬恢复循环。
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      const wasPlaying = playingRef.current;
      const targetSpeed = speedRef.current;

      // 延迟让浏览器完成页面恢复
      setTimeout(() => {
        if (!wasPlaying) {
          // 之前就是暂停的，只需恢复倍速
          forEachMedia((m) => {
            if (Math.abs(m.playbackRate - targetSpeed) > 0.01) {
              m.playbackRate = targetSpeed;
            }
          });
          return;
        }

        // 之前在播放 → 硬恢复：pause → 同步时间 → 恢复倍速 → play
        forEachMedia((m) => m.pause());

        setTimeout(() => {
          // 双轨模式：以 audio 为基准同步 video
          if (isDualTrack && videoRef.current && audioRef.current) {
            videoRef.current.currentTime = audioRef.current.currentTime;
          }

          // 恢复倍速
          forEachMedia((m) => {
            m.playbackRate = targetSpeed;
          });

          // 重新播放
          const media = isDualTrack ? audioRef.current : (videoRef.current || audioRef.current);
          if (!media) return;

          if (isDualTrack && videoRef.current) {
            void videoRef.current.play().catch(() => { /* ignore */ });
          }
          void media.play().then(() => {
            setPlaying(true);
          }).catch(() => {
            // 自动播放被拒绝（罕见，通常用户交互过就不会）
            setPlaying(false);
          });
        }, 50);
      }, 150);
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [forEachMedia, isDualTrack]);

  const togglePlay = useCallback(async () => {
    const media = getMedia();
    if (!media) return;
    if (media.paused) {
      // 双轨模式：同时播放视频画面
      if (isDualTrack && videoRef.current) {
        void videoRef.current.play().catch(() => { /* ignore */ });
      }
      try { await media.play(); setPlaying(true); } catch { setPlaying(false); }
    } else {
      forEachMedia((m) => m.pause());
      setPlaying(false);
    }
  }, [getMedia, isDualTrack, forEachMedia]);

  const handleSeek = useCallback((timeMs: number) => {
    const timeSec = Math.max(0, timeMs) / 1000;
    forEachMedia((media) => { media.currentTime = timeSec; });
    setCurrentTimeMs(timeMs);
    onTimeUpdate?.(timeMs);
  }, [forEachMedia, onTimeUpdate]);

  const cycleSpeed = useCallback(() => {
    setSpeed((prev) => {
      const idx = SPEED_OPTIONS.indexOf(prev as (typeof SPEED_OPTIONS)[number]);
      return SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length];
    });
  }, []);

  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      const video = videoRef.current;
      if (video) {
        const videoEl = video as HTMLVideoElement & { webkitEnterFullscreen?: () => void };
        if (videoEl.webkitEnterFullscreen) { videoEl.webkitEnterFullscreen(); return; }
      }
      void container.requestFullscreen?.();
    }
  }, []);

  // ── 点击视频画面：暂停/播放 + 瞬态指示器（像 YouTube/B站） ──
  const handleVideoAreaClick = useCallback(() => {
    const wasPaused = getMedia()?.paused ?? true;
    void togglePlay();
    // 显示瞬态播放/暂停指示器
    setIndicator({ action: wasPaused ? 'play' : 'pause', key: Date.now() });
    if (indicatorTimerRef.current) clearTimeout(indicatorTimerRef.current);
    indicatorTimerRef.current = setTimeout(() => setIndicator(null), 500);
  }, [getMedia, togglePlay]);

  // ── 封面区点击：播放/暂停 + 短暂显示控制 overlay ──
  const handleCoverClick = useCallback(() => {
    void togglePlay();
    setShowOverlayControls(true);
    if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current);
    overlayTimerRef.current = setTimeout(() => setShowOverlayControls(false), 1500);
  }, [togglePlay]);

  // ── 键盘快捷键 ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 仅在播放器容器内或 body focus 时响应，避免干扰输入框
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;

      switch (e.key) {
        case ' ':
        case 'k': // YouTube 风格
          e.preventDefault();
          void togglePlay();
          break;
        case 'ArrowLeft': {
          e.preventDefault();
          const media = getMedia();
          if (media) {
            const newTime = Math.max(0, (media.currentTime - 5)) * 1000;
            handleSeek(newTime);
          }
          break;
        }
        case 'ArrowRight': {
          e.preventDefault();
          const media = getMedia();
          if (media) {
            const dur = media.duration || Infinity;
            const newTime = Math.min(dur, media.currentTime + 5) * 1000;
            handleSeek(newTime);
          }
          break;
        }
        case 'f':
          e.preventDefault();
          toggleFullscreen();
          break;
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, getMedia, handleSeek, toggleFullscreen]);

  // ── Media 事件 ──
  const handleTimeUpdate = useCallback(() => {
    const media = getMedia();
    if (!media) return;
    const nowMs = media.currentTime * 1000;
    setCurrentTimeMs(nowMs);
    onTimeUpdate?.(nowMs);
    // 更新最后进度时间戳（用于隐性卡顿检测）
    lastProgressTimeRef.current = Date.now();
    // 双轨同步：以 audio 的时间为准，纠正 video 的漂移（>0.3s 时校准）
    if (isDualTrack && videoRef.current) {
      const drift = Math.abs(videoRef.current.currentTime - media.currentTime);
      if (drift > 0.3) {
        videoRef.current.currentTime = media.currentTime;
      }
    }
  }, [getMedia, onTimeUpdate, isDualTrack]);

  const handleProgress = useCallback(() => {
    const media = getMedia();
    if (!media || !media.buffered.length) return;
    const dur = media.duration || 1;
    setBuffered(media.buffered.end(media.buffered.length - 1) / dur);
  }, [getMedia]);

  const handleEnded = useCallback(() => {
    forEachMedia((m) => m.pause());
    setPlaying(false);
  }, [forEachMedia]);
  const handlePlay = useCallback(() => { setPlaying(true); onPlayingChange?.(true); }, [onPlayingChange]);
  const handlePause = useCallback(() => { setPlaying(false); onPlayingChange?.(false); }, [onPlayingChange]);

  // ── 缓冲/卡顿处理 ──────────────────────────────────────
  // 浏览器在缓冲不足时会触发 'waiting' 事件，缓冲恢复后触发 'playing'。
  // 双轨模式下 audio stall 时要协调暂停 video，恢复后同步重启。

  const handleWaiting = useCallback(() => {
    setIsBuffering(true);
    // 双轨模式：audio 卡住时暂停 video，避免画面和声音脱节
    if (isDualTrack && videoRef.current && !videoRef.current.paused) {
      videoRef.current.pause();
    }
  }, [isDualTrack]);

  const handlePlaying = useCallback(() => {
    setIsBuffering(false);
    // 缓冲恢复后确保倍速正确（某些浏览器 stall 后会重置 playbackRate）
    const targetSpeed = speedRef.current;
    forEachMedia((m) => {
      if (Math.abs(m.playbackRate - targetSpeed) > 0.01) {
        m.playbackRate = targetSpeed;
      }
    });
    // 双轨模式：audio 恢复后重启 video 并同步时间
    if (isDualTrack && videoRef.current && audioRef.current) {
      const drift = Math.abs(videoRef.current.currentTime - audioRef.current.currentTime);
      if (drift > 0.3) {
        videoRef.current.currentTime = audioRef.current.currentTime;
      }
      if (videoRef.current.paused) {
        void videoRef.current.play().catch(() => { /* ignore */ });
      }
    }
  }, [isDualTrack, forEachMedia]);

  // ── 隐性卡顿检测 ──────────────────────────────────────
  // 有时浏览器不触发 'waiting' 但播放实际停滞（currentTime 不前进）。
  // 每 2 秒检查一次，如果 playing=true 但时间停了 >3 秒，尝试恢复。
  useEffect(() => {
    if (stallCheckRef.current) {
      clearInterval(stallCheckRef.current);
      stallCheckRef.current = null;
    }
    if (!playing) return;

    lastProgressTimeRef.current = Date.now();

    stallCheckRef.current = setInterval(() => {
      const media = getMedia();
      if (!media || media.paused) return;

      // 检查 currentTime 是否在前进
      const now = media.currentTime;
      const lastKnown = lastProgressTimeRef.current;
      // 如果 timeupdate 事件正常触发，lastProgressTimeRef 会被更新
      // 这里检查的是"距离上次 timeupdate 过了多久"
      const elapsed = Date.now() - lastKnown;
      if (elapsed > 3000) {
        // 可能是隐性卡顿 — 尝试恢复
        // 策略：暂停再播放，强制浏览器重新评估缓冲状态
        media.pause();
        const targetSpeed = speedRef.current;
        setTimeout(() => {
          if (media.readyState >= 3) { // HAVE_FUTURE_DATA
            media.playbackRate = targetSpeed;
            void media.play().catch(() => { /* ignore */ });
            // 双轨模式：同步恢复 video
            if (isDualTrack && videoRef.current) {
              videoRef.current.currentTime = media.currentTime;
              videoRef.current.playbackRate = targetSpeed;
              void videoRef.current.play().catch(() => { /* ignore */ });
            }
          } else {
            // 还没缓冲好，等 canplay 事件再恢复
            const onCanPlay = () => {
              media.removeEventListener('canplay', onCanPlay);
              media.playbackRate = targetSpeed;
              void media.play().catch(() => { /* ignore */ });
              if (isDualTrack && videoRef.current) {
                videoRef.current.currentTime = media.currentTime;
                videoRef.current.playbackRate = targetSpeed;
                void videoRef.current.play().catch(() => { /* ignore */ });
              }
            };
            media.addEventListener('canplay', onCanPlay, { once: true });
          }
        }, 100);
      }
    }, 2000);

    return () => {
      if (stallCheckRef.current) {
        clearInterval(stallCheckRef.current);
        stallCheckRef.current = null;
      }
    };
  }, [playing, getMedia, isDualTrack]);

  const handleAudioError = useCallback(() => {
    if (loadTimeoutRef.current) { clearTimeout(loadTimeoutRef.current); loadTimeoutRef.current = null; }
    setAudioLoading(false);
    setProxyError(true);
  }, []);
  const handleAudioCanPlay = useCallback(() => {
    if (loadTimeoutRef.current) { clearTimeout(loadTimeoutRef.current); loadTimeoutRef.current = null; }
    setAudioLoading(false);
  }, []);

  // 音频加载超时保护：src 变更时启动 40 秒计时器
  useEffect(() => {
    if (loadTimeoutRef.current) { clearTimeout(loadTimeoutRef.current); loadTimeoutRef.current = null; }
    if (!audioSrc) { setAudioLoading(false); return; }
    setAudioLoading(true);
    loadTimeoutRef.current = setTimeout(() => {
      setAudioLoading(false);
      setProxyError(true);
    }, 40_000);
    return () => { if (loadTimeoutRef.current) { clearTimeout(loadTimeoutRef.current); loadTimeoutRef.current = null; } };
  }, [audioSrc]);

  if (!source) return null;

  const originalUrl = source.resolvedUrl || source.originalUrl;

  // ── 直播放视频文件 ──
  if (isDirectVideo(source) && videoSrc) {
    return (
      <div ref={containerRef} className={className} data-testid="video-review-player">
        <div className="relative bg-black rounded-xl overflow-hidden">
          {/* 可点击视频画面区域 */}
          <button
            type="button"
            onClick={handleVideoAreaClick}
            className="relative block w-full border-0 p-0 bg-transparent cursor-pointer"
            aria-label={playing ? '暂停' : '播放'}
          >
            <video
              ref={videoRef}
              src={videoSrc}
              preload="metadata"
              playsInline
              className="aspect-video w-full bg-black pointer-events-none"
              poster={safeThumbnailUrl || undefined}
              onTimeUpdate={handleTimeUpdate}
              onProgress={handleProgress}
              onEnded={handleEnded}
              onPlay={handlePlay}
              onPause={handlePause}
              onWaiting={handleWaiting}
              onPlaying={handlePlaying}
            />
            <PlayPauseIndicator action={indicator?.action ?? null} key={indicator?.key} />
          </button>
          {isBuffering && (
            <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
              <div className="w-10 h-10 border-3 border-white/20 border-t-white rounded-full animate-spin" />
            </div>
          )}
          <NativePlayerBar
            playing={playing}
            currentTimeMs={currentTimeMs}
            totalDurationMs={effectiveDuration}
            speed={speed}
            buffered={buffered}
            onTogglePlay={togglePlay}
            onSeek={handleSeek}
            onSpeedChange={cycleSpeed}
            onToggleFullscreen={toggleFullscreen}
            hasVideo
            title={source.title}
          />
        </div>
        <style>{INDICATOR_CSS}</style>
      </div>
    );
  }

  // ── B站视频：原生 <video> + <audio> 双轨 Dash 播放 ──
  // B站 Dash 格式视频和音频是分离的流，需要同步播放。
  // 用 <video> 播画面（muted），<audio> 播声音，通过 audio 的 timeupdate 驱动进度。
  if (isBilibili(source)) {
    if (videoSrc && audioSrc && !proxyError) {
      return (
        <div ref={containerRef} className={className} data-testid="video-review-player">
          <div className="relative bg-black rounded-xl overflow-hidden">
            {/* 可点击视频画面区域 — 整个画面可暂停/播放 */}
            <button
              type="button"
              onClick={handleVideoAreaClick}
              className="relative block w-full border-0 p-0 bg-transparent cursor-pointer"
              aria-label={playing ? '暂停' : '播放'}
            >
              {/* 视频画面：静音播放，由 audio 驱动同步 */}
              <video
                ref={videoRef}
                src={videoSrc}
                preload="metadata"
                playsInline
                muted
                className="aspect-video w-full bg-black pointer-events-none"
                poster={safeThumbnailUrl || undefined}
              />
              <PlayPauseIndicator action={indicator?.action ?? null} key={indicator?.key} />
            </button>

            {isBuffering && (
              <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
                <div className="w-10 h-10 border-3 border-white/20 border-t-white rounded-full animate-spin" />
              </div>
            )}

            {/* 音频：真正的声音源 + 进度源 */}
            <audio
              ref={audioRef}
              src={audioSrc}
              preload="metadata"
              onTimeUpdate={handleTimeUpdate}
              onProgress={handleProgress}
              onEnded={handleEnded}
              onPlay={handlePlay}
              onPause={handlePause}
              onError={handleAudioError}
              onCanPlay={handleAudioCanPlay}
              onWaiting={handleWaiting}
              onPlaying={handlePlaying}
            />

            {audioLoading && (
              <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60">
                <div className="flex flex-col items-center gap-2">
                  <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <p className="text-[13px] text-white/70">加载视频中…</p>
                </div>
              </div>
            )}

            <NativePlayerBar
              playing={playing}
              currentTimeMs={currentTimeMs}
              totalDurationMs={effectiveDuration}
              speed={speed}
              buffered={buffered}
              onTogglePlay={togglePlay}
              onSeek={handleSeek}
              onSpeedChange={cycleSpeed}
              onToggleFullscreen={toggleFullscreen}
              hasVideo
              title={source.title}
            />
          </div>
          <style>{INDICATOR_CSS}</style>
        </div>
      );
    }

    // fallback：B 站 iframe 可用时先用嵌入播放器，避免 bvid/cid 或 CDN 代理异常时黑屏。
    if (source.embedUrl) {
      return (
        <div ref={containerRef} className={className} data-testid="video-review-player">
          <div className="relative overflow-hidden rounded-xl bg-black">
            <iframe
              src={source.embedUrl}
              title={source.title || 'Bilibili 视频'}
              className="aspect-video w-full border-0 bg-black"
              allow="autoplay; fullscreen; picture-in-picture"
              allowFullScreen
            />
          </div>
        </div>
      );
    }

    // fallback：没有代理视频但有音频 → 音频+封面模式
    if (audioSrc && !proxyError) {
      return (
        <div ref={containerRef} className={className} data-testid="video-review-player">
          <div className="relative bg-black rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={handleCoverClick}
              className="relative aspect-video w-full bg-black flex items-center justify-center overflow-hidden cursor-pointer border-0 p-0 text-left"
              aria-label={playing ? '暂停' : '播放'}
            >
              {safeThumbnailUrl ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={safeThumbnailUrl}
                    alt={source.title || ''}
                    className="absolute inset-0 w-full h-full object-cover opacity-40 blur-sm"
                    referrerPolicy="no-referrer"
                  />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={safeThumbnailUrl}
                    alt={source.title || ''}
                    className="relative z-10 max-h-full max-w-full object-contain"
                    referrerPolicy="no-referrer"
                  />
                </>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/10">
                    <svg className="h-8 w-8 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                    </svg>
                  </div>
                  <p className="text-[13px] text-white/40">音频回放模式</p>
                </div>
              )}

              <div
                className={`absolute inset-0 z-30 flex items-center justify-center transition-opacity duration-300 ${
                  !playing || showOverlayControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
                }`}
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-black/40">
                  {playing ? (
                    <svg className="h-7 w-7 text-white" fill="currentColor" viewBox="0 0 24 24">
                      <rect x="6" y="4" width="4" height="16" rx="1" />
                      <rect x="14" y="4" width="4" height="16" rx="1" />
                    </svg>
                  ) : (
                    <svg className="h-7 w-7 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  )}
                </div>
              </div>
            </button>

            <audio
              ref={audioRef}
              src={audioSrc}
              preload="metadata"
              onTimeUpdate={handleTimeUpdate}
              onProgress={handleProgress}
              onEnded={handleEnded}
              onPlay={handlePlay}
              onPause={handlePause}
              onError={handleAudioError}
              onCanPlay={handleAudioCanPlay}
              onWaiting={handleWaiting}
              onPlaying={handlePlaying}
            />

            {audioLoading && (
              <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60">
                <div className="flex flex-col items-center gap-2">
                  <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <p className="text-[13px] text-white/70">加载音频中…</p>
                </div>
              </div>
            )}

            <NativePlayerBar
              playing={playing}
              currentTimeMs={currentTimeMs}
              totalDurationMs={effectiveDuration}
              speed={speed}
              buffered={buffered}
              onTogglePlay={togglePlay}
              onSeek={handleSeek}
              onSpeedChange={cycleSpeed}
              title={source.title}
            />
          </div>
        </div>
      );
    }
  }

  // ── 通用 provider（youtube / douyin / generic 等）──
  // 有 videoSrc：用 <video> 单轨播放
  if (videoSrc) {
    return (
      <div ref={containerRef} className={className} data-testid="video-review-player">
        <div className="relative bg-black rounded-xl overflow-hidden">
          <button
            type="button"
            onClick={handleVideoAreaClick}
            className="relative block w-full border-0 p-0 bg-transparent cursor-pointer"
            aria-label={playing ? '暂停' : '播放'}
          >
            <video
              ref={videoRef}
              src={videoSrc}
              preload="metadata"
              playsInline
              className="aspect-video w-full bg-black pointer-events-none"
              poster={safeThumbnailUrl || undefined}
              onTimeUpdate={handleTimeUpdate}
              onProgress={handleProgress}
              onEnded={handleEnded}
              onPlay={handlePlay}
              onPause={handlePause}
              onWaiting={handleWaiting}
              onPlaying={handlePlaying}
            />
            <PlayPauseIndicator action={indicator?.action ?? null} key={indicator?.key} />
          </button>
          {isBuffering && (
            <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
              <div className="w-10 h-10 border-3 border-white/20 border-t-white rounded-full animate-spin" />
            </div>
          )}
          <NativePlayerBar
            playing={playing}
            currentTimeMs={currentTimeMs}
            totalDurationMs={effectiveDuration}
            speed={speed}
            buffered={buffered}
            onTogglePlay={togglePlay}
            onSeek={handleSeek}
            onSpeedChange={cycleSpeed}
            onToggleFullscreen={toggleFullscreen}
            hasVideo
            title={source.title}
          />
        </div>
        <style>{INDICATOR_CSS}</style>
      </div>
    );
  }

  // 只有 audioSrc：用 <audio> + 封面图模式
  if (audioSrc) {
    return (
      <div ref={containerRef} className={className} data-testid="video-review-player">
        <div className="relative bg-black rounded-xl overflow-hidden">
          <button
            type="button"
            onClick={handleCoverClick}
            className="relative aspect-video w-full bg-black flex items-center justify-center overflow-hidden cursor-pointer border-0 p-0 text-left"
            aria-label={playing ? '暂停' : '播放'}
          >
            {safeThumbnailUrl ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={safeThumbnailUrl}
                  alt={source.title || ''}
                  className="absolute inset-0 w-full h-full object-cover opacity-40 blur-sm"
                  referrerPolicy="no-referrer"
                />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={safeThumbnailUrl}
                  alt={source.title || ''}
                  className="relative z-10 max-h-full max-w-full object-contain"
                  referrerPolicy="no-referrer"
                />
              </>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/10">
                  <svg className="h-8 w-8 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                  </svg>
                </div>
                <p className="text-[13px] text-white/40">音频回放模式</p>
              </div>
            )}

            <div
              className={`absolute inset-0 z-30 flex items-center justify-center transition-opacity duration-300 ${
                !playing || showOverlayControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
              }`}
            >
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-black/40">
                {playing ? (
                  <svg className="h-7 w-7 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <rect x="6" y="4" width="4" height="16" rx="1" />
                    <rect x="14" y="4" width="4" height="16" rx="1" />
                  </svg>
                ) : (
                  <svg className="h-7 w-7 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </div>
            </div>
          </button>

          <audio
            ref={audioRef}
            src={audioSrc}
            preload="metadata"
            onTimeUpdate={handleTimeUpdate}
            onProgress={handleProgress}
            onEnded={handleEnded}
            onPlay={handlePlay}
            onPause={handlePause}
            onWaiting={handleWaiting}
            onPlaying={handlePlaying}
          />

          <NativePlayerBar
            playing={playing}
            currentTimeMs={currentTimeMs}
            totalDurationMs={effectiveDuration}
            speed={speed}
            buffered={buffered}
            onTogglePlay={togglePlay}
            onSeek={handleSeek}
            onSpeedChange={cycleSpeed}
            title={source.title}
          />
        </div>
      </div>
    );
  }

  // ── 回退：外链打开 + 重试 ──
  return (
    <div className={className} data-testid="video-review-player">
      <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-xl bg-black/90">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10">
          <svg className="h-7 w-7 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        </div>
        <p className="text-sm text-white/50">视频加载失败</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => { setProxyError(false); setAudioLoading(true); }}
            className="rounded-lg bg-white/10 px-4 py-1.5 text-sm text-white transition hover:bg-white/20"
          >重试</button>
          <a
            href={originalUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg bg-white/10 px-4 py-1.5 text-sm text-white transition hover:bg-white/20"
          >在新窗口打开</a>
        </div>
      </div>
    </div>
  );
}

export const VideoReviewPlayer = memo(VideoReviewPlayerComponent);
