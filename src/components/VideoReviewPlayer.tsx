'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ImportedVideoSource } from '@/types';

interface VideoReviewPlayerProps {
  source: ImportedVideoSource | null;
  className?: string;
  seekToMs?: number;
  seekNonce?: number;
  playNonce?: number;
  onTimeUpdate?: (currentTimeMs: number) => void;
  totalDurationMs?: number;
}

function isDirectVideo(source: ImportedVideoSource): boolean {
  return source.provider === 'direct-file' && !!source.playableUrl;
}

function isBilibili(source: ImportedVideoSource): boolean {
  return source.provider === 'bilibili';
}

function buildBilibiliEmbedBaseUrl(source: ImportedVideoSource): string {
  if (source.embedUrl) {
    try {
      const parsed = new URL(source.embedUrl);
      // 保留后端解析出的 page/cid 参数，并补齐播放器体验参数。
      const page = parsed.searchParams.get('page');
      if (page && !parsed.searchParams.get('p')) {
        parsed.searchParams.set('p', page);
      }
      if (source.cid && !parsed.searchParams.get('cid')) {
        parsed.searchParams.set('cid', String(source.cid));
      }
      if (source.bvid && !parsed.searchParams.get('bvid')) {
        parsed.searchParams.set('bvid', source.bvid);
      }
      parsed.searchParams.set('high_quality', '1');
      parsed.searchParams.set('danmaku', '0');
      parsed.searchParams.set('autoplay', '0');
      return parsed.toString();
    } catch {
      // ignore and fallback below
    }
  }

  const bvid = source.bvid || '';
  const cidPart = source.cid ? `&cid=${encodeURIComponent(String(source.cid))}` : '';
  if (bvid) {
    return `https://player.bilibili.com/player.html?bvid=${encodeURIComponent(bvid)}&p=1${cidPart}&high_quality=1&danmaku=0&autoplay=0`;
  }
  return source.embedUrl || '';
}

function withStartTime(url: string, seekToMs: number, seekNonce: number, autoplay: boolean = false): string {
  try {
    const safeMs = Math.max(0, Math.floor(seekToMs));
    const safeSec = Math.floor(safeMs / 1000);
    const parsed = new URL(url);
    // Write multiple start parameters for bilibili embed compatibility.
    parsed.searchParams.set('t', String(safeSec));
    parsed.searchParams.set('start', String(safeSec));
    parsed.searchParams.set('start_progress', String(safeMs));
    parsed.searchParams.set('seek_nonce', String(seekNonce));
    parsed.searchParams.set('autoplay', autoplay ? '1' : '0');
    return parsed.toString();
  } catch {
    return url;
  }
}

