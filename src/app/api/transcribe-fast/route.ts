import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import pRetry, { AbortError } from 'p-retry';
import { applyRateLimit } from '@/lib/utils/rate-limit';
import {
  MediaToolError,
  isToolNotFoundError,
  resolveFfmpegPath,
  resolveFfprobePath,
  resolvePublicBaseUrl,
  runCommand,
  safeUnlink,
} from '@/lib/services/media-tooling';
import { createLogger, track } from '@/lib/logger';
import { stitchSegments, stitchSegmentsWithOverlap, fullJitterDelay } from '@/lib/services/asr/text-utils';
const log = createLogger('transcribe-fast');


const MAX_FILE_SIZE = 500 * 1024 * 1024;
const UPLOAD_DIR = path.join(process.cwd(), 'public', 'temp-audio');
const DASHSCOPE_API_BASE = 'https://dashscope.aliyuncs.com/api/v1';
const ASR_TRANSCRIPTION_URL = `${DASHSCOPE_API_BASE}/services/audio/asr/transcription`;
const TASK_QUERY_URL = `${DASHSCOPE_API_BASE}/tasks`;

// M2 T2.7: 长音频分片策略
// - Whisper 作者推荐：≤10min/段 + 重叠缝合
// - DashScope Qwen3-ASR-Flash async 单次上限 3 小时 / 2GB，但稳定性分片 ≤10min 最佳
// - 重叠 2s 用于解决硬切音频的边界句截断问题
const SEGMENT_DURATION_SEC = Number(process.env.ASR_SEGMENT_DURATION_SEC ?? 600); // 10 分钟
const SEGMENT_OVERLAP_SEC = Number(process.env.ASR_SEGMENT_OVERLAP_SEC ?? 2);
const MIN_DURATION_FOR_SPLIT = Number(process.env.ASR_MIN_DURATION_FOR_SPLIT_SEC ?? 240);
const MAX_ASR_CONTEXT_CHARS = 4000;

interface ASRSentence {
  text: string;
  begin_time?: number;
  end_time?: number;
  start_time?: number;
}

interface TaskResult {
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
  transcription_url?: string;
  error?: string;
}

function sanitizeASRContext(raw: FormDataEntryValue | null): string {
  if (typeof raw !== 'string') return '';
  const normalized = raw.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= MAX_ASR_CONTEXT_CHARS) return normalized;
  return `${normalized.slice(0, MAX_ASR_CONTEXT_CHARS - 1)}…`;
}

function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

