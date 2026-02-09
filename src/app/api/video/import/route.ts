import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import type { ReadableStream as WebReadableStream } from 'stream/web';
import { WebSocket } from 'undici';
import { parseVideoLink, isLikelyDirectMediaUrl } from '@/lib/utils/video-link';
import { applyRateLimit } from '@/lib/utils/rate-limit';
import {
  BILIBILI_REFERER,
  BILIBILI_USER_AGENT,
  downloadBiliAudio,
  fetchPlayerSubtitle,
  fetchPlayurlAudio,
  fetchViewMeta,
  resolveBilibiliUrl,
  BilibiliImportError,
} from '@/lib/services/bilibili-import-service';
import {
  MediaToolError,
  extFromContentType,
  isToolNotFoundError,
  resolveFfmpegPath,
  resolveOutputPath,
  runCommand,
  safeUnlink,
  transcodeToMp3,
} from '@/lib/services/media-tooling';

export const runtime = 'nodejs';
export const maxDuration = 900;

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'temp-audio');
const MAX_AGE_MS = 6 * 60 * 60 * 1000;
const CLEANUP_MIN_INTERVAL_MS = Number.parseInt(process.env.VIDEO_IMPORT_CLEANUP_INTERVAL_MS || '300000', 10);
const CLEANUP_EVERY_N_REQUESTS = Number.parseInt(process.env.VIDEO_IMPORT_CLEANUP_EVERY_N || '10', 10);
const YTDLP_AVAILABILITY_TTL_MS = Number.parseInt(process.env.VIDEO_IMPORT_YTDLP_CACHE_MS || '300000', 10);
const DIRECT_DOWNLOAD_TIMEOUT_MS = Number.parseInt(process.env.VIDEO_DIRECT_DOWNLOAD_TIMEOUT_MS || '120000', 10);
const DIRECT_DOWNLOAD_MAX_BYTES = Number.parseInt(process.env.VIDEO_DIRECT_DOWNLOAD_MAX_BYTES || `${300 * 1024 * 1024}`, 10);

type TranscribeMode = 'turbo' | 'fast' | 'standard';
type VideoSourceMode = 'bili-native' | 'bili-subtitle' | 'yt-dlp' | 'direct';
type StageName = 'bili-native' | 'yt-dlp-fallback' | 'direct-media';

interface ImportTraceEntry {
  stage: string;
  ok: boolean;
  code?: string;
  detail?: string;
}

interface ImportRequestBody {
  url?: string;
  mode?: TranscribeMode;
  language?: string;
}

interface VideoImportMeta {
  title?: string;
  durationSec?: number;
  thumbnailUrl?: string;
  resolvedUrl?: string;
  embedUrl?: string;
  bvid?: string;
  cid?: number;
}

interface StageResult {
  sourceMode: VideoSourceMode;
  audioFilePath?: string;
  subtitleSegments?: Array<{ text: string; startMs: number; endMs: number }>;
  meta: VideoImportMeta;
}

interface StageFailure {
  stage: StageName;
  error: ImportPipelineError;
}

interface WsResultSentence {
  id?: string;
  text?: string;
  beginTime?: number;
  endTime?: number;
  confidence?: number;
  isFinal?: boolean;
}

interface NormalizedSegment {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  confidence: number;
  isFinal: boolean;
}

let cleanupRequestCount = 0;
let lastCleanupAt = 0;
let cleanupInFlight: Promise<void> | null = null;
let ytDlpAvailabilityCache: { available: boolean; expiresAt: number } | null = null;

class ImportPipelineError extends Error {
  code: string;
  detail?: string;

  constructor(code: string, message: string, detail?: string) {
    super(message);
    this.name = 'ImportPipelineError';
    this.code = code;
    this.detail = detail;
  }
}

function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

async function cleanupOldFiles() {
  try {
    if (!fs.existsSync(UPLOAD_DIR)) return;
    const files = await fsp.readdir(UPLOAD_DIR);
    const now = Date.now();

    await Promise.all(
      files.map(async (fileName) => {
        const fullPath = path.join(UPLOAD_DIR, fileName);
        try {
          const stat = await fsp.stat(fullPath);
          if (now - stat.mtimeMs > MAX_AGE_MS) {
            await fsp.unlink(fullPath);
          }
        } catch {
          // ignore cleanup single-file errors
        }
      })
    );
  } catch {
    // ignore cleanup errors
  }
}

function scheduleCleanupOldFiles(): void {
  const everyN = Number.isFinite(CLEANUP_EVERY_N_REQUESTS)
    ? Math.max(1, Math.min(100, CLEANUP_EVERY_N_REQUESTS))
    : 10;
  const minIntervalMs = Number.isFinite(CLEANUP_MIN_INTERVAL_MS)
    ? Math.max(10000, Math.min(60 * 60 * 1000, CLEANUP_MIN_INTERVAL_MS))
    : 300000;

  cleanupRequestCount += 1;
  const now = Date.now();
  const dueByCount = cleanupRequestCount % everyN === 0;
  const dueByInterval = now - lastCleanupAt >= minIntervalMs;

  if (!dueByCount && !dueByInterval) return;
  if (cleanupInFlight) return;

  cleanupInFlight = cleanupOldFiles()
    .catch(() => undefined)
    .finally(() => {
      lastCleanupAt = Date.now();
      cleanupInFlight = null;
    });
}

