import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
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

const MAX_FILE_SIZE = 500 * 1024 * 1024;
const UPLOAD_DIR = path.join(process.cwd(), 'public', 'temp-audio');
const SYNC_ASR_URL = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';

const SEGMENT_DURATION_SEC = 30;
const MIN_DURATION_FOR_SPLIT = 40;
const MAX_RETRIES = 3;
const BATCH_SIZE = Number.parseInt(process.env.ASR_TURBO_BATCH_SIZE || '8', 10);
const MAX_ASR_CONTEXT_CHARS = 4000;

interface ASRSentence {
  text: string;
  begin_time?: number;
  end_time?: number;
  start_time?: number;
}

interface SegmentTask {
  path: string;
  durationMs: number;
  index: number;
}

interface SegmentResult {
  ok: boolean;
  sentence?: ASRSentence;
  error?: string;
}

function sanitizeASRContext(raw: FormDataEntryValue | null): string {
  if (typeof raw !== 'string') return '';
  const normalized = raw.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= MAX_ASR_CONTEXT_CHARS) return normalized;
  return `${normalized.slice(0, MAX_ASR_CONTEXT_CHARS - 1)}…`;
}

function ensureUploadDir(): void {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

function cleanupOldFiles(): void {
  try {
    if (!fs.existsSync(UPLOAD_DIR)) return;
    const files = fs.readdirSync(UPLOAD_DIR);
    const now = Date.now();
    const maxAge = 2 * 60 * 60 * 1000;

    for (const fileName of files) {
      const filePath = path.join(UPLOAD_DIR, fileName);
      try {
        const stat = fs.statSync(filePath);
        if (now - stat.mtimeMs > maxAge) {
          fs.unlinkSync(filePath);
        }
      } catch {
        // ignore single-file cleanup errors
      }
    }
  } catch {
    // ignore cleanup errors
  }
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

async function transcodeSegment(
  inputPath: string,
  outputPath: string,
  ffmpegPath: string,
  startTimeSec?: number,
  durationSec?: number
): Promise<void> {
  const args = ['-y'];

  if (Number.isFinite(startTimeSec)) {
    args.push('-ss', String(startTimeSec));
  }

  args.push('-i', inputPath);

  if (Number.isFinite(durationSec)) {
    args.push('-t', String(durationSec));
  }

  args.push('-ar', '16000', '-ac', '1', '-b:a', '64k', outputPath);

  await runCommand(ffmpegPath, args, { toolName: 'ffmpeg' });
}

async function splitAudioToSegments(
  inputPath: string,
  baseName: string,
  ffmpegPath: string,
  ffprobePath: string
): Promise<SegmentTask[]> {
  const totalDuration = await getAudioDuration(inputPath, ffprobePath);

  if (totalDuration <= MIN_DURATION_FOR_SPLIT) {
    const outputPath = path.join(UPLOAD_DIR, `${baseName}_seg0.mp3`);
    await transcodeSegment(inputPath, outputPath, ffmpegPath);

    return [
      {
        path: outputPath,
        durationMs: Math.max(1, Math.round(totalDuration * 1000)),
        index: 0,
      },
    ];
  }

  const tasks: SegmentTask[] = [];
  let startTime = 0;
  let index = 0;

  while (startTime < totalDuration) {
    const duration = Math.min(SEGMENT_DURATION_SEC, totalDuration - startTime);
    const outputPath = path.join(UPLOAD_DIR, `${baseName}_seg${index}.mp3`);

    await transcodeSegment(inputPath, outputPath, ffmpegPath, startTime, duration);

    tasks.push({
      path: outputPath,
      durationMs: Math.max(1, Math.round(duration * 1000)),
      index,
    });

    startTime += SEGMENT_DURATION_SEC;
    index += 1;
  }

  return tasks;
}

function extractTextFromSyncResponse(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';

  const root = payload as Record<string, unknown>;
  const output = root.output as Record<string, unknown> | undefined;

  const directText = output?.text;
  if (typeof directText === 'string' && directText.trim()) {
    return directText.trim();
  }

  const choices = output?.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const firstChoice = choices[0] as Record<string, unknown>;
    const message = firstChoice.message as Record<string, unknown> | undefined;
    const content = message?.content;

    if (typeof content === 'string' && content.trim()) {
      return content.trim();
    }

    if (Array.isArray(content)) {
      const textParts = content
        .map((item) => {
          if (!item || typeof item !== 'object') return '';
          const text = (item as Record<string, unknown>).text;
          return typeof text === 'string' ? text.trim() : '';
        })
        .filter(Boolean);

      if (textParts.length > 0) {
        return textParts.join(' ').trim();
      }
    }
  }

  return '';
}

function normalizeSyncErrorText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return 'unknown error';
  return trimmed.length > 600 ? `${trimmed.slice(0, 600)}...` : trimmed;
}