function cleanupOldFiles() {
  try {
    if (!fs.existsSync(UPLOAD_DIR)) return;
    const files = fs.readdirSync(UPLOAD_DIR);
    const now = Date.now();
    const maxAge = 2 * 60 * 60 * 1000; // 2小时

    for (const file of files) {
      const filePath = path.join(UPLOAD_DIR, file);
      try {
        const stats = fs.statSync(filePath);
        if (now - stats.mtimeMs > maxAge) {
          fs.unlinkSync(filePath);
        }
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

async function getAudioDuration(filePath: string, ffprobePath: string): Promise<number> {
  try {
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

async function splitAudio(
  inputPath: string,
  outputDir: string,
  segmentDuration: number,
  baseName: string,
  ffmpegPath: string,
  ffprobePath: string,
  overlapSec: number = 0,
): Promise<{
  segments: string[];
  durations: number[];
  timings: { startMs: number; endMs: number; overlapLeadMs: number }[];
}> {
  const totalDuration = await getAudioDuration(inputPath, ffprobePath);

  if (totalDuration <= MIN_DURATION_FOR_SPLIT) {
    return {
      segments: [inputPath],
      durations: [totalDuration * 1000],
      timings: [{ startMs: 0, endMs: Math.round(totalDuration * 1000), overlapLeadMs: 0 }],
    };
  }

  const segments: string[] = [];
  const durations: number[] = [];
  const timings: { startMs: number; endMs: number; overlapLeadMs: number }[] = [];
  const ext = path.extname(inputPath);

  // 分片 + 重叠：
  //   seg 0: [0, segmentDuration]
  //   seg i: [i*segmentDuration - overlap, (i+1)*segmentDuration]
  // 保证相邻段有 overlap 秒重叠，首段左侧无重叠
  const stride = segmentDuration;
  let segIndex = 0;
  let nominalStart = 0;

  while (nominalStart < totalDuration) {
    const overlap = segIndex === 0 ? 0 : overlapSec;
    const realStart = Math.max(0, nominalStart - overlap);
    const nominalEnd = Math.min(nominalStart + stride, totalDuration);
    const duration = nominalEnd - realStart;

    const outputPath = path.join(outputDir, `${baseName}_seg${segIndex}${ext}`);
    try {
      await runCommand(
        ffmpegPath,
        ['-y', '-ss', String(realStart), '-i', inputPath, '-t', String(duration), '-c', 'copy', outputPath],
        { toolName: 'ffmpeg' },
      );
    } catch {
      // Fallback without stream copy
      await runCommand(
        ffmpegPath,
        ['-y', '-ss', String(realStart), '-i', inputPath, '-t', String(duration), outputPath],
        { toolName: 'ffmpeg' },
      );
    }
    segments.push(outputPath);
    durations.push(duration * 1000);
    timings.push({
      startMs: Math.round(realStart * 1000),
      endMs: Math.round(nominalEnd * 1000),
      overlapLeadMs: Math.round(overlap * 1000),
    });

    nominalStart += stride;
    segIndex += 1;
  }

  return { segments, durations, timings };
}

async function submitAsyncTask(
  fileUrl: string,
  apiKey: string,
  language: string = 'zh',
  contextHint: string = ''
): Promise<{ success: boolean; taskId?: string; error?: string }> {
  const requestBody = {
    model: 'qwen3-asr-flash-filetrans',
    input: { file_url: fileUrl },
    parameters: {
      channel_id: [0],
      language,
      enable_itn: true,
      ...(contextHint ? { corpus: { text: contextHint } } : {}),
    },
  };

  const response = await fetch(ASR_TRANSCRIPTION_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-DashScope-Async': 'enable',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const text = await response.text();
    return { success: false, error: `HTTP ${response.status}: ${text}` };
  }

  const data = (await response.json()) as { output?: { task_id?: string } };
  const taskId = data.output?.task_id;
  if (!taskId) {
    return { success: false, error: 'missing task_id' };
  }

  return { success: true, taskId };
}

async function queryTaskStatus(taskId: string, apiKey: string): Promise<TaskResult> {
  const response = await fetch(`${TASK_QUERY_URL}/${taskId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    return { status: 'UNKNOWN', error: await response.text() };
  }

  const data = (await response.json()) as {
    output?: {
      task_status?: TaskResult['status'];
      result?: { transcription_url?: string };
      message?: string;
    };
    message?: string;
  };

  const status = data.output?.task_status || 'UNKNOWN';
  if (status === 'SUCCEEDED') {
    return {
      status: 'SUCCEEDED',
      transcription_url: data.output?.result?.transcription_url,
    };
  }

  if (status === 'FAILED') {
    return {
      status: 'FAILED',
      error: data.output?.message || data.message || 'task failed',
    };
  }

  return { status };
}

async function fetchTranscriptionResult(url: string): Promise<ASRSentence[]> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`fetch result failed: HTTP ${response.status}`);
  }

  const data = (await response.json()) as {
    transcripts?: Array<{ sentences?: ASRSentence[] }>;
  };
  const sentences: ASRSentence[] = [];
  const transcripts = data.transcripts || [];

  for (const transcript of transcripts) {
    if (Array.isArray(transcript.sentences)) {
      sentences.push(...transcript.sentences);
    }
  }

  return sentences;
}

async function waitForSingleTask(
  taskId: string,
  apiKey: string,
  maxWaitMs: number = 600_000,
): Promise<{ success: boolean; sentences: ASRSentence[]; error?: string }> {
  // M2 T2.3: p-retry + Full Jitter 退避（AWS 推荐），替换原先的线性 1.2x 递增。
  // 总上限 maxWaitMs 配置化（默认 10 分钟，原为 5 分钟，长音频更友好）。
  const startedAt = Date.now();
  const MAX_POLL_ATTEMPTS = 120;
  try {
    const sentences = await pRetry(
      async (attempt) => {
        const elapsed = Date.now() - startedAt;
        if (elapsed > maxWaitMs) {
          // 超过总预算，用 AbortError 停止重试
          throw new AbortError(`task timeout after ${elapsed}ms`);
        }

        const result = await queryTaskStatus(taskId, apiKey);
        if (result.status === 'SUCCEEDED' && result.transcription_url) {
          return fetchTranscriptionResult(result.transcription_url);
        }
        if (result.status === 'FAILED') {
          throw new AbortError(`task failed: ${result.error ?? 'unknown'}`);
        }

        // Still pending/running — 用 Full Jitter 延迟后重试
        const delay = fullJitterDelay(Math.min(attempt, 8), 1000, 10000);
        await new Promise((resolve) => setTimeout(resolve, delay));
        throw new Error(`task ${result.status}`); // 触发 p-retry 的下一次尝试
      },
      {
        retries: MAX_POLL_ATTEMPTS,
        factor: 1, // 我们自己在 function 里控制退避；p-retry 的指数因子关掉
        minTimeout: 0,
        maxTimeout: 0,
        onFailedAttempt: (err) => {
          if (err.attemptNumber > 1 && err.attemptNumber % 10 === 0) {
            log.debug('polling still pending', { taskId, attemptNumber: err.attemptNumber });
          }
        },
      },
    );
    return { success: true, sentences };
  } catch (err) {
    const msg = (err as Error).message;
    return { success: false, sentences: [], error: msg };
  }
}

async function processParallelTasks(
  segmentPaths: string[],
  segmentDurations: number[],
  segmentTimings: { startMs: number; endMs: number; overlapLeadMs: number }[] | null,
  apiKey: string,
  language: string,
  publicBaseUrl: string,
  contextHint: string,
): Promise<{
  success: boolean;
  allSentences: ASRSentence[];
  failedSegmentIndices: number[];
  error?: string;
}> {
  const submitResults = await Promise.all(
    segmentPaths.map(async (segPath) => {
      const fileName = path.basename(segPath);
      const fileUrl = `${publicBaseUrl}/temp-audio/${fileName}`;
      return submitAsyncTask(fileUrl, apiKey, language, contextHint);
    }),
  );

  const taskIds: Array<string | null> = submitResults.map((result) =>
    result.success && result.taskId ? result.taskId : null,
  );

  if (taskIds.every((taskId) => taskId === null)) {
    const firstError = submitResults.find((r) => r.error)?.error || 'unknown';
    log.error('all task submits failed', { firstError, totalSegments: taskIds.length });
    return {
      success: false,
      allSentences: [],
      failedSegmentIndices: taskIds.map((_, i) => i),
      error: `all task submit failed: ${firstError}`,
    };
  }

  const taskResults = await Promise.all(
    taskIds.map((taskId) => {
      if (!taskId) {
        return Promise.resolve({
          success: false,
          sentences: [] as ASRSentence[],
          error: 'task not submitted',
        });
      }
      return waitForSingleTask(taskId, apiKey);
    }),
  );

  // M2 T2.1 + T2.7:
  //   - timings 可用（有 overlap 信息）→ 走重叠缝合 stitchSegmentsWithOverlap
  //   - timings 缺失（走到了旧路径）→ 兜底 stitchSegments
  const stitchedResults = taskResults.map((r) => ({
    success: r.success,
    sentences: r.sentences,
    error: r.error,
  }));

  const stitched = segmentTimings
    ? stitchSegmentsWithOverlap(stitchedResults, segmentTimings)
    : stitchSegments(stitchedResults, segmentDurations);

  if (stitched.allSentences.length === 0) {
    return {
      success: false,
      allSentences: [],
      failedSegmentIndices: stitched.failedIndices,
      error: 'no transcript produced',
    };
  }

  return {
    success: true,
    allSentences: stitched.allSentences,
    failedSegmentIndices: stitched.failedIndices,
    error: stitched.failedIndices.length > 0 ? `partial failure: ${stitched.failedIndices.length} segment(s)` : undefined,
  };
}

export async function POST(request: NextRequest) {
  const rateLimitResponse = await applyRateLimit(request, 'transcribe');
  if (rateLimitResponse) return rateLimitResponse;

  // 用于 finally 清理的临时文件集合
  const tempFiles = new Set<string>();
  const sessionId = `asr-fast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();

  try {
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey) {
      track({ kind: 'asr.fail', mode: 'fast', sessionId, durationMs: Date.now() - startedAt, errorCode: 'ASR_API_KEY_MISSING' });
      return NextResponse.json({ error: '服务未配置转写密钥', code: 'ASR_API_KEY_MISSING' }, { status: 500 });
    }

    const publicBase = resolvePublicBaseUrl();
    if (!publicBase.ok || !publicBase.baseUrl) {
      track({ kind: 'asr.fail', mode: 'fast', sessionId, durationMs: Date.now() - startedAt, errorCode: 'ASR_PUBLIC_HOST_MISSING' });
      return NextResponse.json(
        {
          error: '服务端未配置可访问的公网地址，暂时无法转写',
          code: 'ASR_PUBLIC_HOST_MISSING',
          detail: publicBase.error,
        },
        { status: 500 },
      );
    }

    ensureUploadDir();
    cleanupOldFiles();

    const formData = await request.formData();
    const audioFile = formData.get('audio') as File | null;
    const language = (formData.get('language') as string) || 'zh';
    const contextHint = sanitizeASRContext(formData.get('context'));

    if (!audioFile) {
      track({ kind: 'asr.fail', mode: 'fast', sessionId, durationMs: Date.now() - startedAt, errorCode: 'ASR_AUDIO_MISSING' });
      return NextResponse.json({ error: '未提供音频文件', code: 'ASR_AUDIO_MISSING' }, { status: 400 });
    }

    if (audioFile.size > MAX_FILE_SIZE) {
      track({ kind: 'asr.fail', mode: 'fast', sessionId, durationMs: Date.now() - startedAt, errorCode: 'ASR_AUDIO_TOO_LARGE' });
      return NextResponse.json({ error: '文件过大', code: 'ASR_AUDIO_TOO_LARGE' }, { status: 400 });
    }

    track({ kind: 'asr.start', mode: 'fast', sessionId, language });

    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 8);
    const ext = path.extname(audioFile.name) || '.mp3';
    const baseName = `audio_${timestamp}_${randomId}`;
    const originalPath = path.join(UPLOAD_DIR, `${baseName}${ext}`);

    const buffer = Buffer.from(await audioFile.arrayBuffer());
    fs.writeFileSync(originalPath, buffer);
    tempFiles.add(originalPath);

    const ffmpegPath = resolveFfmpegPath();
    const ffprobePath = resolveFfprobePath(ffmpegPath);

    const { segments, durations, timings } = await splitAudio(
      originalPath,
      UPLOAD_DIR,
      SEGMENT_DURATION_SEC,
      baseName,
      ffmpegPath,
      ffprobePath,
      SEGMENT_OVERLAP_SEC,
    );

    // 记录所有分段文件用于 finally 清理
    for (const segPath of segments) {
      tempFiles.add(segPath);
    }

    const result = await processParallelTasks(segments, durations, timings, apiKey, language, publicBase.baseUrl, contextHint);

    if (!result.success) {
      const durationMs = Date.now() - startedAt;
      // M2 T2.4: 失败时返回具体的 failedSegmentIndices，便于前端局部重试 / 降级展示
      track({ kind: 'asr.fail', mode: 'fast', sessionId, durationMs, errorCode: 'ASR_FAST_TASK_FAILED', errorMsg: result.error });
      return NextResponse.json(
        {
          error: '转写失败',
          code: 'ASR_FAST_TASK_FAILED',
          detail: result.error,
          failedSegmentIndices: result.failedSegmentIndices,
          totalSegments: segments.length,
        },
        { status: 500 },
      );
    }

    const outputSegments = result.allSentences.map((sentence, index) => ({
      id: `seg-${index}`,
      text: sentence.text.trim(),
      startMs: sentence.begin_time ?? sentence.start_time ?? 0,
      endMs: sentence.end_time ?? 0,
      confidence: 0.95,
      isFinal: true,
    }));

    const totalDuration = outputSegments.length > 0 ? outputSegments[outputSegments.length - 1].endMs : 0;
    const fullText = outputSegments.map((segment) => segment.text).join('');
    const durationMs = Date.now() - startedAt;

    track({ kind: 'asr.success', mode: 'fast', sessionId, durationMs, segments: outputSegments.length, chars: fullText.length });

    return NextResponse.json({
      success: true,
      text: fullText,
      sentences: outputSegments.map((segment) => ({
        id: segment.id,
        text: segment.text,
        beginTime: segment.startMs,
        endTime: segment.endMs,
      })),
      totalDuration,
      segments: outputSegments,
      language,
      mode: 'parallel',
      contextHintUsed: Boolean(contextHint),
      // 部分失败时给前端提示（不影响 success=true）
      partialFailure: result.failedSegmentIndices.length > 0
        ? { failedIndices: result.failedSegmentIndices, totalSegments: segments.length }
        : undefined,
    });
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    if (
      error instanceof MediaToolError &&
      (isToolNotFoundError(error, 'ffmpeg') || isToolNotFoundError(error, 'ffprobe'))
    ) {
      track({ kind: 'asr.fail', mode: 'fast', sessionId, durationMs, errorCode: 'FFMPEG_NOT_FOUND' });
      return NextResponse.json(
        {
          error: '服务端未安装 ffmpeg/ffprobe，无法处理音频',
          code: 'FFMPEG_NOT_FOUND',
          detail: error.detail || error.message,
        },
        { status: 500 },
      );
    }

    track({ kind: 'asr.fail', mode: 'fast', sessionId, durationMs, errorCode: 'ASR_FAST_INTERNAL_ERROR', errorMsg: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      {
        error: '快速转写服务异常',
        code: 'ASR_FAST_INTERNAL_ERROR',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  } finally {
    // 确保所有临时文件被清理，无论成功还是异常
    for (const filePath of tempFiles) {
      safeUnlink(filePath);
    }
  }
}

export const maxDuration = 600;
