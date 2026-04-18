import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { applyRateLimit } from '@/lib/utils/rate-limit';
import { createLogger } from '@/lib/logger';
import {
  MediaToolError,
  isToolNotFoundError,
  resolvePublicBaseUrl,
  transcodeToMp3,
} from '@/lib/services/media-tooling';

const log = createLogger('transcribe');

const MAX_FILE_SIZE = 500 * 1024 * 1024;
const SUPPORTED_AUDIO_FORMATS = [
  'audio/mpeg',
  'audio/mp3',
  'audio/x-m4a',
  'audio/mp4',
  'audio/wav',
  'audio/webm',
  'audio/ogg',
  'audio/flac',
];
const SUPPORTED_VIDEO_FORMATS = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-m4v',
  'video/mpeg',
  'video/ogg',
];

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'temp-audio');
const DASHSCOPE_API_BASE = 'https://dashscope.aliyuncs.com/api/v1';
const ASR_TRANSCRIPTION_URL = `${DASHSCOPE_API_BASE}/services/audio/asr/transcription`;
const TASK_QUERY_URL = `${DASHSCOPE_API_BASE}/tasks`;
const MAX_ASR_CONTEXT_CHARS = 4000;

interface ASRSentence {
  text: string;
  start_time?: number;
  end_time?: number;
  begin_time?: number;
}

interface TaskResult {
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
  transcription_url?: string;
  result?: {
    transcripts?: Array<{
      sentences?: ASRSentence[];
      text?: string;
    }>;
  };
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
    const maxAge = 2 * 60 * 60 * 1000;

