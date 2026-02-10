'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type {
  ImportedVideoResult,
  ImportedVideoSource,
  TranscriptSegment,
  VideoImportTraceEntry,
  VideoSourceMode,
} from '@/types';
import { parseVideoLink } from '@/lib/utils/video-link';

type TranscribeMode = 'turbo' | 'fast' | 'standard';
type ImportStatus = 'idle' | 'processing' | 'error' | 'success';

interface VideoLinkImporterProps {
  onImportReady: (result: ImportedVideoResult) => void;
  onError?: (error: string) => void;
  disabled?: boolean;
}

interface RawSegmentLike {
  id?: string;
  text?: string;
  startMs?: number;
  endMs?: number;
  beginTime?: number;
  endTime?: number;
  confidence?: number;
}

interface ImportApiResponse {
  success?: boolean;
  error?: string;
  code?: string;
  detail?: string;
  sourceMode?: VideoSourceMode;
  trace?: VideoImportTraceEntry[];
  source?: ImportedVideoSource;
  segments?: RawSegmentLike[];
  sentences?: RawSegmentLike[];
}

function useErrorMessageMap(t: ReturnType<typeof useTranslations>): Record<string, string> {
  return {
    MISSING_VIDEO_URL: t('videoImporter.errors.missingUrl'),
    INVALID_VIDEO_URL: t('videoImporter.errors.invalidUrl'),
    VIDEO_URL_UNSAFE: t('videoImporter.errors.unsafeUrl'),
    BILI_URL_PARSE_FAILED: t('videoImporter.errors.biliParseFailed'),
    BILI_PLAYURL_FAILED: t('videoImporter.errors.biliPlayUrlFailed'),
    BILI_COOKIE_EXPIRED: t('videoImporter.errors.biliCookieExpired'),
    BILI_AUDIO_DOWNLOAD_FORBIDDEN: t('videoImporter.errors.biliAudioForbidden'),
    YTDLP_UNAVAILABLE: t('videoImporter.errors.ytdlpUnavailable'),
    FFMPEG_NOT_FOUND: t('videoImporter.errors.ffmpegNotFound'),
    DIRECT_MEDIA_TIMEOUT: t('videoImporter.errors.directMediaTimeout'),
    DIRECT_MEDIA_TOO_LARGE: t('videoImporter.errors.directMediaTooLarge'),
    ASR_TRANSCRIBE_FAILED: t('videoImporter.errors.asrFailed'),
  };
}

function useModeHelpText(t: ReturnType<typeof useTranslations>): Record<TranscribeMode, string> {
  return {
    turbo: t('videoImporter.turboHelp'),
    fast: t('videoImporter.fastHelp'),
    standard: t('videoImporter.standardHelp'),
  };
}

function mapSegments(data: Pick<ImportApiResponse, 'segments' | 'sentences'>): TranscriptSegment[] {
  const rawList = data.segments || data.sentences || [];
  if (!Array.isArray(rawList)) return [];

  return rawList.map((item, index: number) => ({
    id: item.id || `seg-${index}`,
    text: String(item.text || ''),
    startMs: Number(item.startMs ?? item.beginTime ?? 0),
    endMs: Number(item.endMs ?? item.endTime ?? 0),
    confidence: Number(item.confidence ?? 0.9),
    isFinal: true,
  }));
}