function getOriginFromRequest(request: NextRequest): string {
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || 'localhost:3001';
  const protocol = request.headers.get('x-forwarded-proto') || 'http';
  return `${protocol}://${host}`;
}

function getPublicAudioUrl(request: NextRequest, filePath: string): string {
  const fileName = path.basename(filePath);
  return `${getOriginFromRequest(request)}/temp-audio/${encodeURIComponent(fileName)}`;
}

function isUnsafeVideoUrl(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return true;
  }

  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  ) {
    return true;
  }

  return false;
}

function getYtDlpCommand(): string {
  return process.env.YT_DLP_BIN || 'yt-dlp';
}

async function runYtDlp(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const result = await runCommand(getYtDlpCommand(), args, { toolName: 'yt-dlp' });
  return {
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

async function hasYtDlp(): Promise<boolean> {
  const now = Date.now();
  if (ytDlpAvailabilityCache && now < ytDlpAvailabilityCache.expiresAt) {
    return ytDlpAvailabilityCache.available;
  }

  let available = false;
  try {
    await runYtDlp(['--version']);
    available = true;
  } catch {
    available = false;
  }

  const ttlMs = Number.isFinite(YTDLP_AVAILABILITY_TTL_MS)
    ? Math.max(10000, Math.min(30 * 60 * 1000, YTDLP_AVAILABILITY_TTL_MS))
    : 300000;

  ytDlpAvailabilityCache = {
    available,
    expiresAt: now + ttlMs,
  };

  return available;
}

function parseYtDlpMetaFromStdout(stdout: string): VideoImportMeta {
  const lines = (stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line.startsWith('{') || !line.endsWith('}')) continue;
    try {
      const data = JSON.parse(line) as {
        title?: string;
        duration?: number;
        thumbnail?: string;
        webpage_url?: string;
      };
      return {
        title: typeof data.title === 'string' ? data.title : undefined,
        durationSec: Number.isFinite(data.duration) ? Number(data.duration) : undefined,
        thumbnailUrl: typeof data.thumbnail === 'string' ? data.thumbnail : undefined,
        resolvedUrl: typeof data.webpage_url === 'string' ? data.webpage_url : undefined,
      };
    } catch {
      // skip invalid json line
    }
  }

  return {};
}

async function findGeneratedAudioFile(baseName: string): Promise<string | null> {
  const files = await fsp.readdir(UPLOAD_DIR);
  const matched = files
    .filter((name) => name.startsWith(baseName))
    .map((name) => path.join(UPLOAD_DIR, name));

  if (matched.length === 0) return null;

  const withStat = await Promise.all(
    matched.map(async (filePath) => ({
      filePath,
      stat: await fsp.stat(filePath),
    }))
  );
  withStat.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
  return withStat[0].filePath;
}

async function downloadAudioByYtDlp(
  videoUrl: string,
  baseName: string,
  options: { bilibiliHeaders?: boolean } = {}
): Promise<{ audioPath: string; meta: VideoImportMeta }> {
  const outputTemplate = path.join(UPLOAD_DIR, `${baseName}.%(ext)s`);

  const args = [
    '--no-playlist',
    '--no-warnings',
    '--print-json',
    '--extract-audio',
    '--audio-format',
    'mp3',
    '--audio-quality',
    '0',
  ];

  if (options.bilibiliHeaders) {
    args.push('--add-header', `Referer: ${BILIBILI_REFERER}`);
    args.push('--add-header', `User-Agent: ${BILIBILI_USER_AGENT}`);
    if (process.env.BILIBILI_COOKIE) {
      args.push('--add-header', `Cookie: ${process.env.BILIBILI_COOKIE}`);
    }
  }

  args.push('--output', outputTemplate, videoUrl);

  const { stdout } = await runYtDlp(args);
  const meta = parseYtDlpMetaFromStdout(stdout);

  const audioPath = await findGeneratedAudioFile(baseName);
  if (!audioPath) {
    throw new ImportPipelineError('YTDLP_DOWNLOAD_FAILED', '已下载但未找到提取后的音频文件');
  }

  return { audioPath, meta };
}

async function downloadFile(url: string, targetPath: string): Promise<void> {
  const timeoutMs = Number.isFinite(DIRECT_DOWNLOAD_TIMEOUT_MS)
    ? Math.max(10000, Math.min(10 * 60 * 1000, DIRECT_DOWNLOAD_TIMEOUT_MS))
    : 120000;
  const maxBytes = Number.isFinite(DIRECT_DOWNLOAD_MAX_BYTES)
    ? Math.max(10 * 1024 * 1024, DIRECT_DOWNLOAD_MAX_BYTES)
    : 300 * 1024 * 1024;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
    });
  } catch (error) {
    if ((error as { name?: string })?.name === 'AbortError') {
      throw new ImportPipelineError('DIRECT_MEDIA_TIMEOUT', '直链媒体下载超时');
    }
    throw new ImportPipelineError(
      'DIRECT_MEDIA_DOWNLOAD_FAILED',
      '直链媒体下载失败',
      error instanceof Error ? error.message : String(error)
    );
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new ImportPipelineError('DIRECT_MEDIA_DOWNLOAD_FAILED', `下载失败 (${response.status})`);
  }

  const declaredLength = Number.parseInt(response.headers.get('content-length') || '0', 10);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new ImportPipelineError(
      'DIRECT_MEDIA_TOO_LARGE',
      '直链媒体文件过大',
      `content-length=${declaredLength}`
    );
  }

  if (!response.body) {
    throw new ImportPipelineError('DIRECT_MEDIA_DOWNLOAD_FAILED', '下载失败：响应体为空');
  }

  let downloadedBytes = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      downloadedBytes += chunk.length;
      if (downloadedBytes > maxBytes) {
        callback(new ImportPipelineError('DIRECT_MEDIA_TOO_LARGE', '直链媒体文件过大'));
        return;
      }
      callback(null, chunk);
    },
  });

  await fsp.mkdir(path.dirname(targetPath), { recursive: true });
  try {
    await pipeline(
      Readable.fromWeb(response.body as unknown as WebReadableStream<Uint8Array>),
      limiter,
      fs.createWriteStream(targetPath)
    );
  } catch (error) {
    safeUnlink(targetPath);
    if (error instanceof ImportPipelineError) throw error;
    throw new ImportPipelineError(
      'DIRECT_MEDIA_DOWNLOAD_FAILED',
      '直链媒体下载失败',
      error instanceof Error ? error.message : String(error)
    );
  }
}

