import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { WebSocket } from 'undici';
import { parseVideoLink, isLikelyDirectMediaUrl } from '@/lib/utils/video-link';
import {
  type TranscribeMode,
  type VideoSourceMode,
  type StageName,
  type ImportTraceEntry,
  type ImportRequestBody,
  type VideoImportMeta,
  type StageResult,
  type StageFailure,
  type WsResultSentence,
  type NormalizedSegment,
  ImportPipelineError,
  TIMELINE_SCALE_RATIO_MIN,
  TIMELINE_SCALE_RATIO_MAX,
  PCM_BYTES_PER_SEC,
  MIN_DURATION_FOR_COMPLETENESS_CHECK_SEC,
  MIN_TEXT_CHARS_PER_SEC,
  MIN_TEXT_COVERAGE_RATIO,
  MIN_TIMELINE_COVERAGE_SHORT,
  MIN_TIMELINE_COVERAGE_LONG,
  normalizeMode,
  normalizeLanguage,
  isPipelineError,
  toPipelineError,
  statusFromCode,
  getTranscribeApiPath,
  buildModeOrder,
  parseErrorCode,
  parseErrorMessage,
  parseErrorDetail,
  toFiniteNumber,
  readSegmentEndMs,
  summarizeAsrResult,
  isUnsafeVideoUrl,
  buildStageOrder,
  pickMostInformativeStageError,
  estimatePcmDurationMs,
} from './video-import-types';
import {
  normalizePossibleMojibake,
  normalizeVideoMeta,
  normalizeTranscribePayload,
  normalizeImportedSegments,
  mapSubtitleSegmentsToApiSegments,
  normalizeWsSegments,
} from './video-import-segment';
import {
  hasYtDlp,
  downloadAudioByYtDlp,
  downloadFile,
  prepareAudioFromDirectUrl,
} from './video-import-download';
import {
  downloadBiliAudio,
  fetchPlayerSubtitle,
  fetchPlayurlAudio,
  fetchViewMeta,
  resolveBilibiliUrl,
} from '@/lib/services/bilibili-import-service';
import {
  fetchXiaoyuzhouEpisode,
  downloadXiaoyuzhouAudio,
} from '@/lib/services/xiaoyuzhou-import-service';
import {
  resolveFfmpegPath,
  resolveFfprobePath,
  resolveOutputPath,
  resolvePublicBaseUrl,
  runCommand,
  safeUnlink,
  transcodeToMp3,
} from '@/lib/services/media-tooling';
import { createLogger } from '@/lib/logger';
const log = createLogger('video/import');


export const runtime = 'nodejs';
export const maxDuration = 900;

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'temp-audio');
const MAX_AGE_MS = 6 * 60 * 60 * 1000;
const CLEANUP_MIN_INTERVAL_MS = Number.parseInt(process.env.VIDEO_IMPORT_CLEANUP_INTERVAL_MS || '300000', 10);
const CLEANUP_EVERY_N_REQUESTS = Number.parseInt(process.env.VIDEO_IMPORT_CLEANUP_EVERY_N || '10', 10);

const WS_CHUNK_PCM_BYTES = Number.parseInt(
  process.env.VIDEO_IMPORT_WS_CHUNK_PCM_BYTES || `${10 * 1024 * 1024}`,
  10
);

let cleanupRequestCount = 0;
let lastCleanupAt = 0;
let cleanupInFlight: Promise<void> | null = null;

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

/**
 * 长音频直接转写：绕过 HTTP 回环，直接调 DashScope 异步 filetrans API。
 *
 * 适用场景：播客、长讲座等 > 10 分钟的音频。
 * DashScope qwen3-asr-flash-filetrans 支持最长 12 小时音频。
 * 不切分——整个文件提交一个异步任务，避免内存压力。
 */
