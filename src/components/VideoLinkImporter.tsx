'use client';

import { useMemo, useState } from 'react';
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

const ERROR_MESSAGE_MAP: Record<string, string> = {
  MISSING_VIDEO_URL: '请先输入视频链接。',
  INVALID_VIDEO_URL: '链接格式无法识别，请检查后重试。',
  VIDEO_URL_UNSAFE: '该链接暂不支持导入。',
  BILI_URL_PARSE_FAILED: '无法解析 B站链接，请确认链接可访问。',
  BILI_PLAYURL_FAILED: '未能获取视频音频流，请稍后重试。',
  BILI_COOKIE_EXPIRED: 'B站登录状态已过期，请联系管理员更新 Cookie 后重试。',
  BILI_AUDIO_DOWNLOAD_FORBIDDEN: '当前视频受平台限制，暂时无法直接导入。',
  BILI_AUDIO_INCOMPLETE: 'B站音频下载不完整，可能受平台限制，请稍后重试或更换视频。',
  YTDLP_UNAVAILABLE: '服务端导入能力暂不可用，请稍后重试。',
  FFMPEG_NOT_FOUND: '服务端音频处理组件未就绪，请联系管理员。',
  DIRECT_MEDIA_TIMEOUT: '直链媒体下载超时，请稍后重试。',
  DIRECT_MEDIA_TOO_LARGE: '直链媒体文件过大，请更换较短视频或音频源。',
  ASR_TRANSCRIBE_FAILED: '视频已解析，但转写失败，请稍后重试。',
};

const MODE_HELP_TEXT: Record<TranscribeMode, string> = {
  turbo: '极速模式：优先走 Turbo 转写，速度最快；失败会自动回退到快速/标准。',
  fast: '快速模式：优先走并行分段转写，适合长视频；失败会自动回退到其它模式。',
  standard: '标准模式：优先走标准异步转写，稳定性更高；失败会自动回退到快速/极速。',
};

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

function mapImportError(code?: string, fallback?: string): string {
  if (code && ERROR_MESSAGE_MAP[code]) {
    return ERROR_MESSAGE_MAP[code];
  }

  const normalized = (fallback || '').toLowerCase();
  if (normalized.includes('未授权') || normalized.includes('unauthorized') || normalized.includes('401')) {
    return '登录状态已失效，请刷新页面后重试。';
  }

  return fallback || '视频导入失败，请稍后再试。';
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
  const [url, setUrl] = useState('');
  const [mode, setMode] = useState<TranscribeMode>('turbo');
  const [status, setStatus] = useState<ImportStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [processingMessage, setProcessingMessage] = useState('');
  const [lastSource, setLastSource] = useState<ImportedVideoSource | null>(null);

  const parsedPreview = useMemo(() => parseVideoLink(url), [url]);

  async function handleImport() {
    if (disabled || status === 'processing') return;

    const trimmed = url.trim();
    if (!trimmed) {
      const message = '请先输入视频链接。';
      setStatus('error');
      setErrorMessage(message);
      onError?.(message);
      return;
    }

    setStatus('processing');
    setErrorMessage('');
    setProcessingMessage('正在解析视频...');

    const timers: NodeJS.Timeout[] = [];
    timers.push(setTimeout(() => setProcessingMessage('正在提取音频...'), 800));
    timers.push(setTimeout(() => setProcessingMessage('正在转写...'), 2200));

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
        const message = mapImportError(primaryCode, data?.error || `请求失败 (${response.status})`);
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

      setProcessingMessage('导入完成');
      setLastSource(source);
      setStatus('success');

      onImportReady({
        segments,
        source,
        sourceMode: source.sourceMode,
        trace,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '视频导入失败，请稍后再试。';
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
        <label className="text-sm font-medium text-gray-700">视频链接</label>
        <input
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="粘贴 B站、YouTube、抖音或媒体直链"
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
          <span className="font-medium text-green-700">极速模式（推荐）</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="video-transcribe-mode"
            checked={mode === 'fast'}
            onChange={() => setMode('fast')}
            disabled={disabled || status === 'processing'}
          />
          <span className="text-gray-700">快速模式</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="video-transcribe-mode"
            checked={mode === 'standard'}
            onChange={() => setMode('standard')}
            disabled={disabled || status === 'processing'}
          />
          <span className="text-gray-700">标准模式</span>
        </label>
      </div>

      <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-700">
        {MODE_HELP_TEXT[mode]}
      </div>

      {parsedPreview && (
        <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-600">
          识别平台: {parsedPreview.providerLabel}
        </div>
      )}

      <div className="text-xs text-gray-500">
        说明：三种模式只决定“优先策略”，导入链路会自动回退，不需要你手动反复切换。
      </div>

      <button
        type="button"
        onClick={handleImport}
        disabled={disabled || status === 'processing'}
        className="w-full rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-3 text-sm font-medium text-white shadow-sm transition hover:from-amber-600 hover:to-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status === 'processing' ? '处理中...' : '导入并转写'}
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
          已导入: {lastSource.title || lastSource.providerLabel}
          {formatDuration(lastSource.durationSec) ? ` | 时长 ${formatDuration(lastSource.durationSec)}` : ''}
        </div>
      )}
    </div>
  );
}
