import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import type { ReadableStream as WebReadableStream } from 'stream/web';
import { WebSocket } from 'undici';
import { parseVideoLink, isLikelyDirectMediaUrl } from '@/lib/utils/video-link';
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
  resolveFfprobePath,
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
const MIN_DURATION_FOR_COMPLETENESS_CHECK_SEC = 60;
const MIN_TEXT_CHARS_PER_SEC = 1;
const MIN_TEXT_COVERAGE_RATIO = 0.45;
const MIN_TIMELINE_COVERAGE_SHORT = 0.6;
const MIN_TIMELINE_COVERAGE_LONG = 0.7;
const TIMELINE_SCALE_RATIO_MIN = 0.65;
const TIMELINE_SCALE_RATIO_MAX = 1.35;
const PCM_BYTES_PER_SEC = 16000 * 2;
const WS_CHUNK_PCM_BYTES = Number.parseInt(
  process.env.VIDEO_IMPORT_WS_CHUNK_PCM_BYTES || `${10 * 1024 * 1024}`,
  10
);

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
  biliCookie?: string;
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

function toFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readSegmentEndMs(entry: Record<string, unknown>): number {
  const endCandidates = [entry.endMs, entry.endTime, entry.end_time];
  for (const value of endCandidates) {
    const parsed = toFiniteNumber(value);
    if (parsed !== null) return Math.max(0, Math.round(parsed));
  }
  return 0;
}

function summarizeAsrResult(data: Record<string, unknown>): { segCount: number; textLen: number; lastEndMs: number } {
  const rawSegments = Array.isArray(data.segments)
    ? data.segments
    : Array.isArray(data.sentences)
      ? data.sentences
      : [];
  const segments = rawSegments.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object');
  const textLenFromData = typeof data.text === 'string' ? (data.text as string).length : 0;
  const textLenFromSegments = segments.reduce((sum, segment) => {
    const text = typeof segment.text === 'string' ? segment.text.trim() : '';
    return sum + text.length;
  }, 0);
  const textLen = Math.max(textLenFromData, textLenFromSegments);
  const lastEndMs = segments.reduce((max, segment) => Math.max(max, readSegmentEndMs(segment)), 0);
  return {
    segCount: segments.length,
    textLen,
    lastEndMs,
  };
}

