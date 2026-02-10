'use client';

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { ImportedVideoSource } from '@/types';

interface VideoReviewPlayerProps {
  source: ImportedVideoSource | null;
  className?: string;
  seekToMs?: number;
  seekNonce?: number;
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

function VideoReviewPlayerComponent({
  source,
  className,
  seekToMs = 0,
  seekNonce = 0,
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

  if (!source) return null;

  const originalUrl = source.resolvedUrl || source.originalUrl;

  // 直链视频 - 原生 video 标签
  if (isDirectVideo(source)) {
    return (
      <div className={className}>
        <video
          ref={videoRef}
          src={source.playableUrl}
          controls
          preload="metadata"
          className="aspect-video w-full bg-black"
        />
      </div>
    );
  }

  // iframe 嵌入（B站/YouTube 等）
  if (embedSrc && !iframeError) {
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