function isRetryableTurboError(status: number, text: string): boolean {
  if (status === 429 || status >= 500) return true;
  return /rate|limit|throttle|too many/i.test(text);
}

async function syncTranscribeSegment(
  fileUrl: string,
  apiKey: string,
  language: string,
  segmentIndex: number,
  contextHint: string
): Promise<SegmentResult> {
  const messages: Array<{ role: 'system' | 'user'; content: Array<{ audio?: string; text?: string }> }> = [];
  if (contextHint) {
    messages.push({
      role: 'system',
      content: [
        {
          text: `你正在转写课堂音频。以下是课程背景与术语表，请优先按该上下文识别专业词汇：${contextHint}`,
        },
      ],
    });
  }
  messages.push({
    role: 'user',
    content: [{ audio: fileUrl }],
  });

  const requestBody = {
    model: 'qwen3-asr-flash',
    input: {
      messages,
    },
    parameters: {
      asr_options: {
        language,
        enable_itn: true,
      },
    },
  };

  let lastError = 'unknown error';

  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    if (attempt > 0) {
      const delay = Math.pow(2, attempt) * 600;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    try {
      const response = await fetch(SYNC_ASR_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      const responseText = await response.text();
      if (!response.ok) {
        lastError = normalizeSyncErrorText(responseText || `HTTP ${response.status}`);
        if (attempt < MAX_RETRIES - 1 && isRetryableTurboError(response.status, responseText)) {
          continue;
        }
        return {
          ok: false,
          error: `segment ${segmentIndex}: ${lastError}`,
        };
      }

      let payload: unknown = null;
      try {
        payload = JSON.parse(responseText);
      } catch {
        lastError = 'invalid json response';
        if (attempt < MAX_RETRIES - 1) {
          continue;
        }
        return {
          ok: false,
          error: `segment ${segmentIndex}: ${lastError}`,
        };
      }

      const text = extractTextFromSyncResponse(payload);
      if (!text) {
        lastError = 'empty transcription';
        if (attempt < MAX_RETRIES - 1) {
          continue;
        }
        return {
          ok: false,
          error: `segment ${segmentIndex}: ${lastError}`,
        };
      }

      return {
        ok: true,
        sentence: {
          text,
          begin_time: 0,
          end_time: 0,
        },
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt >= MAX_RETRIES - 1) {
        return {
          ok: false,
          error: `segment ${segmentIndex}: ${lastError}`,
        };
      }
    }
  }

  return {
    ok: false,
    error: `segment ${segmentIndex}: ${lastError}`,
  };
}

async function processSegmentBatch(
  tasks: SegmentTask[],
  apiKey: string,
  language: string,
  publicBaseUrl: string,
  contextHint: string
): Promise<{ ok: boolean; sentences: ASRSentence[]; error?: string }> {
  const sorted = [...tasks].sort((a, b) => a.index - b.index);
  const sentences: ASRSentence[] = [];
  const errors: string[] = [];
  const batchSize = Number.isFinite(BATCH_SIZE) && BATCH_SIZE > 0 ? BATCH_SIZE : 8;

  const resultByIndex = new Map<number, SegmentResult>();

  for (let start = 0; start < sorted.length; start += batchSize) {
    const batch = sorted.slice(start, start + batchSize);

    const batchResults = await Promise.all(
      batch.map(async (task) => {
        const fileName = path.basename(task.path);
        const fileUrl = `${publicBaseUrl}/temp-audio/${encodeURIComponent(fileName)}`;
        const result = await syncTranscribeSegment(fileUrl, apiKey, language, task.index, contextHint);
        return { index: task.index, result };
      })
    );

    for (const item of batchResults) {
      resultByIndex.set(item.index, item.result);
    }

    if (start + batchSize < sorted.length) {
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
  }

  let offset = 0;
  for (const task of sorted) {
    const result = resultByIndex.get(task.index);

    if (result?.ok && result.sentence) {
      sentences.push({
        text: result.sentence.text,
        begin_time: offset,
        end_time: offset + task.durationMs,
      });
    } else {
      errors.push(result?.error || `segment ${task.index}: unknown failure`);
    }

    offset += task.durationMs;
  }

  if (sentences.length === 0) {
    return {
      ok: false,
      sentences: [],
      error: errors[0] || 'all segments failed',
    };
  }

  // 当多数分段失败时（成功率 < 50%），视为整体失败，让调用方 fallback 到其他 ASR 模式。
  // 典型场景：DashScope 无法通过公网 URL 下载分段音频，只有第一个分段偶然成功。
  const successRate = sentences.length / sorted.length;
  if (sorted.length > 1 && successRate < 0.5) {
    console.warn(
      `[transcribe-turbo] low segment success rate: ${sentences.length}/${sorted.length} (${(successRate * 100).toFixed(0)}%), treating as failure`
    );
    return {
      ok: false,
      sentences,
      error: `only ${sentences.length}/${sorted.length} segments succeeded (${(successRate * 100).toFixed(0)}%) | ${errors.slice(0, 3).join(' | ')}`,
    };
  }

  return {
    ok: true,
    sentences,
    error: errors.length > 0 ? errors.slice(0, 3).join(' | ') : undefined,
  };
}

export async function POST(request: NextRequest) {
  const rateLimitResponse = await applyRateLimit(request, 'transcribe');
  if (rateLimitResponse) return rateLimitResponse;

  const tempFiles = new Set<string>();

  try {
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: '服务未配置转写密钥', code: 'ASR_API_KEY_MISSING' }, { status: 500 });
    }

    const publicBase = resolvePublicBaseUrl();
    if (!publicBase.ok || !publicBase.baseUrl) {
      return NextResponse.json(
        {
          error: '服务端未配置可访问的公网地址，暂时无法转写',
          code: 'ASR_PUBLIC_HOST_MISSING',
          detail: publicBase.error,
        },
        { status: 500 }
      );
    }

    ensureUploadDir();
    cleanupOldFiles();

    const formData = await request.formData();
    const audioFile = formData.get('audio') as File | null;
    const language = (formData.get('language') as string) || 'zh';
    const contextHint = sanitizeASRContext(formData.get('context'));

    if (!audioFile) {
      return NextResponse.json({ error: '未提供音频文件', code: 'ASR_AUDIO_MISSING' }, { status: 400 });
    }

    if (audioFile.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: '文件过大', code: 'ASR_AUDIO_TOO_LARGE' }, { status: 400 });
    }

    const timestamp = Date.now();
    const randomId = Math.random().toString(36).slice(2, 8);
    const ext = path.extname(audioFile.name) || '.mp3';
    const baseName = `turbo_${timestamp}_${randomId}`;
    const originalPath = path.join(UPLOAD_DIR, `${baseName}${ext}`);

    const bytes = Buffer.from(await audioFile.arrayBuffer());
    fs.writeFileSync(originalPath, bytes);
    tempFiles.add(originalPath);

    const ffmpegPath = resolveFfmpegPath();
    const ffprobePath = resolveFfprobePath(ffmpegPath);

    const segmentTasks = await splitAudioToSegments(originalPath, baseName, ffmpegPath, ffprobePath);
    for (const task of segmentTasks) {
      tempFiles.add(task.path);
    }

    const turboResult = await processSegmentBatch(segmentTasks, apiKey, language, publicBase.baseUrl, contextHint);

    if (!turboResult.ok) {
      return NextResponse.json(
        {
          error: '转写失败',
          code: 'ASR_TURBO_TASK_FAILED',
          detail: turboResult.error,
        },
        { status: 500 }
      );
    }

    const segments = turboResult.sentences.map((sentence, index) => ({
      id: `seg-${index}`,
      text: sentence.text.trim(),
      startMs: sentence.begin_time ?? sentence.start_time ?? 0,
      endMs: sentence.end_time ?? 0,
      confidence: 0.95,
      isFinal: true,
    }));

    const totalDuration = segments.length > 0 ? segments[segments.length - 1].endMs : 0;
    const text = segments.map((segment) => segment.text).join('');

    return NextResponse.json({
      success: true,
      text,
      sentences: segments.map((segment) => ({
        id: segment.id,
        text: segment.text,
        beginTime: segment.startMs,
        endTime: segment.endMs,
      })),
      totalDuration,
      segments,
      language,
      mode: 'turbo-sync',
      warning: turboResult.error,
      contextHintUsed: Boolean(contextHint),
    });
  } catch (error) {
    if (
      error instanceof MediaToolError &&
      (isToolNotFoundError(error, 'ffmpeg') || isToolNotFoundError(error, 'ffprobe'))
    ) {
      return NextResponse.json(
        {
          error: '服务端未安装 ffmpeg/ffprobe，无法处理音频',
          code: 'FFMPEG_NOT_FOUND',
          detail: error.detail || error.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        error: '极速转写服务异常',
        code: 'ASR_TURBO_INTERNAL_ERROR',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  } finally {
    for (const filePath of tempFiles) {
      safeUnlink(filePath);
    }
  }
}

export const maxDuration = 600;
