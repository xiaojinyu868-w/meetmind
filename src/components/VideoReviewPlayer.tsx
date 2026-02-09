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
  const baseEmbedUrl = source?.embedUrl || '';
  const [embedSrc, setEmbedSrc] = useState(baseEmbedUrl);

  useEffect(() => {
    setEmbedSrc(baseEmbedUrl);
  }, [baseEmbedUrl]);

  useEffect(() => {
    if (!source) return;
    if (source.embedUrl && seekToMs > 0) {
      setEmbedSrc(withStartTime(source.embedUrl, seekToMs, seekNonce));
      return;
    }
    if (isDirectVideo(source) && videoRef.current && seekToMs >= 0) {
      videoRef.current.currentTime = seekToMs / 1000;
    }
  }, [source, seekToMs, seekNonce]);

  const effectiveEmbedSrc = useMemo(
    () => embedSrc || source?.embedUrl || '',
    [embedSrc, source?.embedUrl]
  );

  if (!source) return null;

  return (
    <section className={className}>
      <div className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-gray-900">{source.title || '视频复习'}</h3>
            <p className="text-xs text-gray-500">{source.providerLabel}</p>
          </div>
          <a
            href={source.resolvedUrl || source.originalUrl}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-600 transition hover:border-gray-300 hover:text-gray-900"
          >
            打开原视频
          </a>
        </div>

        {source.embedUrl ? (
          <div className="overflow-hidden rounded-xl border border-gray-100">
            <div className="relative w-full pb-[56.25%]">
              <iframe
                src={effectiveEmbedSrc}
                title={source.title || 'review-video'}
                className="absolute inset-0 h-full w-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            </div>
          </div>
        ) : isDirectVideo(source) ? (
          <video
            ref={videoRef}
            src={source.playableUrl}
            controls
            preload="metadata"
            className="h-auto w-full rounded-xl border border-gray-100"
          />
        ) : (
          <p className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-500">
            该平台限制内嵌播放，请点击“打开原视频”观看。
          </p>
        )}
      </div>
    </section>
  );
}

export const VideoReviewPlayer = memo(VideoReviewPlayerComponent);