async function transcribeLongAudioDirect(
  audioFilePath: string,
  language: string,
  trace: ImportTraceEntry[],
  expectedDurationSec?: number
): Promise<{ data: Record<string, unknown>; usedMode: TranscribeMode } | null> {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    log.warn('[video-import] transcribeLongAudioDirect: DASHSCOPE_API_KEY not configured');
    return null;
  }

  const publicBase = resolvePublicBaseUrl();
  if (!publicBase.ok || !publicBase.baseUrl) {
    log.warn(`[video-import] transcribeLongAudioDirect: public URL not configured (${publicBase.error})`);
    return null;
  }

  const fileName = path.basename(audioFilePath);
  const fileUrl = `${publicBase.baseUrl}/temp-audio/${encodeURIComponent(fileName)}`;

  // 1. 提交异步任务
  const submitBody = {
    model: 'qwen3-asr-flash-filetrans',
    input: { file_url: fileUrl },
    parameters: {
      channel_id: [0],
      language,
      enable_itn: true,
    },
  };

  let taskId: string;
  try {
    const submitResponse = await fetch(
      'https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'X-DashScope-Async': 'enable',
        },
        body: JSON.stringify(submitBody),
      }
    );

    if (!submitResponse.ok) {
      const text = await submitResponse.text();
      log.error(`[video-import] transcribeLongAudioDirect: submit failed HTTP ${submitResponse.status}: ${text.slice(0, 300)}`);
      trace.push({ stage: 'asr-direct-submit', ok: false, code: 'ASR_DIRECT_SUBMIT_FAILED', detail: `HTTP ${submitResponse.status}` });
      return null;
    }

    const submitData = (await submitResponse.json()) as { output?: { task_id?: string } };
    taskId = submitData.output?.task_id || '';
    if (!taskId) {
      log.error('[video-import] transcribeLongAudioDirect: no task_id in response');
      trace.push({ stage: 'asr-direct-submit', ok: false, code: 'ASR_DIRECT_SUBMIT_FAILED', detail: 'missing task_id' });
      return null;
    }
    trace.push({ stage: 'asr-direct-submit', ok: true, detail: `taskId=${taskId}` });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    log.error(`[video-import] transcribeLongAudioDirect: submit error: ${detail}`);
    trace.push({ stage: 'asr-direct-submit', ok: false, code: 'ASR_DIRECT_SUBMIT_FAILED', detail });
    return null;
  }

  // 2. 轮询等待结果
  // 预估等待时间：DashScope 处理速度约为实际时长的 1/10-1/5，
  // 165 分钟音频大约需要 1-3 分钟。设最大等待 10 分钟。
  const maxWaitMs = 600000; // 10 minutes
  const startTime = Date.now();
  let pollInterval = 3000;
  const maxInterval = 8000;

  while (Date.now() - startTime < maxWaitMs) {
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
    pollInterval = Math.min(Math.floor(pollInterval * 1.3), maxInterval);

    try {
      const queryResponse = await fetch(
        `https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`,
        { headers: { Authorization: `Bearer ${apiKey}` } }
      );

      if (!queryResponse.ok) continue;

      const queryData = (await queryResponse.json()) as {
        output?: {
          task_status?: string;
          result?: { transcription_url?: string };
          message?: string;
        };
      };

      const status = queryData.output?.task_status;
      if (status === 'SUCCEEDED') {
        const transcriptionUrl = queryData.output?.result?.transcription_url;
        if (!transcriptionUrl) {
          trace.push({ stage: 'asr-direct-poll', ok: false, code: 'ASR_DIRECT_NO_URL', detail: 'SUCCEEDED but no transcription_url' });
          return null;
        }

        // 3. 获取转录结果
        const resultResponse = await fetch(transcriptionUrl);
        if (!resultResponse.ok) {
          trace.push({ stage: 'asr-direct-result', ok: false, code: 'ASR_DIRECT_RESULT_FAILED', detail: `HTTP ${resultResponse.status}` });
          return null;
        }

        const resultData = (await resultResponse.json()) as {
          transcripts?: Array<{ sentences?: Array<{ text: string; begin_time?: number; end_time?: number }> }>;
        };

        const allSentences: Array<{ text: string; beginTime: number; endTime: number }> = [];
        for (const transcript of resultData.transcripts || []) {
          for (const sentence of transcript.sentences || []) {
            if (sentence.text?.trim()) {
              allSentences.push({
                text: sentence.text.trim(),
                beginTime: sentence.begin_time ?? 0,
                endTime: sentence.end_time ?? 0,
              });
            }
          }
        }

        if (allSentences.length === 0) {
          trace.push({ stage: 'asr-direct-result', ok: false, code: 'ASR_DIRECT_EMPTY', detail: 'no sentences in transcript' });
          return null;
        }

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        trace.push({ stage: 'asr-direct', ok: true, detail: `${allSentences.length} sentences, ${elapsed}s` });

        const text = allSentences.map((s) => s.text).join('');
        const segments = allSentences.map((s, i) => ({
          id: `seg-${i}`,
          text: s.text,
          startMs: s.beginTime,
          endMs: s.endTime,
          confidence: 0.95,
          isFinal: true,
        }));
        const totalDuration = segments.length > 0 ? segments[segments.length - 1].endMs : 0;

        return {
          data: {
            success: true,
            text,
            totalDuration,
            segments,
            sentences: allSentences.map((s, i) => ({
              id: `seg-${i}`,
              text: s.text,
              beginTime: s.beginTime,
              endTime: s.endTime,
              confidence: 0.95,
            })),
          },
          usedMode: 'fast',
        };
      }

      if (status === 'FAILED') {
        const message = queryData.output?.message || 'unknown';
        log.error(`[video-import] transcribeLongAudioDirect: task FAILED: ${message}`);
        trace.push({ stage: 'asr-direct-poll', ok: false, code: 'ASR_DIRECT_TASK_FAILED', detail: message });
        return null;
      }

      // PENDING / RUNNING → continue polling
    } catch {
      // 轮询网络错误，继续重试
    }
  }

  log.warn(`[video-import] transcribeLongAudioDirect: task timeout after ${maxWaitMs / 1000}s`);
  trace.push({ stage: 'asr-direct-poll', ok: false, code: 'ASR_DIRECT_TIMEOUT', detail: `exceeded ${maxWaitMs / 1000}s` });
  return null;
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

  const openAsBlob = (fsp as unknown as { openAsBlob?: (path: string, options?: { type?: string }) => Promise<Blob> }).openAsBlob;
  const audioBlob = openAsBlob
    ? await openAsBlob(audioFilePath, { type: 'audio/mpeg' })
    : new Blob([await fsp.readFile(audioFilePath)], { type: 'audio/mpeg' });

  let lastFailure = 'unknown';
  let bestPartialResult: { data: Record<string, unknown>; usedMode: TranscribeMode } | null = null;

  for (const mode of buildModeOrder(requestedMode)) {
    const endpoint = `${origin}${getTranscribeApiPath(mode)}`;
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
      log.error(`[video-import] ASR mode=${mode} fetch error: ${detail}`);
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
        log.warn(
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
    log.error(`[video-import] ASR mode=${mode} failed: ${code} - ${detail || errorMessage}`);
    trace.push({ stage: `asr-${mode}`, ok: false, code, detail: detail || errorMessage });
    lastFailure = `${code}: ${detail || errorMessage}`;
  }

  // 所有HTTP模式结果都不足时，抛出异常让调用方有机会尝试 WS fallback
  // 把 bestPartialResult 附到异常上，WS fallback 也失败时可以降级使用
  if (bestPartialResult) {
    log.warn(`[video-import] all ASR modes produced insufficient results, throwing to trigger WS fallback (best partial mode=${bestPartialResult.usedMode})`);
    const err = new ImportPipelineError('ASR_TRANSCRIBE_FAILED', '音频转写失败', lastFailure);
    (err as ImportPipelineError & { partialResult?: typeof bestPartialResult }).partialResult = bestPartialResult;
    throw err;
  }

  throw new ImportPipelineError('ASR_TRANSCRIBE_FAILED', '音频转写失败', lastFailure);
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

    if (viewMeta.durationSec && viewMeta.durationSec > 30 && mp3Duration > 0) {
      const ratio = mp3Duration / viewMeta.durationSec;
      if (ratio < BILI_MIN_AUDIO_DURATION_RATIO) {
        // 长视频部分下载：如果已下载音频 >= 60s，则允许部分转录而不报错
        if (mp3Duration >= BILI_MIN_PARTIAL_AUDIO_SEC) {
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

  const downloaded = await downloadAudioByYtDlp(videoUrl, baseName, UPLOAD_DIR, {
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

  const audioFilePath = await prepareAudioFromDirectUrl(videoUrl, baseName, UPLOAD_DIR);
  return {
    sourceMode: 'direct',
    audioFilePath,
    meta: {
      resolvedUrl: videoUrl,
    },
  };
}

async function executeXiaoyuzhouStage(videoUrl: string, baseName: string): Promise<StageResult> {
  const episode = await fetchXiaoyuzhouEpisode(videoUrl);

  const rawPath = resolveOutputPath(UPLOAD_DIR, `${baseName}_xyз_raw`, '.m4a');
  const mp3Path = resolveOutputPath(UPLOAD_DIR, baseName, '.mp3');

  try {
    await downloadXiaoyuzhouAudio(episode.audioUrl, rawPath);

    const rawSize = await getFileSizeBytes(rawPath);

    if (rawSize < 10 * 1024) {
      throw new ImportPipelineError(
        'XIAOYUZHOU_AUDIO_INCOMPLETE',
        '小宇宙音频下载不完整',
        `downloaded ${rawSize} bytes`
      );
    }

    await transcodeToMp3(rawPath, mp3Path);

    const mp3Duration = await getAudioDurationSec(mp3Path);

    // 构建显示用标题：播客名 - 单集名
    const displayTitle = episode.podcastTitle
      ? `${episode.podcastTitle} - ${episode.title}`
      : episode.title;

    return {
      sourceMode: 'xiaoyuzhou',
      audioFilePath: mp3Path,
      meta: {
        title: displayTitle,
        durationSec: episode.durationSec || mp3Duration || undefined,
        thumbnailUrl: episode.coverUrl,
        resolvedUrl: episode.episodeUrl,
      },
    };
  } catch (error) {
    safeUnlink(mp3Path);
    throw error;
  } finally {
    safeUnlink(rawPath);
  }
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

    // 非 B站/小宇宙等国内平台需要外网访问能力（如 yt-dlp 调 YouTube），
    // 仅在 hk 节点或明确启用时放开。
    // 国内平台白名单：bilibili、xiaoyuzhou、douyin 不需要外网节点
    const domesticProviders = ['bilibili', 'xiaoyuzhou', 'douyin'];
    if (!domesticProviders.includes(parsed.provider)) {
      const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
      const isHkNode = host.includes('hk.meetmind');
      const envEnabled = process.env.VIDEO_IMPORT_ENABLE_YOUTUBE === 'true';

      if (!isHkNode && !envEnabled) {
        throw new ImportPipelineError(
          'UNSUPPORTED_PLATFORM',
          '当前节点仅支持 B站/抖音视频链接。YouTube 等平台请使用 hk.meetmind.online 访问。'
        );
      }
    }

    const strategy = process.env.VIDEO_IMPORT_STRATEGY === 'yt-dlp-first' ? 'yt-dlp-first' : 'bili-native-first';
    const enableYtDlpFallback = process.env.VIDEO_IMPORT_ENABLE_YTDLP_FALLBACK !== 'false';
    const stageOrder = buildStageOrder(parsed.provider, videoUrl, strategy, enableYtDlpFallback, isLikelyDirectMediaUrl);

    const baseName = `video_import_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let stageResult: StageResult | null = null;
    let lastError: ImportPipelineError | null = null;
    const stageFailures: StageFailure[] = [];

    for (const stage of stageOrder) {
      try {
        if (stage === 'bili-native') {
          stageResult = await executeBiliNativeStage(videoUrl, baseName, userBiliCookie);
        } else if (stage === 'xiaoyuzhou') {
          stageResult = await executeXiaoyuzhouStage(videoUrl, baseName);
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

    let transcribed: { data: Record<string, unknown>; usedMode: TranscribeMode } | undefined;

    // 长音频智能模式选择：
    // turbo 每 30s 切一段同步处理，165 分钟 = 330 段，10 分钟 route 超时大概率不够。
    // fast 每 180s 切一段异步并行，165 分钟 = 55 段，效率高且 DashScope filetrans 支持 12h。
    // 阈值 10 分钟：超过此时长优先 fast，低于此时长保持用户指定模式（turbo 更快）。
    const LONG_AUDIO_THRESHOLD_SEC = 600;
    const effectiveMode =
      mode === 'turbo' &&
      stageResult.meta.durationSec &&
      stageResult.meta.durationSec > LONG_AUDIO_THRESHOLD_SEC
        ? 'fast'
        : mode;
    if (effectiveMode !== mode) {
    }

    // 长音频优先直接调 DashScope 异步 API，绕过 HTTP 回环（避免 OOM）
    if (effectiveMode !== 'turbo') {
      const directResult = await transcribeLongAudioDirect(
        stageResult.audioFilePath,
        language,
        trace,
        stageResult.meta.durationSec
      );
      if (directResult) {
        transcribed = directResult;
      }
    }

    if (!transcribed) try {
      transcribed = await transcribeWithFallback(request, stageResult.audioFilePath, effectiveMode, language, trace, stageResult.meta.durationSec);
    } catch (error) {
      const importError = toPipelineError(error);
      // 从异常中提取 partialResult（transcribeWithFallback 在结果不足时附带）
      const partialResult = (error as { partialResult?: { data: Record<string, unknown>; usedMode: TranscribeMode } })?.partialResult;
      const enableWsFallback = process.env.VIDEO_IMPORT_ENABLE_WS_FALLBACK !== 'false';
      const shouldTryWsFallback = enableWsFallback && importError.code === 'ASR_TRANSCRIBE_FAILED';
      const allowPartialResult = process.env.VIDEO_IMPORT_ALLOW_PARTIAL_RESULT === 'true';

      if (!shouldTryWsFallback) {
        if (partialResult && allowPartialResult) {
          log.warn(`[video-import] cannot try WS fallback, using partial result due to VIDEO_IMPORT_ALLOW_PARTIAL_RESULT=true (mode=${partialResult.usedMode})`);
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
            log.warn(`[video-import] WS fallback failed, using partial result due to VIDEO_IMPORT_ALLOW_PARTIAL_RESULT=true (mode=${partialResult.usedMode})`);
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

    if (!transcribed) {
      throw new ImportPipelineError('ASR_TRANSCRIBE_FAILED', '音频转写失败', 'all transcription paths exhausted');
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