async function prepareAudioFromDirectUrl(videoUrl: string, baseName: string): Promise<string> {
  const parsed = new URL(videoUrl);
  const rawExt = extFromContentType(null) || '.bin';
  const ext = path.extname(parsed.pathname).toLowerCase() || rawExt;
  const downloadedPath = resolveOutputPath(UPLOAD_DIR, `${baseName}_raw`, ext);
  const mp3Path = resolveOutputPath(UPLOAD_DIR, baseName, '.mp3');

  try {
    await downloadFile(videoUrl, downloadedPath);
    await transcodeToMp3(downloadedPath, mp3Path);
    return mp3Path;
  } catch (error) {
    safeUnlink(mp3Path);
    throw error;
  } finally {
    safeUnlink(downloadedPath);
  }
}

function getTranscribeApiPath(mode: TranscribeMode): string {
  if (mode === 'fast') return '/api/transcribe-fast';
  if (mode === 'standard') return '/api/transcribe';
  return '/api/transcribe-turbo';
}

function buildModeOrder(mode: TranscribeMode): TranscribeMode[] {
  const all: TranscribeMode[] = ['turbo', 'fast', 'standard'];
  const unique = [mode, ...all.filter((item) => item !== mode)];
  return unique;
}

function parseErrorCode(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const record = data as Record<string, unknown>;
  return typeof record.code === 'string' ? record.code : undefined;
}

function parseErrorMessage(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const record = data as Record<string, unknown>;
  if (typeof record.error === 'string') return record.error;
  return undefined;
}

function parseErrorDetail(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const record = data as Record<string, unknown>;
  if (typeof record.detail === 'string') return record.detail;
  return undefined;
}

async function transcribeWithFallback(
  request: NextRequest,
  audioFilePath: string,
  requestedMode: TranscribeMode,
  language: string,
  trace: ImportTraceEntry[]
): Promise<{ data: Record<string, unknown>; usedMode: TranscribeMode }> {
  const origin = getOriginFromRequest(request);
  const fileName = path.basename(audioFilePath);
  const openAsBlob = (fsp as unknown as { openAsBlob?: (path: string, options?: { type?: string }) => Promise<Blob> }).openAsBlob;
  const audioBlob = openAsBlob
    ? await openAsBlob(audioFilePath, { type: 'audio/mpeg' })
    : new Blob([await fsp.readFile(audioFilePath)], { type: 'audio/mpeg' });

  let lastFailure = 'unknown';

  for (const mode of buildModeOrder(requestedMode)) {
    const endpoint = `${origin}${getTranscribeApiPath(mode)}`;
    const formData = new FormData();
    formData.append('audio', new File([audioBlob], fileName, { type: 'audio/mpeg' }));
    formData.append('language', language);

    const response = await fetch(endpoint, {
      method: 'POST',
      body: formData,
    });

    const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    const isSuccess = response.ok && data?.success === true;

    if (isSuccess && data) {
      trace.push({ stage: `asr-${mode}`, ok: true });
      return { data, usedMode: mode };
    }

    const code = parseErrorCode(data) || `ASR_${mode.toUpperCase()}_FAILED`;
    const errorMessage = parseErrorMessage(data) || `转写失败 (${response.status})`;
    const detail = parseErrorDetail(data);
    trace.push({ stage: `asr-${mode}`, ok: false, code, detail: detail || errorMessage });
    lastFailure = `${code}: ${detail || errorMessage}`;
  }

  throw new ImportPipelineError('ASR_TRANSCRIBE_FAILED', '音频转写失败', lastFailure);
}

function normalizeMode(mode?: string): TranscribeMode {
  if (mode === 'fast' || mode === 'standard') return mode;
  return 'turbo';
}

function normalizeLanguage(language?: string): string {
  return language && language.trim() ? language.trim() : 'zh';
}

function isPipelineError(error: unknown): error is ImportPipelineError {
  return error instanceof ImportPipelineError;
}