function fmtTime(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`;
}

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

interface IframeSyncBarProps {
  seekToMs: number;
  seekNonce: number;
  playNonce: number;
  totalDurationMs: number;
  onTimeUpdate?: (ms: number) => void;
  audioUrl?: string;
  onSyncMainVideo?: (timeMs: number, autoPlay?: boolean) => void;
}

function IframeSyncBar({
  seekToMs,
  seekNonce,
  playNonce,
  totalDurationMs,
  onTimeUpdate,
  audioUrl,
  onSyncMainVideo,
}: IframeSyncBarProps) {
  const [playing, setPlaying] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [simTime, setSimTime] = useState(seekToMs);
  const [speed, setSpeed] = useState(1);
  const [dragging, setDragging] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const simTimeRef = useRef(simTime);
  const barRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const seekNonceRef = useRef<number>(seekNonce);
  const playNonceRef = useRef<number>(playNonce);

  simTimeRef.current = simTime;

  const hasAudio = Boolean(audioUrl);
  const duration = totalDurationMs > 0 ? totalDurationMs : 1;
  const progress = Math.min(1, Math.max(0, simTime / duration));
  const normalizedSeekMs = Number.isFinite(seekToMs) ? Math.max(0, seekToMs) : 0;

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = speed;
    }
  }, [speed]);

  useEffect(() => {
    if (seekNonceRef.current === seekNonce) return;
    seekNonceRef.current = seekNonce;

    const next = normalizedSeekMs;
    setSimTime(next);
    simTimeRef.current = next;

    if (hasAudio && audioRef.current) {
      try {
        audioRef.current.currentTime = next / 1000;
      } catch {
        // ignore seek errors before metadata is ready
      }
    }
  }, [hasAudio, normalizedSeekMs, seekNonce]);

  useEffect(() => {
    if (playNonceRef.current === playNonce) return;
    playNonceRef.current = playNonce;

    if (hasAudio && audioRef.current) {
      const audio = audioRef.current;
      try {
        if (Math.abs(audio.currentTime - normalizedSeekMs / 1000) > 0.2) {
          audio.currentTime = normalizedSeekMs / 1000;
        }
      } catch {
        // ignore seek errors before metadata is ready
      }
      void audio.play().then(() => {
        setPlaying(true);
      }).catch(() => {
        setPlaying(false);
      });
      return;
    }

    setPlaying(true);
  }, [hasAudio, normalizedSeekMs, playNonce]);

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (!hasAudio && playing && !dragging) {
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
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [hasAudio, playing, dragging, speed, duration, onTimeUpdate]);

  const seekBarTime = useCallback((nextMs: number) => {
    const next = Math.max(0, Math.min(nextMs, duration));
    setSimTime(next);
    simTimeRef.current = next;
    onTimeUpdate?.(next);

    if (hasAudio && audioRef.current) {
      audioRef.current.currentTime = next / 1000;
    }
  }, [duration, hasAudio, onTimeUpdate]);

  const togglePlay = useCallback(async () => {
    if (!hasAudio) {
      setPlaying((prev) => {
        if (!prev && simTimeRef.current >= duration) {
          seekBarTime(0);
        }
        return !prev;
      });
      return;
    }

    const audio = audioRef.current;
    if (!audio) return;

    if (audio.paused) {
      if (audio.currentTime * 1000 >= duration) {
        seekBarTime(0);
      }
      try {
        await audio.play();
        setPlaying(true);
      } catch {
        setPlaying(false);
      }
    } else {
      audio.pause();
      setPlaying(false);
    }
  }, [hasAudio, duration, seekBarTime]);

  const cycleSpeed = useCallback(() => {
    setSpeed((prev) => {
      const index = SPEED_OPTIONS.indexOf(prev as (typeof SPEED_OPTIONS)[number]);
      return SPEED_OPTIONS[(index + 1) % SPEED_OPTIONS.length];
    });
  }, []);

  const handleBarInteraction = useCallback((clientX: number) => {
    if (!barRef.current) return;
    const rect = barRef.current.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    seekBarTime(ratio * duration);
  }, [duration, seekBarTime]);

  const handleMouseDown = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    setDragging(true);
    handleBarInteraction(event.clientX);

    const onMove = (moveEvent: MouseEvent) => handleBarInteraction(moveEvent.clientX);
    const onUp = () => {
      setDragging(false);
      // Sync main video after explicit seek to avoid frequent iframe reloads while dragging.
      onSyncMainVideo?.(simTimeRef.current, playing);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [handleBarInteraction, onSyncMainVideo, playing]);

  const handleAudioTimeUpdate = useCallback(() => {
    if (!audioRef.current) return;
    const nowMs = audioRef.current.currentTime * 1000;
    setSimTime(nowMs);
    onTimeUpdate?.(nowMs);
  }, [onTimeUpdate]);

  const statusText = hasAudio
    ? (playing ? '音轨同步中' : '可播放音轨回放')
    : (playing ? '字幕同步中' : '仅字幕同步（无音轨）');

  return (
    <div className="bg-slate-950/95 backdrop-blur-sm border-t border-white/10 select-none">
      {hasAudio && (
        <audio
          ref={audioRef}
          src={audioUrl}
          preload="metadata"
          onLoadedMetadata={() => {
            if (!audioRef.current) return;
            try {
              audioRef.current.currentTime = normalizedSeekMs / 1000;
            } catch {
              // ignore
            }
          }}
          onTimeUpdate={handleAudioTimeUpdate}
          onEnded={() => setPlaying(false)}
          onPause={() => setPlaying(false)}
          onPlay={() => setPlaying(true)}
        />
      )}

      <div className="flex items-center gap-2 px-3 py-2">
        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-rose-400/15 text-rose-300 border border-rose-300/30">
          学习时间轴
        </span>
        <span className="text-[11px] text-white/60 truncate">
          点击即播；主视频按需同步
        </span>
        <div className="flex-1" />
        {onSyncMainVideo && (
          <button
            type="button"
            onClick={() => onSyncMainVideo(simTimeRef.current, playing)}
            className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-[11px] text-white/75 hover:bg-white/10 transition-colors"
            title="把主视频同步到当前学习时间轴位置（会重载主视频）"
          >
            同步主视频
          </button>
        )}
        <button
          onClick={togglePlay}
          className="flex items-center justify-center w-7 h-7 rounded-full bg-rose-300/20 hover:bg-rose-300/30 transition-colors"
          title={hasAudio ? '播放或暂停音轨回放' : '开始或暂停字幕同步'}
        >
          {playing ? (
            <svg className="w-3.5 h-3.5 text-rose-200" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5 text-rose-200 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>
        <span className="text-[11px] font-mono text-white/75 tabular-nums min-w-[5.5rem] text-right">
          {fmtTime(simTime)} / {fmtTime(duration)}
        </span>
        <button
          type="button"
          data-testid="learning-track-toggle"
          data-onboarding="learning-track"
          onClick={() => setExpanded((prev) => !prev)}
          className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-[11px] text-white/75 hover:bg-white/10 transition-colors"
          title={expanded ? '收起学习时间轴' : '展开学习时间轴'}
        >
          {expanded ? '收起' : '展开'}
        </button>
      </div>

      {expanded && (
        <div className="px-3 pb-2" data-testid="learning-track-panel">
          <div
            ref={barRef}
            className="relative h-1.5 bg-white/10 rounded-full cursor-pointer group mb-2"
            onMouseDown={handleMouseDown}
          >
            <div
              className="absolute left-0 top-0 h-full bg-rose-300 rounded-full transition-[width] duration-100"
              style={{ width: `${progress * 100}%` }}
            />
            <div
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 bg-rose-300 rounded-full shadow-md opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ left: `${progress * 100}%` }}
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={cycleSpeed}
              className="px-1.5 py-0.5 text-[11px] font-mono rounded bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors tabular-nums"
              title="切换播放倍速"
            >
              {speed}x
            </button>
            <div className="flex-1" />
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                playing
                  ? 'bg-rose-300/20 text-rose-200'
                  : 'bg-white/5 text-white/40'
              }`}
            >
              {statusText}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function VideoReviewPlayerComponent({
  source,
  className,
  seekToMs = 0,
  seekNonce = 0,
  playNonce = 0,
  onTimeUpdate,
  totalDurationMs = 0,
}: VideoReviewPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [iframeError, setIframeError] = useState(false);
  const [iframeSrc, setIframeSrc] = useState('');
  const seekNonceRef = useRef(seekNonce);
  const playNonceRef = useRef(playNonce);

  const baseEmbedSrc = useMemo(() => {
    if (!source) return '';
    if (isBilibili(source)) return buildBilibiliEmbedBaseUrl(source);
    return source.embedUrl || '';
  }, [source]);

  useEffect(() => {
    if (!source || isDirectVideo(source)) {
      setIframeSrc('');
      setIframeError(false);
      return;
    }
    setIframeError(false);
    setIframeSrc(withStartTime(baseEmbedSrc, seekToMs, 0));
  }, [source, baseEmbedSrc]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (source && isDirectVideo(source) && videoRef.current && seekToMs >= 0) {
      videoRef.current.currentTime = seekToMs / 1000;
    }
  }, [source, seekToMs, seekNonce]);

  useEffect(() => {
    // Embedded bilibili player cannot be seeked directly; update URL on explicit seek/autoplay requests.
    if (!source || isDirectVideo(source) || !baseEmbedSrc) {
      seekNonceRef.current = seekNonce;
      playNonceRef.current = playNonce;
      return;
    }
    const seekChanged = seekNonceRef.current !== seekNonce;
    const playChanged = playNonceRef.current !== playNonce;
    seekNonceRef.current = seekNonce;
    playNonceRef.current = playNonce;
    if (!seekChanged && !playChanged) return;
    setIframeError(false);
    setIframeSrc(withStartTime(baseEmbedSrc, seekToMs, Date.now(), playChanged));
  }, [baseEmbedSrc, playNonce, seekNonce, seekToMs, source]);

  const syncMainVideo = useCallback((timeMs: number, autoPlay: boolean = false) => {
    if (!source || isDirectVideo(source)) return;
    if (!baseEmbedSrc) return;
    setIframeSrc(withStartTime(baseEmbedSrc, timeMs, Date.now(), autoPlay));
  }, [baseEmbedSrc, source]);

  const isEmbed = !!source && !isDirectVideo(source) && !!iframeSrc && !iframeError;
  const effectiveDuration = totalDurationMs > 0
    ? totalDurationMs
    : (source?.durationSec ? source.durationSec * 1000 : 0);

  if (!source) return null;

  const originalUrl = source.resolvedUrl || source.originalUrl;

  if (isDirectVideo(source)) {
    return (
      <div className={className} data-testid="video-review-player">
        <video
          ref={videoRef}
          src={source.playableUrl}
          controls
          preload="metadata"
          className="aspect-video w-full bg-black"
          onTimeUpdate={onTimeUpdate ? (event) => onTimeUpdate((event.target as HTMLVideoElement).currentTime * 1000) : undefined}
        />
      </div>
    );
  }

  if (isEmbed) {
    return (
      <div className={className} data-testid="video-review-player">
        <div className="relative aspect-video w-full overflow-hidden bg-black">
          <iframe
            src={iframeSrc}
            title={source.title || 'video'}
            className="absolute inset-0 h-full w-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-top-navigation"
            onError={() => setIframeError(true)}
          />
        </div>
        {onTimeUpdate && effectiveDuration > 0 && (
          <IframeSyncBar
            seekToMs={seekToMs}
            seekNonce={seekNonce}
            playNonce={playNonce}
            totalDurationMs={effectiveDuration}
            onTimeUpdate={onTimeUpdate}
            audioUrl={source.audioUrl}
            onSyncMainVideo={syncMainVideo}
          />
        )}
      </div>
    );
  }

  return (
    <div className={className} data-testid="video-review-player">
      <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 bg-gray-900">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10">
          <svg className="h-7 w-7 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        </div>
        <p className="text-sm text-white/50">无法内嵌播放</p>
        <a
          href={originalUrl}
          target="_blank"
          rel="noreferrer"
          className="rounded-lg bg-white/10 px-4 py-1.5 text-sm text-white transition hover:bg-white/20"
        >在新窗口打开</a>
      </div>
    </div>
  );
}

export const VideoReviewPlayer = memo(VideoReviewPlayerComponent);


