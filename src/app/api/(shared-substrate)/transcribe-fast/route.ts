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
import { createLogger } from '@/lib/logger';
const log = createLogger('transcribe-fast');


const MAX_FILE_SIZE = 500 * 1024 * 1024;
const UPLOAD_DIR = path.join(process.cwd(), 'public', 'temp-audio');
const DASHSCOPE_API_BASE = 'https://dashscope.aliyuncs.com/api/v1';
const ASR_TRANSCRIPTION_URL = `${DASHSCOPE_API_BASE}/services/audio/asr/transcription`;
const TASK_QUERY_URL = `${DASHSCOPE_API_BASE}/tasks`;

const SEGMENT_DURATION_SEC = 180;
const MIN_DURATION_FOR_SPLIT = 240;
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
  ffprobePath: string
): Promise<{ segments: string[]; durations: number[] }> {
  const totalDuration = await getAudioDuration(inputPath, ffprobePath);

  if (totalDuration <= MIN_DURATION_FOR_SPLIT) {
    return { segments: [inputPath], durations: [totalDuration * 1000] };
  }

  const segments: string[] = [];
  const durations: number[] = [];
  const ext = path.extname(inputPath);

  let startTime = 0;
  let segIndex = 0;

  while (startTime < totalDuration) {
    const outputPath = path.join(outputDir, `${baseName}_seg${segIndex}${ext}`);
    const duration = Math.min(segmentDuration, totalDuration - startTime);

    try {
      await runCommand(
        ffmpegPath,
        ['-y', '-ss', String(startTime), '-i', inputPath, '-t', String(duration), '-c', 'copy', outputPath],
        { toolName: 'ffmpeg' }
      );
      segments.push(outputPath);
      durations.push(duration * 1000);
    } catch {
      await runCommand(
        ffmpegPath,
        ['-y', '-ss', String(startTime), '-i', inputPath, '-t', String(duration), outputPath],
        { toolName: 'ffmpeg' }
      );
      segments.push(outputPath);
      durations.push(duration * 1000);
    }

    startTime += segmentDuration;
    segIndex += 1;
  }

  return { segments, durations };
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
  maxWaitMs: number = 300000
): Promise<{ success: boolean; sentences: ASRSentence[]; error?: string }> {
  const startTime = Date.now();
  let pollInterval = 2000;
  const maxInterval = 5000;

  while (Date.now() - startTime < maxWaitMs) {
    const result = await queryTaskStatus(taskId, apiKey);

    if (result.status === 'SUCCEEDED' && result.transcription_url) {
      const sentences = await fetchTranscriptionResult(result.transcription_url);
      return { success: true, sentences };
    }

    if (result.status === 'FAILED') {
      return { success: false, sentences: [], error: result.error };
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
    pollInterval = Math.min(Math.floor(pollInterval * 1.2), maxInterval);
  }

  return { success: false, sentences: [], error: 'task timeout' };
}

async function processParallelTasks(
  segmentPaths: string[],
  segmentDurations: number[],
  apiKey: string,
  language: string,
  publicBaseUrl: string,
  contextHint: string
): Promise<{ success: boolean; allSentences: ASRSentence[]; error?: string }> {
  const submitResults = await Promise.all(
    segmentPaths.map(async (segPath) => {
      const fileName = path.basename(segPath);
      const fileUrl = `${publicBaseUrl}/temp-audio/${fileName}`;
      return submitAsyncTask(fileUrl, apiKey, language, contextHint);
    })
  );

  const taskIds: Array<string | null> = submitResults.map((result) =>
    result.success && result.taskId ? result.taskId : null
  );

  const submittedCount = taskIds.filter(Boolean).length;

  if (taskIds.every((taskId) => taskId === null)) {
    const firstError = submitResults.find((r) => r.error)?.error || 'unknown';
    log.error(`[transcribe-fast] all task submits failed, first error: ${firstError}`);
    return { success: false, allSentences: [], error: `all task submit failed: ${firstError}` };
  }

  const taskResults = await Promise.all(
    taskIds.map((taskId) => {
      if (!taskId) {
        return Promise.resolve({ success: false, sentences: [] as ASRSentence[], error: 'task not submitted' });
      }
      return waitForSingleTask(taskId, apiKey);
    })
  );

  const allSentences: ASRSentence[] = [];
  let timeOffset = 0;

  for (let index = 0; index < taskResults.length; index += 1) {
    const result = taskResults[index];
    if (result.success && result.sentences.length > 0) {
      const adjusted = result.sentences.map((sentence) => ({
        ...sentence,
        begin_time: (sentence.begin_time ?? sentence.start_time ?? 0) + timeOffset,
        end_time: (sentence.end_time ?? 0) + timeOffset,
      }));
      allSentences.push(...adjusted);
    }

    timeOffset += segmentDurations[index] || 0;
  }

  return {
    success: allSentences.length > 0,
    allSentences,
    error: allSentences.length > 0 ? undefined : 'no transcript produced',
  };
}

export async function POST(request: NextRequest) {
  const rateLimitResponse = await applyRateLimit(request, 'transcribe');
  if (rateLimitResponse) return rateLimitResponse;

  // 用于 finally 清理的临时文件集合
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
    const randomId = Math.random().toString(36).substring(2, 8);
    const ext = path.extname(audioFile.name) || '.mp3';
    const baseName = `audio_${timestamp}_${randomId}`;
    const originalPath = path.join(UPLOAD_DIR, `${baseName}${ext}`);

    const buffer = Buffer.from(await audioFile.arrayBuffer());
    fs.writeFileSync(originalPath, buffer);
    tempFiles.add(originalPath);

    const ffmpegPath = resolveFfmpegPath();
    const ffprobePath = resolveFfprobePath(ffmpegPath);

    const { segments, durations } = await splitAudio(
      originalPath,
      UPLOAD_DIR,
      SEGMENT_DURATION_SEC,
      baseName,
      ffmpegPath,
      ffprobePath
    );

    // 记录所有分段文件用于 finally 清理
    for (const segPath of segments) {
      tempFiles.add(segPath);
    }

    const result = await processParallelTasks(segments, durations, apiKey, language, publicBase.baseUrl, contextHint);

    if (!result.success) {
      return NextResponse.json(
        {
          error: '转写失败',
          code: 'ASR_FAST_TASK_FAILED',
          detail: result.error,
        },
        { status: 500 }
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
        error: '快速转写服务异常',
        code: 'ASR_FAST_INTERNAL_ERROR',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  } finally {
    // 确保所有临时文件被清理，无论成功还是异常
    for (const filePath of tempFiles) {
      safeUnlink(filePath);
    }
  }
}

export const maxDuration = 600;