function toPipelineError(error: unknown): ImportPipelineError {
  if (isPipelineError(error)) return error;

  if (error instanceof BilibiliImportError) {
    return new ImportPipelineError(error.code, error.message, error.detail);
  }

  if (error instanceof MediaToolError) {
    if (isToolNotFoundError(error, 'ffmpeg') || isToolNotFoundError(error, 'ffprobe')) {
      return new ImportPipelineError('FFMPEG_NOT_FOUND', '音频处理工具未安装', error.detail || error.message);
    }
    if (isToolNotFoundError(error, 'yt-dlp')) {
      return new ImportPipelineError('YTDLP_UNAVAILABLE', '下载器不可用', error.detail || error.message);
    }
    return new ImportPipelineError(error.code, '媒体处理失败', error.detail || error.message);
  }

  if (error instanceof Error) {
    return new ImportPipelineError('VIDEO_IMPORT_FAILED', '视频导入失败', error.message);
  }

  return new ImportPipelineError('VIDEO_IMPORT_FAILED', '视频导入失败');
}

function statusFromCode(code: string): number {
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

function buildStageOrder(
  provider: string,
  videoUrl: string,
  strategy: 'bili-native-first' | 'yt-dlp-first',
  enableYtDlpFallback: boolean
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

  if (isLikelyDirectMediaUrl(videoUrl)) {
    stages.push('direct-media');
  }

  if (enableYtDlpFallback || stages.length === 0) {
    stages.push('yt-dlp-fallback');
  }

  return stages;
}

function pickMostInformativeStageError(failures: StageFailure[]): ImportPipelineError | null {
  if (failures.length === 0) return null;

  const priorityCodes = [
    'FFMPEG_NOT_FOUND',
    'ASR_PUBLIC_HOST_MISSING',
    'ASR_API_KEY_MISSING',
    'BILI_COOKIE_EXPIRED',
    'BILI_AUDIO_DOWNLOAD_FORBIDDEN',
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

async function executeBiliNativeStage(videoUrl: string, baseName: string): Promise<StageResult> {
  const resolved = await resolveBilibiliUrl(videoUrl);
  const viewMeta = await fetchViewMeta(resolved.bvid, resolved.page);

  try {
    const subtitleResult = await fetchPlayerSubtitle(viewMeta.bvid, viewMeta.cid);
    if (subtitleResult?.segments?.length) {
      return {
        sourceMode: 'bili-subtitle',
        subtitleSegments: subtitleResult.segments,
        meta: {
          title: viewMeta.title,
          durationSec: viewMeta.durationSec,
          thumbnailUrl: viewMeta.thumbnailUrl,
          resolvedUrl: viewMeta.resolvedUrl,
          embedUrl: viewMeta.embedUrl,
          bvid: viewMeta.bvid,
          cid: viewMeta.cid,
        },
      };
    }
  } catch {
    // subtitle is optional and should not block import
  }

  const audioResult = await fetchPlayurlAudio(viewMeta.bvid, viewMeta.cid);
  const rawPath = resolveOutputPath(UPLOAD_DIR, `${baseName}_bili_raw`, audioResult.ext || '.m4s');
  const mp3Path = resolveOutputPath(UPLOAD_DIR, baseName, '.mp3');

  try {
    await downloadBiliAudio(audioResult.audioUrl, rawPath);
    await transcodeToMp3(rawPath, mp3Path);

    return {
      sourceMode: 'bili-native',
      audioFilePath: mp3Path,
      meta: {
        title: viewMeta.title,
        durationSec: viewMeta.durationSec,
        thumbnailUrl: viewMeta.thumbnailUrl,
        resolvedUrl: viewMeta.resolvedUrl,
        embedUrl: viewMeta.embedUrl,
        bvid: viewMeta.bvid,
        cid: viewMeta.cid,
      },
    };
  } catch (error) {
    safeUnlink(mp3Path);
    throw error;
  } finally {
    safeUnlink(rawPath);
  }
}

async function executeYtDlpStage(videoUrl: string, baseName: string, provider: string): Promise<StageResult> {
  const available = await hasYtDlp();
  if (!available) {
    throw new ImportPipelineError('YTDLP_UNAVAILABLE', '当前环境未安装 yt-dlp');
  }

  const downloaded = await downloadAudioByYtDlp(videoUrl, baseName, {
    bilibiliHeaders: provider === 'bilibili',
  });

  return {
    sourceMode: 'yt-dlp',
    audioFilePath: downloaded.audioPath,
    meta: downloaded.meta,
  };
}

async function executeDirectStage(videoUrl: string, baseName: string): Promise<StageResult> {
  if (!isLikelyDirectMediaUrl(videoUrl)) {
    throw new ImportPipelineError('DIRECT_MEDIA_NOT_SUPPORTED', '当前链接不是直链媒体地址');
  }

  const audioFilePath = await prepareAudioFromDirectUrl(videoUrl, baseName);
  return {
    sourceMode: 'direct',
    audioFilePath,
    meta: {
      resolvedUrl: videoUrl,
    },
  };
}

function mapSubtitleSegmentsToApiSegments(
  segments: Array<{ text: string; startMs: number; endMs: number }>
): Array<{ id: string; text: string; startMs: number; endMs: number; confidence: number; isFinal: boolean }> {
  return segments.map((item, index) => ({
    id: `seg-${index}`,
    text: normalizePossibleMojibake(item.text),
    startMs: item.startMs,
    endMs: item.endMs,
    confidence: 0.99,
    isFinal: true,
  }));
}

function buildWsProxyUrl(request: NextRequest): string {
  const host =
    request.headers.get('x-forwarded-host') ||
    request.headers.get('host') ||
    request.nextUrl.host ||
    'localhost:3001';
  const protocol =
    request.headers.get('x-forwarded-proto') ||
    request.nextUrl.protocol.replace(':', '') ||
    'http';
  const wsProtocol = protocol === 'https' ? 'wss' : 'ws';
  return `${wsProtocol}://${host}/api/asr-stream`;
}

function normalizeWsSegments(
  wsSentences: WsResultSentence[]
): Array<{ id: string; text: string; startMs: number; endMs: number; confidence: number; isFinal: boolean }> {
  const ordered = [...wsSentences]
    .filter((item) => typeof item.text === 'string' && item.text.trim())
    .sort((a, b) => {
      const left = Number.isFinite(a.beginTime) ? Number(a.beginTime) : Number.MAX_SAFE_INTEGER;
      const right = Number.isFinite(b.beginTime) ? Number(b.beginTime) : Number.MAX_SAFE_INTEGER;
      return left - right;
    });

  let cursor = 0;
  return ordered.map((item, index) => {
    const text = normalizePossibleMojibake(String(item.text || '').trim());
    const begin = Number.isFinite(item.beginTime) ? Math.max(0, Number(item.beginTime)) : cursor;
    const fallbackDuration = Math.max(500, Math.min(5000, text.length * 120));
    let end = Number.isFinite(item.endTime) ? Number(item.endTime) : begin + fallbackDuration;
    if (end <= begin) end = begin + fallbackDuration;
    cursor = end;

    return {
      id: item.id || `seg-${index}`,
      text,
      startMs: begin,
      endMs: end,
      confidence: Number.isFinite(item.confidence) ? Number(item.confidence) : 0.92,
      isFinal: item.isFinal !== false,
    };
  });
}

async function transcribeWithWsProxy(
  request: NextRequest,
  audioFilePath: string
): Promise<Record<string, unknown>> {
  const ffmpegPath = resolveFfmpegPath();
  const baseName = path.basename(audioFilePath, path.extname(audioFilePath));
  const pcmPath = resolveOutputPath(UPLOAD_DIR, `${baseName}_ws`, '.pcm');

  await runCommand(
    ffmpegPath,
    [
      '-y',
      '-i',
      audioFilePath,
      '-f',
      's16le',
      '-acodec',
      'pcm_s16le',
      '-ac',
      '1',
      '-ar',
      '16000',
      pcmPath,
    ],
    { toolName: 'ffmpeg' }
  );

  let pcmBuffer: Buffer;
  try {
    pcmBuffer = await fsp.readFile(pcmPath);
  } finally {
    safeUnlink(pcmPath);
  }

  if (!pcmBuffer || pcmBuffer.length === 0) {
    throw new ImportPipelineError('ASR_WS_FALLBACK_FAILED', '转写失败', 'PCM 数据为空');
  }

  const wsUrl = buildWsProxyUrl(request);
  const chunkSize = 3200;
  const timeoutMs = 240000;

  const wsSentences = await new Promise<WsResultSentence[]>((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const collected: WsResultSentence[] = [];
    let settled = false;
    let ready = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {
        // ignore close errors
      }
      reject(new ImportPipelineError('ASR_WS_FALLBACK_FAILED', '转写超时', 'WS proxy timeout'));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
    };

    const fail = (detail: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new ImportPipelineError('ASR_WS_FALLBACK_FAILED', '转写失败', detail));
    };

    const succeed = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(collected);
    };

    const sendChunks = () => {
      let offset = 0;
      const sendNext = () => {
        if (settled || ws.readyState !== WebSocket.OPEN) return;
        if (offset >= pcmBuffer.length) {
          ws.send(JSON.stringify({ action: 'stop' }));
          return;
        }

        const end = Math.min(offset + chunkSize, pcmBuffer.length);
        const chunk = pcmBuffer.subarray(offset, end);

        try {
          ws.send(chunk);
          offset = end;
          if (ws.bufferedAmount > chunkSize * 40) {
            setTimeout(sendNext, 5);
          } else {
            setImmediate(sendNext);
          }
        } catch (error) {
          fail(error instanceof Error ? `发送音频分片失败: ${error.message}` : '发送音频分片失败');
        }
      };
      sendNext();
    };

    ws.onmessage = (event) => {
      if (settled) return;

      try {
        const rawText =
          typeof event.data === 'string'
            ? event.data
            : Buffer.from(event.data as ArrayBuffer).toString('utf8');
        const payload = JSON.parse(rawText) as {
          event?: string;
          error?: string;
          sentence?: WsResultSentence;
        };

        if (payload.event === 'ready') {
          ready = true;
          sendChunks();
          return;
        }

        if (payload.event === 'result' && payload.sentence?.text) {
          collected.push(payload.sentence);
          return;
        }

        if (payload.event === 'error') {
          fail(payload.error || 'WS proxy returned error');
          return;
        }

        if ((payload.event === 'finished' || payload.event === 'closed') && ready) {
          if (collected.length > 0) {
            succeed();
          } else {
            fail('WS proxy finished without transcript');
          }
        }
      } catch (error) {
        fail(error instanceof Error ? error.message : 'WS 消息解析失败');
      }
    };

    ws.onerror = () => {
      fail('WS 连接失败');
    };

    ws.onclose = () => {
      if (settled) return;
      if (collected.length > 0) {
        succeed();
      } else {
        fail('WS proxy closed before transcript ready');
      }
    };
  });

  const segments = normalizeWsSegments(wsSentences);
  if (segments.length === 0) {
    throw new ImportPipelineError('ASR_WS_FALLBACK_FAILED', '转写失败', 'WS fallback produced empty transcript');
  }

  const text = segments.map((item) => item.text).join('');
  const totalDuration = segments[segments.length - 1].endMs;

  return {
    success: true,
    text: normalizePossibleMojibake(text),
    totalDuration,
    segments,
    sentences: segments.map((item) => ({
      id: item.id,
      text: item.text,
      beginTime: item.startMs,
      endTime: item.endMs,
      confidence: item.confidence,
    })),
  };
}

