/**
 * Types, constants, and error classes for the video import pipeline.
 *
 * Extracted from route.ts to keep the route handler lean and improve
 * code-navigability for agents.
 */

import { BilibiliImportError } from '@/lib/services/bilibili-import-service';
import { XiaoyuzhouImportError } from '@/lib/services/xiaoyuzhou-import-service';
import { MediaToolError, isToolNotFoundError } from '@/lib/services/media-tooling';

// ---------------------------------------------------------------------------
// Transcribe / pipeline types
// ---------------------------------------------------------------------------

export type TranscribeMode = 'turbo' | 'fast' | 'standard';
export type VideoSourceMode = 'bili-native' | 'bili-subtitle' | 'yt-dlp' | 'direct' | 'xiaoyuzhou';
export type StageName = 'bili-native' | 'yt-dlp-fallback' | 'direct-media' | 'xiaoyuzhou';

export interface ImportTraceEntry {
  stage: string;
  ok: boolean;
  code?: string;
  detail?: string;
}

export interface ImportRequestBody {
  url?: string;
  mode?: TranscribeMode;
  language?: string;
  biliCookie?: string;
}

export interface VideoImportMeta {
  title?: string;
  durationSec?: number;
  thumbnailUrl?: string;
  resolvedUrl?: string;
  embedUrl?: string;
  bvid?: string;
  cid?: number;
  /** 平台原始音频地址（如小宇宙 CDN m4a）：本服副本被清理时的兜底 / 重转写用 */
  originAudioUrl?: string;
}

export interface StageResult {
  sourceMode: VideoSourceMode;
  audioFilePath?: string;
  subtitleSegments?: Array<{ text: string; startMs: number; endMs: number }>;
  meta: VideoImportMeta;
  /** B 站音频只下到一部分（<25% 但 ≥60s）被放行时的真实覆盖率——必须在响应里显式标记 partial */
  partialDownload?: { coverageRatio: number };
}

/** ASR 实际出结果的模式：HTTP 三模式之一，或 WS 代理兜底 */
export type UsedAsrMode = TranscribeMode | 'ws-fallback';

export interface TranscribedResult {
  data: Record<string, unknown>;
  usedMode: UsedAsrMode;
  /** 结果被采用但内容不完整时的真实时间线覆盖率（0-1），供响应 coverageRatio 使用 */
  coverageRatio?: number;
}

export interface StageFailure {
  stage: StageName;
  error: ImportPipelineError;
}

export interface WsResultSentence {
  id?: string;
  text?: string;
  beginTime?: number;
  endTime?: number;
  confidence?: number;
  isFinal?: boolean;
}