function formatDuration(durationSec?: number): string | null {
  if (!durationSec || !Number.isFinite(durationSec)) return null;
  const total = Math.max(0, Math.floor(durationSec));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function mapImportError(code: string | undefined, fallback: string | undefined, errorMap: Record<string, string>, t: ReturnType<typeof useTranslations>): string {
  if (code && errorMap[code]) {
    return errorMap[code];
  }

  const normalized = (fallback || '').toLowerCase();
  if (normalized.includes('未授权') || normalized.includes('unauthorized') || normalized.includes('401')) {
    return t('videoImporter.errors.unauthorized');
  }

  return fallback || t('videoImporter.errors.default');
}

function pickPrimaryErrorCode(data: ImportApiResponse): string | undefined {
  const failedTrace = (data.trace || []).filter((entry) => !entry.ok && entry.code);
  if (failedTrace.length === 0) return data.code;

  const priorityCodes = [
    'FFMPEG_NOT_FOUND',
    'ASR_PUBLIC_HOST_MISSING',
    'ASR_API_KEY_MISSING',
    'BILI_COOKIE_EXPIRED',
    'BILI_AUDIO_DOWNLOAD_FORBIDDEN',
    'BILI_PLAYURL_FAILED',
    'BILI_URL_PARSE_FAILED',
  ];

  for (const code of priorityCodes) {
    const matched = failedTrace.find((entry) => entry.code === code);
    if (matched?.code) return matched.code;
  }

  const nonYtDlp = failedTrace.find((entry) => entry.code !== 'YTDLP_UNAVAILABLE');
  if (nonYtDlp?.code) return nonYtDlp.code;

  return failedTrace[failedTrace.length - 1]?.code || data.code;
}

export function VideoLinkImporter({ onImportReady, onError, disabled }: VideoLinkImporterProps) {
  const t = useTranslations();
  const [url, setUrl] = useState('');
  const [mode, setMode] = useState<TranscribeMode>('turbo');
  const [status, setStatus] = useState<ImportStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [processingMessage, setProcessingMessage] = useState('');
  const [lastSource, setLastSource] = useState<ImportedVideoSource | null>(null);

  const errorMap = useErrorMessageMap(t);
  const modeHelpText = useModeHelpText(t);
  const parsedPreview = useMemo(() => parseVideoLink(url), [url]);

  async function handleImport() {
    if (disabled || status === 'processing') return;

    const trimmed = url.trim();
    if (!trimmed) {
      const message = t('videoImporter.errors.missingUrl');
      setStatus('error');
      setErrorMessage(message);
      onError?.(message);
      return;
    }

    setStatus('processing');
    setErrorMessage('');
    setProcessingMessage(t('videoImporter.parsing'));

    const timers: NodeJS.Timeout[] = [];
    timers.push(setTimeout(() => setProcessingMessage(t('videoImporter.extracting')), 800));
    timers.push(setTimeout(() => setProcessingMessage(t('videoImporter.transcribing')), 2200));

    try {
      const response = await fetch('/api/video/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed, mode, language: 'zh' }),
      });

      const text = await response.text();
      const data = (text ? JSON.parse(text) : {}) as ImportApiResponse;

      if (!response.ok || !data?.success) {
        const primaryCode = pickPrimaryErrorCode(data);
        const message = mapImportError(primaryCode, data?.error || `请求失败 (${response.status})`, errorMap, t);
        throw new Error(message);
      }

      const segments = mapSegments(data);
      const sourceMode = data.sourceMode;
      const trace = data.trace || [];

      const source: ImportedVideoSource = {
        provider: data.source?.provider || parsedPreview?.provider || 'generic',
        providerLabel: data.source?.providerLabel || parsedPreview?.providerLabel || 'Web Video',
        originalUrl: data.source?.originalUrl || trimmed,
        resolvedUrl: data.source?.resolvedUrl,
        embedUrl: data.source?.embedUrl,
        playableUrl: data.source?.playableUrl || trimmed,
        title: data.source?.title,
        durationSec: data.source?.durationSec,
        thumbnailUrl: data.source?.thumbnailUrl,
        audioUrl: data.source?.audioUrl,
        sourceMode: sourceMode || data.source?.sourceMode,
        bvid: data.source?.bvid,
        cid: data.source?.cid,
        importTrace: trace,
      };

      setProcessingMessage(t('common.completed'));
      setLastSource(source);
      setStatus('success');

      onImportReady({
        segments,
        source,
        sourceMode: source.sourceMode,
        trace,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : t('videoImporter.errors.default');
      setStatus('error');
      setErrorMessage(message);
      onError?.(message);
    } finally {
      timers.forEach((timer) => clearTimeout(timer));
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-700">{t('videoImporter.label')}</label>
        <input
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder={t('videoImporter.placeholder')}
          className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
          disabled={disabled || status === 'processing'}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="video-transcribe-mode"
            checked={mode === 'turbo'}
            onChange={() => setMode('turbo')}
            disabled={disabled || status === 'processing'}
          />
          <span className="font-medium text-green-700">{t('videoImporter.turboLabel')}</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="video-transcribe-mode"
            checked={mode === 'fast'}
            onChange={() => setMode('fast')}
            disabled={disabled || status === 'processing'}
          />
          <span className="text-gray-700">{t('videoImporter.fastLabel')}</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="video-transcribe-mode"
            checked={mode === 'standard'}
            onChange={() => setMode('standard')}
            disabled={disabled || status === 'processing'}
          />
          <span className="text-gray-700">{t('videoImporter.standardLabel')}</span>
        </label>
      </div>

      <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-700">
        {modeHelpText[mode]}
      </div>

      {parsedPreview && (
        <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-600">
          {t('videoImporter.platformDetected', { platform: parsedPreview.providerLabel })}
        </div>
      )}

      <div className="text-xs text-gray-500">
        {t('videoImporter.modeNote')}
      </div>

      <button
        type="button"
        onClick={handleImport}
        disabled={disabled || status === 'processing'}
        className="w-full rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-3 text-sm font-medium text-white shadow-sm transition hover:from-amber-600 hover:to-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status === 'processing' ? t('videoImporter.processing') : t('videoImporter.import')}
      </button>

      {status === 'processing' && (
        <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          {processingMessage}
        </div>
      )}

      {status === 'error' && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
          {errorMessage}
        </div>
      )}

      {status === 'success' && lastSource && (
        <div className="rounded-xl border border-green-100 bg-green-50 px-3 py-2 text-sm text-green-700">
          {t('videoImporter.imported', { title: lastSource.title || lastSource.providerLabel })}
          {formatDuration(lastSource.durationSec) ? ` | ${t('videoImporter.duration', { duration: formatDuration(lastSource.durationSec)! })}` : ''}
        </div>
      )}
    </div>
  );
}