function isLikelyMojibake(text: string): boolean {
  if (!text) return false;
  return /(Ã.|Â.|å.|æ.|ç.|ï¼|ð|ñ|Ñ|Ð)/.test(text);
}

function textScoreForChineseReadability(text: string): number {
  const cjkCount = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const mojibakeCount = (text.match(/[ÃÂåæçï¼ðñÑÐ]/g) || []).length;
  const replacementCount = (text.match(/\uFFFD/g) || []).length;
  return cjkCount * 2 - mojibakeCount * 2 - replacementCount * 4;
}

function normalizePossibleMojibake(input: string): string {
  if (!input || !isLikelyMojibake(input)) return input;
  const candidate = Buffer.from(input, 'latin1').toString('utf8');
  if (!candidate || candidate === input) return input;

  const beforeScore = textScoreForChineseReadability(input);
  const afterScore = textScoreForChineseReadability(candidate);
  return afterScore > beforeScore ? candidate : input;
}

function normalizeVideoMeta(meta: VideoImportMeta): VideoImportMeta {
  return {
    ...meta,
    title: meta.title ? normalizePossibleMojibake(meta.title) : meta.title,
  };
}

function normalizeTranscribePayload(data: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...data };

  if (typeof normalized.text === 'string') {
    normalized.text = normalizePossibleMojibake(normalized.text);
  }

  if (Array.isArray(normalized.segments)) {
    normalized.segments = normalized.segments.map((item) => {
      if (!item || typeof item !== 'object') return item;
      const entry = { ...(item as Record<string, unknown>) };
      if (typeof entry.text === 'string') {
        entry.text = normalizePossibleMojibake(entry.text);
      }
      return entry;
    });
  }

  if (Array.isArray(normalized.sentences)) {
    normalized.sentences = normalized.sentences.map((item) => {
      if (!item || typeof item !== 'object') return item;
      const entry = { ...(item as Record<string, unknown>) };
      if (typeof entry.text === 'string') {
        entry.text = normalizePossibleMojibake(entry.text);
      }
      return entry;
    });
  }

  return normalized;
}

function normalizedTextKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s，。！？!?；;：:、“”"'‘’\-—_]/g, '')
    .trim();
}

function parseSegmentsFromPayload(data: Record<string, unknown>): NormalizedSegment[] {
  const rawSegments = Array.isArray(data.segments)
    ? data.segments
    : Array.isArray(data.sentences)
      ? data.sentences
      : [];

  const parsed: NormalizedSegment[] = [];
  for (let index = 0; index < rawSegments.length; index += 1) {
    const item = rawSegments[index];
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    const text = normalizePossibleMojibake(String(entry.text || '')).trim();
    if (!text) continue;

    const startCandidates = [entry.startMs, entry.beginTime, entry.start_time];
    const endCandidates = [entry.endMs, entry.endTime, entry.end_time];

    let startMs = 0;
    let endMs = 0;
    for (const value of startCandidates) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        startMs = Math.max(0, Math.round(value));
        break;
      }
    }
    for (const value of endCandidates) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        endMs = Math.max(0, Math.round(value));
        break;
      }
    }

    parsed.push({
      id: typeof entry.id === 'string' ? entry.id : `seg-${index}`,
      text,
      startMs,
      endMs,
      confidence: typeof entry.confidence === 'number' && Number.isFinite(entry.confidence)
        ? entry.confidence
        : 0.92,
      isFinal: entry.isFinal !== false,
    });
  }

  return parsed;
}

function deduplicateAdjacentSegments(segments: NormalizedSegment[]): NormalizedSegment[] {
  if (segments.length <= 1) return segments;
  const deduped: NormalizedSegment[] = [segments[0]];

  for (let index = 1; index < segments.length; index += 1) {
    const current = segments[index];
    const prev = deduped[deduped.length - 1];
    const currentKey = normalizedTextKey(current.text);
    const prevKey = normalizedTextKey(prev.text);

    const isDup = currentKey.length > 0 && currentKey === prevKey;
    if (isDup) {
      prev.endMs = Math.max(prev.endMs, current.endMs);
      prev.confidence = Math.max(prev.confidence, current.confidence);
      continue;
    }

    deduped.push(current);
  }

  return deduped;
}