    for (const file of files) {
      const filePath = path.join(UPLOAD_DIR, file);
      try {
        const stats = fs.statSync(filePath);
        if (now - stats.mtimeMs > maxAge) {
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

function safeUnlink(filePath: string) {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // ignore
  }
}

async function submitAsyncTask(
  fileUrl: string,
  apiKey: string,
  language: string,
  contextHint: string
): Promise<{ success: boolean; taskId?: string; error?: string }> {
  const requestBody = {
    model: 'qwen3-asr-flash-filetrans',
    input: {
      file_url: fileUrl,
    },
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

  const responseText = await response.text();
  if (!response.ok) {
    return { success: false, error: `HTTP ${response.status}: ${responseText}` };
  }

  try {
    const data = JSON.parse(responseText) as { output?: { task_id?: string } };
    const taskId = data.output?.task_id;
    if (!taskId) {
      return { success: false, error: `missing task_id: ${responseText}` };
    }
    return { success: true, taskId };
  } catch {
    return { success: false, error: `invalid submit response: ${responseText}` };
  }
}

async function queryTaskStatus(taskId: string, apiKey: string): Promise<TaskResult> {
  const response = await fetch(`${TASK_QUERY_URL}/${taskId}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  const text = await response.text();
  if (!response.ok) {
    return {
      status: 'UNKNOWN',
      error: `HTTP ${response.status}: ${text}`,
    };
  }

  try {
    const data = JSON.parse(text) as {
      output?: {
        task_status?: TaskResult['status'];
        result?: { transcription_url?: string; transcripts?: Array<{ sentences?: ASRSentence[]; text?: string }> };
        message?: string;
      };
      message?: string;
    };

    const status = data.output?.task_status || 'UNKNOWN';
    if (status === 'SUCCEEDED') {
      return {
        status,
        transcription_url: data.output?.result?.transcription_url,
        result: data.output?.result,
      };
    }

    if (status === 'FAILED') {
      return {
        status,
        error: data.output?.message || data.message || 'task failed',
      };
    }

    return { status };
  } catch {
    return {
      status: 'UNKNOWN',
      error: `invalid query response: ${text}`,
    };
  }
}

async function fetchTranscriptionResult(url: string): Promise<ASRSentence[]> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`fetch result failed: HTTP ${response.status}`);
  }

  const data = (await response.json()) as {
    transcripts?: Array<{ sentences?: ASRSentence[] }>;
    output?: { transcripts?: Array<{ sentences?: ASRSentence[] }> };
  };

  const sentences: ASRSentence[] = [];
  const transcripts = data.transcripts || data.output?.transcripts || [];
  for (const transcript of transcripts) {
    if (Array.isArray(transcript.sentences)) {
      sentences.push(...transcript.sentences);
    }
  }

  return sentences;
}

async function waitForTask(
  taskId: string,
  apiKey: string,
  maxWaitMs: number = 50 * 60 * 1000,
  pollIntervalMs: number = 5000
): Promise<{ success: boolean; sentences: ASRSentence[]; error?: string; elapsedMs?: number }> {
  const start = Date.now();
  let lastStatus: TaskResult['status'] | 'UNKNOWN' = 'UNKNOWN';
  let pollCount = 0;

  while (Date.now() - start < maxWaitMs) {
    const status = await queryTaskStatus(taskId, apiKey);
    pollCount += 1;

    if (status.status !== lastStatus) {
      log.info('[transcribe] task status changed', {
        taskId,
        from: lastStatus,
        to: status.status,
        elapsedSec: Math.round((Date.now() - start) / 1000),
        pollCount,
      });
      lastStatus = status.status;
    }

    if (status.status === 'SUCCEEDED') {
      const elapsedMs = Date.now() - start;
      if (status.transcription_url) {
        const sentences = await fetchTranscriptionResult(status.transcription_url);
        return { success: true, sentences, elapsedMs };
      }

      const directSentences: ASRSentence[] = [];
      const transcripts = status.result?.transcripts || [];
      for (const transcript of transcripts) {
        if (Array.isArray(transcript.sentences)) {
          directSentences.push(...transcript.sentences);
        }
      }
      return { success: true, sentences: directSentences, elapsedMs };
    }

    if (status.status === 'FAILED') {
      return { success: false, sentences: [], error: status.error || 'task failed', elapsedMs: Date.now() - start };
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  return { success: false, sentences: [], error: `task timeout after ${Math.round((Date.now() - start) / 1000)}s`, elapsedMs: Date.now() - start };
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  log.info('[transcribe] POST received');

  const rateLimitResponse = await applyRateLimit(request, 'transcribe');
  if (rateLimitResponse) {
    log.warn('[transcribe] rate limited');
    return rateLimitResponse;
  }

  let originalFilePath = '';
  let transcribeFilePath = '';

  try {
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey) {
      log.error('[transcribe] DASHSCOPE_API_KEY missing');
      return NextResponse.json({ error: '服务未配置转写密钥', code: 'ASR_API_KEY_MISSING' }, { status: 500 });
    }

    const publicBase = resolvePublicBaseUrl();
    if (!publicBase.ok || !publicBase.baseUrl) {
      log.error('[transcribe] public base url missing', { detail: publicBase.error });
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
      log.warn('[transcribe] no audio in formData');
      return NextResponse.json({ error: '未提供音频或视频文件', code: 'ASR_AUDIO_MISSING' }, { status: 400 });
    }

    log.info('[transcribe] file received', {
      name: audioFile.name,
      type: audioFile.type,
      sizeMB: (audioFile.size / 1024 / 1024).toFixed(1),
      hasContext: Boolean(contextHint),
    });

    const isAudio = audioFile.type.startsWith('audio/') || SUPPORTED_AUDIO_FORMATS.includes(audioFile.type);
    const isVideo = audioFile.type.startsWith('video/') || SUPPORTED_VIDEO_FORMATS.includes(audioFile.type);
    if (!isAudio && !isVideo) {
      log.warn('[transcribe] unsupported format', { type: audioFile.type });
      return NextResponse.json(
        {
          error: `不支持的文件格式: ${audioFile.type}`,
          code: 'ASR_MEDIA_FORMAT_UNSUPPORTED',
        },
        { status: 400 }
      );
    }

    if (audioFile.size > MAX_FILE_SIZE) {
      log.warn('[transcribe] file too large', { sizeMB: (audioFile.size / 1024 / 1024).toFixed(1) });
      return NextResponse.json(
        {
          error: `文件过大 (${(audioFile.size / 1024 / 1024).toFixed(1)}MB)，最大支持 500MB`,
          code: 'ASR_AUDIO_TOO_LARGE',
        },
        { status: 400 }
      );
    }

    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 8);
    const ext = path.extname(audioFile.name) || (isVideo ? '.mp4' : '.mp3');
    const fileName = `media_${timestamp}_${randomId}${ext}`;
    originalFilePath = path.join(UPLOAD_DIR, fileName);

    const arrayBuffer = await audioFile.arrayBuffer();
    fs.writeFileSync(originalFilePath, Buffer.from(arrayBuffer));
    log.info('[transcribe] file persisted', { path: originalFilePath });

    if (isVideo) {
      transcribeFilePath = path.join(UPLOAD_DIR, `media_${timestamp}_${randomId}.mp3`);
      log.info('[transcribe] transcoding video to mp3');
      await transcodeToMp3(originalFilePath, transcribeFilePath);
    } else {
      transcribeFilePath = originalFilePath;
    }

    const fileUrl = `${publicBase.baseUrl}/temp-audio/${path.basename(transcribeFilePath)}`;
    log.info('[transcribe] submitting DashScope async task', { fileUrl });

    const submitted = await submitAsyncTask(fileUrl, apiKey, language, contextHint);
    if (!submitted.success || !submitted.taskId) {
      log.error('[transcribe] submit failed', { detail: submitted.error });
      return NextResponse.json(
        {
          error: '提交转写任务失败',
          code: 'ASR_SUBMIT_FAILED',
          detail: submitted.error,
        },
        { status: 500 }
      );
    }

    log.info('[transcribe] task submitted, start polling', { taskId: submitted.taskId });
    const taskResult = await waitForTask(submitted.taskId, apiKey);

    if (!taskResult.success) {
      log.error('[transcribe] task failed', {
        taskId: submitted.taskId,
        error: taskResult.error,
        elapsedSec: taskResult.elapsedMs ? Math.round(taskResult.elapsedMs / 1000) : undefined,
      });
      return NextResponse.json(
        {
          error: '转写失败',
          code: 'ASR_TASK_FAILED',
          detail: taskResult.error,
        },
        { status: 500 }
      );
    }

    const segments = taskResult.sentences.map((sentence, index) => ({
      id: `seg-${index}`,
      text: sentence.text.trim(),
      startMs: sentence.begin_time ?? sentence.start_time ?? 0,
      endMs: sentence.end_time ?? 0,
      confidence: 0.95,
      isFinal: true,
    }));

    const totalDuration = segments.length > 0 ? segments[segments.length - 1].endMs : 0;
    const text = segments.map((segment) => segment.text).join('');

    log.info('[transcribe] task succeeded', {
      taskId: submitted.taskId,
      segmentCount: segments.length,
      totalDurationSec: Math.round(totalDuration / 1000),
      elapsedSec: taskResult.elapsedMs ? Math.round(taskResult.elapsedMs / 1000) : undefined,
      totalElapsedSec: Math.round((Date.now() - startedAt) / 1000),
    });

    return NextResponse.json({
      success: true,
      text,
      sentences: segments.map((segment) => ({
        id: segment.id,
        text: segment.text,
        beginTime: segment.startMs,
        endTime: segment.endMs,
        confidence: segment.confidence,
      })),
      totalDuration,
      segments,
      language,
      contextHintUsed: Boolean(contextHint),
    });
  } catch (error) {
    if (
      error instanceof MediaToolError &&
      (isToolNotFoundError(error, 'ffmpeg') || isToolNotFoundError(error, 'ffprobe'))
    ) {
      log.error('[transcribe] ffmpeg/ffprobe missing', error);
      return NextResponse.json(
        {
          error: '服务端未安装 ffmpeg/ffprobe，暂时无法处理视频文件转写',
          code: 'FFMPEG_NOT_FOUND',
          detail: error.detail || error.message,
        },
        { status: 500 }
      );
    }

    log.error('[transcribe] internal error', error);
    return NextResponse.json(
      {
        error: '转写服务异常',
        code: 'ASR_INTERNAL_ERROR',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  } finally {
    if (transcribeFilePath && transcribeFilePath !== originalFilePath) {
      safeUnlink(transcribeFilePath);
    }
    if (originalFilePath) {
      safeUnlink(originalFilePath);
    }
  }
}

export const maxDuration = 3600;