export interface NormalizedSegment {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  confidence: number;
  isFinal: boolean;
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class ImportPipelineError extends Error {
  code: string;
  detail?: string;

  constructor(code: string, message: string, detail?: string) {
    super(message);
    this.name = 'ImportPipelineError';
    this.code = code;
    this.detail = detail;
  }
}

// ---------------------------------------------------------------------------
// Pipeline constants
// ---------------------------------------------------------------------------

export const TIMELINE_SCALE_RATIO_MIN = 0.65;
export const TIMELINE_SCALE_RATIO_MAX = 1.35;
export const PCM_BYTES_PER_SEC = 16000 * 2;
export const MIN_DURATION_FOR_COMPLETENESS_CHECK_SEC = 60;
export const MIN_TEXT_CHARS_PER_SEC = 1;
export const MIN_TEXT_COVERAGE_RATIO = 0.45;
export const MIN_TIMELINE_COVERAGE_SHORT = 0.6;
export const MIN_TIMELINE_COVERAGE_LONG = 0.7;

// ---------------------------------------------------------------------------
// Pure utility functions
// ---------------------------------------------------------------------------

export function normalizeMode(mode?: string): TranscribeMode {
  if (mode === 'fast' || mode === 'standard') return mode;
  return 'turbo';
}

export function normalizeLanguage(language?: string): string {
  return language && language.trim() ? language.trim() : 'zh';
}

export function isPipelineError(error: unknown): error is ImportPipelineError {
  return error instanceof ImportPipelineError;
}

export function toPipelineError(error: unknown): ImportPipelineError {
  if (isPipelineError(error)) return error;

  if (error instanceof BilibiliImportError) {
    return new ImportPipelineError(error.code, error.message, error.detail);
  }

  if (error instanceof XiaoyuzhouImportError) {
    return new ImportPipelineError(error.code, error.message, error.detail);
  }

  if (error instanceof MediaToolError) {
    if (isToolNotFoundError(error, 'ffmpeg') || isToolNotFoundError(error, 'ffprobe')) {
      return new ImportPipelineError('FFMPEG_NOT_FOUND', '音频处理工具未安装', error.detail || error.message);
    }
    if (isToolNotFoundError(error, 'yt-dlp')) {
      return new ImportPipelineError('YTDLP_UNAVAILABLE', '下载器不可用', error.detail || error.message);
    }
    if (error.code === 'FFMPEG_FAILED' && (error.detail || '').includes('code null')) {
      return new ImportPipelineError(error.code, '音频转码被系统终止（内存不足），请稍后重试', error.detail || error.message);
    }
    return new ImportPipelineError(error.code, '媒体处理失败', error.detail || error.message);
  }

  if (error instanceof Error) {
    return new ImportPipelineError('VIDEO_IMPORT_FAILED', '视频导入失败', error.message);
  }

  return new ImportPipelineError('VIDEO_IMPORT_FAILED', '视频导入失败');
}

export function statusFromCode(code: string): number {
  if (
    code === 'INVALID_VIDEO_URL' ||
    code === 'MISSING_VIDEO_URL' ||
    code === 'VIDEO_URL_UNSAFE' ||
    code === 'BILI_URL_PARSE_FAILED' ||
    code === 'DIRECT_MEDIA_TOO_LARGE'
  ) {
    return 400;
  }
  if (code === 'BILI_COOKIE_EXPIRED') {
    return 403;
  }
  if (code === 'DIRECT_MEDIA_TIMEOUT') {
    return 504;
  }
  return 500;
}

export function getTranscribeApiPath(mode: TranscribeMode): string {
  if (mode === 'fast') return '/api/transcribe-fast';
  if (mode === 'standard') return '/api/transcribe';
  return '/api/transcribe-turbo';
}

export function buildModeOrder(mode: TranscribeMode): TranscribeMode[] {
  const all: TranscribeMode[] = ['turbo', 'fast', 'standard'];
  const unique = [mode, ...all.filter((item) => item !== mode)];
  return unique;
}

export function parseErrorCode(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const record = data as Record<string, unknown>;
  return typeof record.code === 'string' ? record.code : undefined;
}

export function parseErrorMessage(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const record = data as Record<string, unknown>;
  if (typeof record.error === 'string') return record.error;
  return undefined;
}

export function parseErrorDetail(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const record = data as Record<string, unknown>;
  if (typeof record.detail === 'string') return record.detail;
  return undefined;
}

export function isUnsafeVideoUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return true;
    if (/^10\.|^172\.(1[6-9]|2\d|3[01])\.|^192\.168\./.test(hostname)) return true;
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true;
    return false;
  } catch {
    return true;
  }
}

export function buildStageOrder(
  provider: string,
  videoUrl: string,
  strategy: 'bili-native-first' | 'yt-dlp-first',
  enableYtDlpFallback: boolean,
  isLikelyDirectMediaUrl: (url: string) => boolean,
): StageName[] {
  const stages: StageName[] = [];

  if (provider === 'bilibili') {
    if (strategy === 'yt-dlp-first') {
      if (enableYtDlpFallback) stages.push('yt-dlp-fallback');
      stages.push('bili-native');
    } else {
      stages.push('bili-native');
      if (enableYtDlpFallback) stages.push('yt-dlp-fallback');
    }
    return stages;
  }

  if (provider === 'xiaoyuzhou') {
    stages.push('xiaoyuzhou');
    return stages;
  }

  if (isLikelyDirectMediaUrl(videoUrl)) {
    stages.push('direct-media');
  }

  if (enableYtDlpFallback || stages.length === 0) {
    stages.push('yt-dlp-fallback');
  }

  return stages;
}

export function pickMostInformativeStageError(failures: StageFailure[]): ImportPipelineError | null {
  if (failures.length === 0) return null;

  const priorityCodes = [
    'FFMPEG_NOT_FOUND',
    'ASR_PUBLIC_HOST_MISSING',
    'ASR_API_KEY_MISSING',
    'BILI_COOKIE_EXPIRED',
    'BILI_AUDIO_DOWNLOAD_FORBIDDEN',
    'BILI_AUDIO_INCOMPLETE',
    'BILI_PLAYURL_FAILED',
    'BILI_URL_PARSE_FAILED',
    'BILI_VIEW_META_FAILED',
    'BILI_API_ERROR',
  ];

  for (const code of priorityCodes) {
    const found = failures.find((item) => item.error.code === code);
    if (found) return found.error;
  }

  const nonFallback = failures.find((item) => item.stage !== 'yt-dlp-fallback');
  if (nonFallback) return nonFallback.error;

  const nonYtDlpOnly = failures.find((item) => item.error.code !== 'YTDLP_UNAVAILABLE');
  if (nonYtDlpOnly) return nonYtDlpOnly.error;

  return failures[failures.length - 1].error;
}