function hasUsableTimeline(segments: NormalizedSegment[]): boolean {
  if (segments.length === 0) return false;
  return segments.some((segment) => segment.endMs > segment.startMs && segment.endMs > 0);
}

function rebuildTimelineByLength(
  segments: NormalizedSegment[],
  targetDurationMs: number
): NormalizedSegment[] {
  const safeTarget = Math.max(1000, targetDurationMs);
  const totalWeight = segments.reduce((sum, segment) => sum + Math.max(1, segment.text.length), 0);
  let cursor = 0;

  return segments.map((segment, index) => {
    const weight = Math.max(1, segment.text.length);
    const duration = Math.max(300, Math.round((safeTarget * weight) / Math.max(1, totalWeight)));
    const startMs = cursor;
    let endMs = startMs + duration;
    if (index === segments.length - 1) {
      endMs = safeTarget;
    } else if (endMs >= safeTarget) {
      endMs = Math.max(startMs + 300, safeTarget - (segments.length - index - 1) * 300);
    }

    cursor = endMs;
    return {
      ...segment,
      startMs,
      endMs,
    };
  });
}

function scaleTimeline(segments: NormalizedSegment[], targetDurationMs: number): NormalizedSegment[] {
  const lastEnd = segments[segments.length - 1]?.endMs || 0;
  if (lastEnd <= 0) return segments;
  const ratio = targetDurationMs / lastEnd;
  return segments.map((segment) => ({
    ...segment,
    startMs: Math.max(0, Math.round(segment.startMs * ratio)),
    endMs: Math.max(0, Math.round(segment.endMs * ratio)),
  }));
}

function normalizeImportedSegments(
  data: Record<string, unknown>,
  sourceDurationSec?: number
): NormalizedSegment[] {
  let segments = deduplicateAdjacentSegments(parseSegmentsFromPayload(data));
  if (segments.length === 0) return [];

  const declaredDurationMs =
    Number.isFinite(sourceDurationSec) && (sourceDurationSec || 0) > 0
      ? Math.round((sourceDurationSec as number) * 1000)
      : 0;
  const rawLastEnd = segments[segments.length - 1]?.endMs || 0;

  if (!hasUsableTimeline(segments)) {
    const estimatedChars = segments.reduce((sum, segment) => sum + segment.text.length, 0);
    const target = declaredDurationMs > 0 ? declaredDurationMs : Math.max(5000, estimatedChars * 140);
    segments = rebuildTimelineByLength(segments, target);
    return segments.map((segment, index) => ({ ...segment, id: `seg-${index}` }));
  }

  // 时间轴明显压缩时（典型 WS fallback），按原视频时长拉伸
  if (declaredDurationMs > 0) {
    const tooShort = rawLastEnd > 0 && rawLastEnd < declaredDurationMs * 0.55;
    const tooLong = rawLastEnd > declaredDurationMs * 1.8;
    if (tooShort || tooLong) {
      segments = scaleTimeline(segments, declaredDurationMs);
    }
  }

  // 二次修正，确保严格递增且 end > start
  let cursor = 0;
  segments = segments.map((segment) => {
    const startMs = Math.max(cursor, segment.startMs);
    const endMs = Math.max(startMs + 200, segment.endMs);
    cursor = endMs;
    return {
      ...segment,
      startMs,
      endMs,
    };
  });

  return segments.map((segment, index) => ({ ...segment, id: `seg-${index}` }));
}