async function transcribeWithFallback(
  request: NextRequest,
  audioFilePath: string,
  requestedMode: TranscribeMode,
  language: string,
  trace: ImportTraceEntry[],
  expectedDurationSec?: number
): Promise<{ data: Record<string, unknown>; usedMode: TranscribeMode }> {
  const origin = getOriginFromRequest(request);
  const fileName = path.basename(audioFilePath);

  // Log the audio file size being sent to ASR
  const audioFileSize = await getFileSizeBytes(audioFilePath);
  console.log(`[video-import] transcribeWithFallback: file=${fileName}, size=${audioFileSize} bytes (${(audioFileSize / 1024).toFixed(1)} KB), modes=${buildModeOrder(requestedMode).join(',')}, expectedDuration=${expectedDurationSec ?? 'unknown'}s`);

  const openAsBlob = (fsp as unknown as { openAsBlob?: (path: string, options?: { type?: string }) => Promise<Blob> }).openAsBlob;
  const audioBlob = openAsBlob
    ? await openAsBlob(audioFilePath, { type: 'audio/mpeg' })
    : new Blob([await fsp.readFile(audioFilePath)], { type: 'audio/mpeg' });

  let lastFailure = 'unknown';
  let bestPartialResult: { data: Record<string, unknown>; usedMode: TranscribeMode } | null = null;

  for (const mode of buildModeOrder(requestedMode)) {
    const endpoint = `${origin}${getTranscribeApiPath(mode)}`;
    console.log(`[video-import] trying ASR mode=${mode}, endpoint=${endpoint}`);
    const formData = new FormData();
    formData.append('audio', new File([audioBlob], fileName, { type: 'audio/mpeg' }));
    formData.append('language', language);

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        body: formData,
      });
    } catch (fetchError) {
      const detail = fetchError instanceof Error ? fetchError.message : String(fetchError);
      console.error(`[video-import] ASR mode=${mode} fetch error: ${detail}`);
      trace.push({ stage: `asr-${mode}`, ok: false, code: `ASR_${mode.toUpperCase()}_FETCH_ERROR`, detail });
      lastFailure = `ASR_${mode.toUpperCase()}_FETCH_ERROR: ${detail}`;
      continue;
    }

    const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    const isSuccess = response.ok && data?.success === true;

    if (isSuccess && data) {
      const { segCount, textLen, lastEndMs } = summarizeAsrResult(data);
      const expectedDurationMs =
        Number.isFinite(expectedDurationSec) && (expectedDurationSec || 0) > 0
          ? Math.round((expectedDurationSec as number) * 1000)
          : 0;
      const timelineCoverage = expectedDurationMs > 0 && lastEndMs > 0 ? lastEndMs / expectedDurationMs : null;
      console.log(
        `[video-import] ASR mode=${mode} success: ${segCount} segments, ${textLen} chars, lastEndMs=${lastEndMs}, timelineCoverage=${timelineCoverage === null ? 'n/a' : timelineCoverage.toFixed(2)}`
      );

      const minTimelineCoverage =
        expectedDurationSec && expectedDurationSec > 120
          ? MIN_TIMELINE_COVERAGE_LONG
          : MIN_TIMELINE_COVERAGE_SHORT;
      const isTextInsufficient =
        expectedDurationSec &&
        expectedDurationSec > MIN_DURATION_FOR_COMPLETENESS_CHECK_SEC &&
        textLen > 0 &&
        textLen < expectedDurationSec * MIN_TEXT_CHARS_PER_SEC * MIN_TEXT_COVERAGE_RATIO;
      const isTimelineInsufficient =
        expectedDurationSec &&
        expectedDurationSec > MIN_DURATION_FOR_COMPLETENESS_CHECK_SEC &&
        timelineCoverage !== null &&
        timelineCoverage < minTimelineCoverage;
      const isResultInsufficient = Boolean(isTextInsufficient || isTimelineInsufficient);

      if (isResultInsufficient) {
        const expectedMin = Math.round((expectedDurationSec || 0) * MIN_TEXT_CHARS_PER_SEC * MIN_TEXT_COVERAGE_RATIO);
        const timelineDetail =
          timelineCoverage === null
            ? 'timelineCoverage=n/a'
            : `timelineCoverage=${timelineCoverage.toFixed(2)} (need >=${minTimelineCoverage})`;
        console.warn(
          `[video-import] ASR mode=${mode} result insufficient: ${textLen} chars for ${expectedDurationSec}s video (expected >=${expectedMin} chars), ${timelineDetail}; trying next mode`
        );
        trace.push({
          stage: `asr-${mode}`,
          ok: false,
          code: 'ASR_RESULT_INSUFFICIENT',
          detail: `${segCount} segments, ${textLen} chars, ${timelineDetail}`,
        });
        if (!bestPartialResult || textLen > (typeof bestPartialResult.data.text === 'string' ? (bestPartialResult.data.text as string).length : 0)) {
          bestPartialResult = { data, usedMode: mode };
        }
        lastFailure = `ASR_RESULT_INSUFFICIENT: ${textLen} chars, ${timelineDetail} for ${expectedDurationSec}s video`;
        continue;
      }

      trace.push({ stage: `asr-${mode}`, ok: true, detail: `${segCount} segments, ${textLen} chars` });
      return { data, usedMode: mode };
    }

    const code = parseErrorCode(data) || `ASR_${mode.toUpperCase()}_FAILED`;
    const errorMessage = parseErrorMessage(data) || `转写失败 (${response.status})`;
    const detail = parseErrorDetail(data);
    console.error(`[video-import] ASR mode=${mode} failed: ${code} - ${detail || errorMessage}`);
    trace.push({ stage: `asr-${mode}`, ok: false, code, detail: detail || errorMessage });
    lastFailure = `${code}: ${detail || errorMessage}`;
  }

  // 所有HTTP模式结果都不足时，抛出异常让调用方有机会尝试 WS fallback
  // 把 bestPartialResult 附到异常上，WS fallback 也失败时可以降级使用
  if (bestPartialResult) {
    console.warn(`[video-import] all ASR modes produced insufficient results, throwing to trigger WS fallback (best partial mode=${bestPartialResult.usedMode})`);
    const err = new ImportPipelineError('ASR_TRANSCRIBE_FAILED', '音频转写失败', lastFailure);
    (err as ImportPipelineError & { partialResult?: typeof bestPartialResult }).partialResult = bestPartialResult;
    throw err;
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
    // ffmpeg 被 OOM kill 时 code=null，给出更明确的提示
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

async function getFileSizeBytes(filePath: string): Promise<number> {
  try {
    const stat = await fsp.stat(filePath);
    return stat.size;
  } catch {
    return 0;
  }
}

async function getAudioDurationSec(filePath: string): Promise<number> {
  try {
    const ffmpegPath = resolveFfmpegPath();
    const ffprobePath = resolveFfprobePath(ffmpegPath);
    const result = await runCommand(
      ffprobePath,
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
      { toolName: 'ffprobe' }
    );
    return Number.parseFloat(result.stdout.trim()) || 0;
  } catch {
    return 0;
  }
}

const BILI_MIN_AUDIO_BYTES = 10 * 1024; // 10 KB – smaller than this is certainly broken
const BILI_MIN_AUDIO_DURATION_RATIO = 0.25; // mp3 duration must be ≥ 25 % of declared video duration
const BILI_MIN_PARTIAL_AUDIO_SEC = 60; // 如果已下载音频 >= 60s，即使不到 25% 也允许部分转录

async function executeBiliNativeStage(videoUrl: string, baseName: string, userCookie?: string): Promise<StageResult> {
  // 用户 Cookie 优先，其次 .env 全局 Cookie
  const effectiveCookie = userCookie || process.env.BILIBILI_COOKIE || '';
  const resolved = await resolveBilibiliUrl(videoUrl);
  const viewMeta = await fetchViewMeta(resolved.bvid, resolved.page);

  try {
    const subtitleResult = await fetchPlayerSubtitle(viewMeta.bvid, viewMeta.cid);
    // 字幕兜底策略：必须满足最低段数与时间覆盖，避免概述型字幕被误当完整转录。
    const MIN_SUBTITLE_SEGMENTS = 4;
    const durationBasedMin = viewMeta.durationSec && viewMeta.durationSec > 60
      ? Math.max(6, Math.floor(viewMeta.durationSec / 18))
      : MIN_SUBTITLE_SEGMENTS;

    const subtitleCount = subtitleResult?.segments?.length || 0;
    const subtitleSpanMs = subtitleCount > 0
      ? Math.max(0, subtitleResult!.segments[subtitleCount - 1].endMs - subtitleResult!.segments[0].startMs)
      : 0;
    const declaredDurationMs = viewMeta.durationSec ? Math.round(viewMeta.durationSec * 1000) : 0;
    const subtitleCoverage = declaredDurationMs > 0 ? subtitleSpanMs / declaredDurationMs : 1;
    const minCoverage = viewMeta.durationSec && viewMeta.durationSec > 120 ? 0.7 : 0.55;

    const subtitleUsable =
      declaredDurationMs > 0 &&
      subtitleCount >= durationBasedMin &&
      subtitleCoverage >= minCoverage;

    if (subtitleResult?.segments?.length && subtitleUsable) {
      console.log(
        `[video-import] bili subtitle accepted: count=${subtitleCount}, min=${durationBasedMin}, coverage=${subtitleCoverage.toFixed(2)}`
      );
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
    if (subtitleResult?.segments?.length) {
      console.log(
        `[video-import] bili subtitle rejected: count=${subtitleCount} (need >=${durationBasedMin}), coverage=${subtitleCoverage.toFixed(2)} (need >=${minCoverage}) for ${viewMeta.durationSec}s video, falling back to audio`
      );
    }
  } catch {
    // subtitle is optional and should not block import
  }

  const audioResult = await fetchPlayurlAudio(viewMeta.bvid, viewMeta.cid);
  const rawPath = resolveOutputPath(UPLOAD_DIR, `${baseName}_bili_raw`, audioResult.ext || '.m4s');
  const mp3Path = resolveOutputPath(UPLOAD_DIR, baseName, '.mp3');

  try {
    await downloadBiliAudio(audioResult.audioUrl, rawPath, { cookie: effectiveCookie || undefined });

    // 检查原始下载文件的大小
    const rawSize = await getFileSizeBytes(rawPath);
    console.log(`[video-import] bili audio downloaded: ${rawSize} bytes (${(rawSize / 1024).toFixed(1)} KB), mode=${audioResult.mode}`);
    if (rawSize < BILI_MIN_AUDIO_BYTES) {
      throw new ImportPipelineError(
        'BILI_AUDIO_INCOMPLETE',
        'B站音频下载不完整',
        `downloaded ${rawSize} bytes, minimum ${BILI_MIN_AUDIO_BYTES} bytes required`
      );
    }

    await transcodeToMp3(rawPath, mp3Path);

    // 检查转码后 mp3 的时长是否合理
    const mp3Size = await getFileSizeBytes(mp3Path);
    const mp3Duration = await getAudioDurationSec(mp3Path);
    console.log(`[video-import] bili mp3 ready: ${mp3Size} bytes (${(mp3Size / 1024).toFixed(1)} KB), duration=${mp3Duration.toFixed(1)}s, declared video duration=${viewMeta.durationSec}s`);

    if (viewMeta.durationSec && viewMeta.durationSec > 30 && mp3Duration > 0) {
      const ratio = mp3Duration / viewMeta.durationSec;
      if (ratio < BILI_MIN_AUDIO_DURATION_RATIO) {
        // 长视频部分下载：如果已下载音频 >= 60s，则允许部分转录而不报错
        if (mp3Duration >= BILI_MIN_PARTIAL_AUDIO_SEC) {
          console.log(
            `[video-import] bili audio partial: ${mp3Duration.toFixed(1)}s / ${viewMeta.durationSec}s (${(ratio * 100).toFixed(0)}%), allowing partial transcription`
          );
        } else {
          throw new ImportPipelineError(
            'BILI_AUDIO_INCOMPLETE',
            'B站音频下载不完整',
            `mp3 duration ${mp3Duration.toFixed(1)}s is only ${(ratio * 100).toFixed(0)}% of video ${viewMeta.durationSec}s (min ${(BILI_MIN_AUDIO_DURATION_RATIO * 100).toFixed(0)}%)`
          );
        }
      }
    }

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

function estimatePcmDurationMs(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  return Math.round((bytes / PCM_BYTES_PER_SEC) * 1000);
}

async function transcribeWsChunk(
  wsUrl: string,
  pcmBuffer: Buffer,
  baseOffsetMs: number
): Promise<WsResultSentence[]> {
  const chunkSize = 3200;
  const timeoutMs = 240000;

  return new Promise<WsResultSentence[]>((resolve, reject) => {
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
          const sentence = payload.sentence;
          const begin = Number.isFinite(sentence.beginTime) ? Number(sentence.beginTime) + baseOffsetMs : undefined;
          const end = Number.isFinite(sentence.endTime) ? Number(sentence.endTime) + baseOffsetMs : undefined;
          collected.push({
            ...sentence,
            beginTime: begin,
            endTime: end,
          });
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
            // DashScope 可能还在处理最后的音频片段，等待一段时间后再判定
            setTimeout(() => {
              if (settled) return;
              if (collected.length > 0) {
                succeed();
              } else {
                fail('WS proxy finished without transcript');
              }
            }, 3000);
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
  const safeChunkBytes = Number.isFinite(WS_CHUNK_PCM_BYTES)
    ? Math.max(1 * 1024 * 1024, Math.min(24 * 1024 * 1024, WS_CHUNK_PCM_BYTES))
    : 10 * 1024 * 1024;
  const wsSentences: WsResultSentence[] = [];
  let offsetBytes = 0;

  while (offsetBytes < pcmBuffer.length) {
    const end = Math.min(offsetBytes + safeChunkBytes, pcmBuffer.length);
    const chunk = pcmBuffer.subarray(offsetBytes, end);
    const chunkOffsetMs = estimatePcmDurationMs(offsetBytes);
    const partSentences = await transcribeWsChunk(wsUrl, chunk, chunkOffsetMs);
    wsSentences.push(...partSentences);
    offsetBytes = end;
  }

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

/**
 * 将过长的单个 segment 按中文标点分句拆分成多个小段。
 * 典型场景：turbo 同步 API 把 30s 音频的所有文字合成一段返回。
 */
function splitLongSegments(
  segments: NormalizedSegment[],
  maxCharsPerSegment: number = 80
): NormalizedSegment[] {
  const result: NormalizedSegment[] = [];

  for (const segment of segments) {
    if (segment.text.length <= maxCharsPerSegment) {
      result.push(segment);
      continue;
    }

    // 按中文句号、问号、叹号、分号、换行拆分
    const parts = segment.text
      .split(/(?<=[。！？；\n])/g)
      .map((s) => s.trim())
      .filter(Boolean);

    // 如果按句号拆不出来，尝试按逗号拆
    let chunks: string[];
    if (parts.length <= 1) {
      chunks = segment.text
        .split(/(?<=[，,、])/g)
        .map((s) => s.trim())
        .filter(Boolean);
    } else {
      // 合并过短的句子
      chunks = [];
      let buf = '';
      for (const part of parts) {
        if (buf.length + part.length <= maxCharsPerSegment) {
          buf += part;
        } else {
          if (buf) chunks.push(buf);
          buf = part;
        }
      }
      if (buf) chunks.push(buf);
    }

    if (chunks.length <= 1) {
      // 实在拆不动，按固定长度切
      chunks = [];
      for (let i = 0; i < segment.text.length; i += maxCharsPerSegment) {
        chunks.push(segment.text.slice(i, i + maxCharsPerSegment));
      }
    }

    // 按字符比例分配时间
    const segDuration = segment.endMs - segment.startMs;
    const totalChars = chunks.reduce((sum, c) => sum + c.length, 0);
    let cursor = segment.startMs;

    for (const chunk of chunks) {
      const chunkDuration = Math.max(200, Math.round((segDuration * chunk.length) / Math.max(1, totalChars)));
      const endMs = Math.min(cursor + chunkDuration, segment.endMs);
      result.push({
        ...segment,
        id: `seg-${result.length}`,
        text: chunk,
        startMs: cursor,
        endMs: Math.max(cursor + 200, endMs),
        confidence: segment.confidence,
        isFinal: segment.isFinal,
      });
      cursor = endMs;
    }
  }

  return result;
}

function normalizeImportedSegments(
  data: Record<string, unknown>,
  sourceDurationSec?: number
): NormalizedSegment[] {
  let segments = deduplicateAdjacentSegments(parseSegmentsFromPayload(data));
  if (segments.length === 0) return [];

  // 拆分过长的单 segment（turbo 同步 API 常返回整段文本合为一句）
  segments = splitLongSegments(segments);

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
    const ratio = rawLastEnd > 0 ? rawLastEnd / declaredDurationMs : 1;
    const drift = Math.abs(1 - ratio);
    const canSafelyScale = ratio >= TIMELINE_SCALE_RATIO_MIN && ratio <= TIMELINE_SCALE_RATIO_MAX;
    if (canSafelyScale && drift > 0.08) {
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
  // 视频导入不再使用 transcribe 限流，避免自测/正常使用被误拦

  const trace: ImportTraceEntry[] = [];

  try {
    ensureUploadDir();
    scheduleCleanupOldFiles();

    const body = (await request.json()) as ImportRequestBody;
    const videoUrl = body.url?.trim() || '';
    const mode = normalizeMode(body.mode);
    const language = normalizeLanguage(body.language);
    // 用户可通过「设置 → 视频导入」配置自己的 B 站 Cookie
    const userBiliCookie = body.biliCookie?.trim() || '';

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

    // 目前仅支持 B站视频导入
    if (parsed.provider !== 'bilibili') {
      throw new ImportPipelineError('UNSUPPORTED_PLATFORM', '目前仅支持 B站视频链接，其他平台即将支持');
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
          stageResult = await executeBiliNativeStage(videoUrl, baseName, userBiliCookie);
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
    if (
      (!stageResult.meta.durationSec || stageResult.meta.durationSec <= 0) &&
      stageResult.audioFilePath
    ) {
      const fallbackDurationSec = await getAudioDurationSec(stageResult.audioFilePath);
      if (fallbackDurationSec > 0) {
        stageResult.meta.durationSec = fallbackDurationSec;
        trace.push({
          stage: 'duration-ffprobe',
          ok: true,
          detail: `resolved ${fallbackDurationSec.toFixed(2)}s from audio`,
        });
      }
    }
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
      transcribed = await transcribeWithFallback(request, stageResult.audioFilePath, mode, language, trace, stageResult.meta.durationSec);
    } catch (error) {
      const importError = toPipelineError(error);
      // 从异常中提取 partialResult（transcribeWithFallback 在结果不足时附带）
      const partialResult = (error as { partialResult?: { data: Record<string, unknown>; usedMode: TranscribeMode } })?.partialResult;
      const enableWsFallback = process.env.VIDEO_IMPORT_ENABLE_WS_FALLBACK !== 'false';
      const shouldTryWsFallback = enableWsFallback && importError.code === 'ASR_TRANSCRIBE_FAILED';
      const allowPartialResult = process.env.VIDEO_IMPORT_ALLOW_PARTIAL_RESULT === 'true';

      if (!shouldTryWsFallback) {
        if (partialResult && allowPartialResult) {
          console.warn(`[video-import] cannot try WS fallback, using partial result due to VIDEO_IMPORT_ALLOW_PARTIAL_RESULT=true (mode=${partialResult.usedMode})`);
          trace.push({ stage: `asr-${partialResult.usedMode}-partial`, ok: true, detail: 'using partial result (no ws fallback, explicitly allowed)' });
          transcribed = partialResult;
        } else {
          if (partialResult) {
            trace.push({
              stage: `asr-${partialResult.usedMode}-partial`,
              ok: false,
              code: 'ASR_PARTIAL_REJECTED',
              detail: 'partial result rejected (ws fallback unavailable)',
            });
          }
          throw importError;
        }
      } else {
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

          if (partialResult && allowPartialResult) {
            console.warn(`[video-import] WS fallback failed, using partial result due to VIDEO_IMPORT_ALLOW_PARTIAL_RESULT=true (mode=${partialResult.usedMode})`);
            trace.push({ stage: `asr-${partialResult.usedMode}-partial`, ok: true, detail: 'using partial result after ws fallback failed (explicitly allowed)' });
            transcribed = partialResult;
          } else {
            if (partialResult) {
              trace.push({
                stage: `asr-${partialResult.usedMode}-partial`,
                ok: false,
                code: 'ASR_PARTIAL_REJECTED',
                detail: 'partial result rejected after ws fallback failure',
              });
            }
            throw new ImportPipelineError(
              importError.code,
              importError.message,
              [importError.detail || importError.message, `ws fallback: ${wsPipelineError.detail || wsPipelineError.message}`]
                .filter(Boolean)
                .join(' | ')
            );
          }
        }
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