export async function POST(request: NextRequest) {
  const rateLimitResponse = await applyRateLimit(request, 'transcribe');
  if (rateLimitResponse) return rateLimitResponse;

  const trace: ImportTraceEntry[] = [];

  try {
    ensureUploadDir();
    scheduleCleanupOldFiles();

    const body = (await request.json()) as ImportRequestBody;
    const videoUrl = body.url?.trim() || '';
    const mode = normalizeMode(body.mode);
    const language = normalizeLanguage(body.language);

    if (!videoUrl) {
      throw new ImportPipelineError('MISSING_VIDEO_URL', '缺少视频链接');
    }

    if (isUnsafeVideoUrl(videoUrl)) {
      throw new ImportPipelineError('VIDEO_URL_UNSAFE', '不允许访问该视频地址');
    }

    const parsed = parseVideoLink(videoUrl);
    if (!parsed) {
      throw new ImportPipelineError('INVALID_VIDEO_URL', '无法识别的视频链接');
    }

    const strategy = process.env.VIDEO_IMPORT_STRATEGY === 'yt-dlp-first' ? 'yt-dlp-first' : 'bili-native-first';
    const enableYtDlpFallback = process.env.VIDEO_IMPORT_ENABLE_YTDLP_FALLBACK !== 'false';
    const stageOrder = buildStageOrder(parsed.provider, videoUrl, strategy, enableYtDlpFallback);

    const baseName = `video_import_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let stageResult: StageResult | null = null;
    let lastError: ImportPipelineError | null = null;
    const stageFailures: StageFailure[] = [];

    for (const stage of stageOrder) {
      try {
        if (stage === 'bili-native') {
          stageResult = await executeBiliNativeStage(videoUrl, baseName);
        } else if (stage === 'yt-dlp-fallback') {
          stageResult = await executeYtDlpStage(videoUrl, baseName, parsed.provider);
        } else {
          stageResult = await executeDirectStage(videoUrl, baseName);
        }

        trace.push({ stage, ok: true });
        break;
      } catch (error) {
        const stageError = toPipelineError(error);
        lastError = stageError;
        stageFailures.push({ stage, error: stageError });
        trace.push({
          stage,
          ok: false,
          code: stageError.code,
          detail: stageError.detail || stageError.message,
        });
      }
    }

    if (!stageResult) {
      throw (
        pickMostInformativeStageError(stageFailures) ||
        lastError ||
        new ImportPipelineError('VIDEO_IMPORT_FAILED', '视频导入失败')
      );
    }

    stageResult.meta = normalizeVideoMeta(stageResult.meta);
    const resolvedParsed = parseVideoLink(stageResult.meta.resolvedUrl || videoUrl) || parsed;
    const source = {
      provider: resolvedParsed.provider,
      providerLabel: resolvedParsed.providerLabel,
      originalUrl: videoUrl,
      resolvedUrl: stageResult.meta.resolvedUrl || videoUrl,
      embedUrl: stageResult.meta.embedUrl || resolvedParsed.embedUrl,
      playableUrl: resolvedParsed.playableUrl || stageResult.meta.resolvedUrl || videoUrl,
      title: stageResult.meta.title,
      durationSec: stageResult.meta.durationSec,
      thumbnailUrl: stageResult.meta.thumbnailUrl,
      bvid: stageResult.meta.bvid,
      cid: stageResult.meta.cid,
      sourceMode: stageResult.sourceMode,
    };

    if (stageResult.subtitleSegments?.length) {
      const mappedSegments = mapSubtitleSegmentsToApiSegments(stageResult.subtitleSegments);
      const totalDuration = mappedSegments.length > 0 ? mappedSegments[mappedSegments.length - 1].endMs : 0;
      const text = normalizePossibleMojibake(mappedSegments.map((item) => item.text).join(''));

      return NextResponse.json({
        success: true,
        mode: 'subtitle',
        requestedMode: mode,
        language,
        sourceMode: stageResult.sourceMode,
        source,
        text,
        totalDuration,
        segments: mappedSegments,
        sentences: mappedSegments.map((item) => ({
          id: item.id,
          text: item.text,
          beginTime: item.startMs,
          endTime: item.endMs,
          confidence: item.confidence,
        })),
        trace,
      });
    }

    if (!stageResult.audioFilePath) {
      throw new ImportPipelineError('VIDEO_IMPORT_FAILED', '未生成可用音频文件');
    }

    let transcribed: { data: Record<string, unknown>; usedMode: TranscribeMode };

    try {
      transcribed = await transcribeWithFallback(request, stageResult.audioFilePath, mode, language, trace);
    } catch (error) {
      const importError = toPipelineError(error);
      const enableWsFallback = process.env.VIDEO_IMPORT_ENABLE_WS_FALLBACK !== 'false';
      const shouldTryWsFallback = enableWsFallback && importError.code === 'ASR_TRANSCRIBE_FAILED';

      if (!shouldTryWsFallback) {
        throw importError;
      }

      try {
        const wsData = await transcribeWithWsProxy(request, stageResult.audioFilePath);
        trace.push({ stage: 'asr-ws-fallback', ok: true });
        transcribed = { data: wsData, usedMode: mode };
      } catch (wsError) {
        const wsPipelineError = toPipelineError(wsError);
        trace.push({
          stage: 'asr-ws-fallback',
          ok: false,
          code: wsPipelineError.code,
          detail: wsPipelineError.detail || wsPipelineError.message,
        });

        throw new ImportPipelineError(
          importError.code,
          importError.message,
          [importError.detail || importError.message, `ws fallback: ${wsPipelineError.detail || wsPipelineError.message}`]
            .filter(Boolean)
            .join(' | ')
        );
      }
    }

    const mergedSource = {
      ...source,
      audioUrl: getPublicAudioUrl(request, stageResult.audioFilePath),
      title: source.title ? normalizePossibleMojibake(source.title) : source.title,
    };
    const normalizedTranscribedData = normalizeTranscribePayload(transcribed.data);
    const normalizedSegments = normalizeImportedSegments(normalizedTranscribedData, stageResult.meta.durationSec);
    if (normalizedSegments.length === 0) {
      throw new ImportPipelineError('ASR_TRANSCRIBE_FAILED', '音频转写失败', 'transcribe returned no valid segments');
    }
    const normalizedText = normalizedSegments.map((segment) => segment.text).join('');
    const normalizedTotalDuration = normalizedSegments[normalizedSegments.length - 1].endMs;

    return NextResponse.json({
      ...normalizedTranscribedData,
      success: true,
      mode: transcribed.usedMode,
      requestedMode: mode,
      language,
      sourceMode: stageResult.sourceMode,
      source: mergedSource,
      text: normalizedText,
      totalDuration: normalizedTotalDuration,
      segments: normalizedSegments,
      sentences: normalizedSegments.map((segment) => ({
        id: segment.id,
        text: segment.text,
        beginTime: segment.startMs,
        endTime: segment.endMs,
        confidence: segment.confidence,
      })),
      trace,
    });
  } catch (error) {
    const importError = toPipelineError(error);
    return NextResponse.json(
      {
        error: importError.message,
        code: importError.code,
        detail: importError.detail,
        trace,
      },
      { status: statusFromCode(importError.code) }
    );
  }
}





