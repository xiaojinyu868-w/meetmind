/**
 * 说话人分离（Speaker Diarization）— DashScope 非实时 Fun-ASR
 *
 * 用 Fun-ASR 非实时 API + diarization_enabled: true，
 * 对已上传的录音做说话人分离，返回带 speaker_id 的句子列表。
 *
 * 与实时 ASR（qwen3-asr-flash-realtime）的关系：
 *   - 实时 ASR 不动，继续负责录课中的流式转录
 *   - 录音结束后，把音频提交给 Fun-ASR 非实时 API 做说话人分离
 *   - 拿到 speaker_id 后按时间戳合并到已有 TranscriptSegment
 *
 * DashScope 非实时 API 流程：
 *   POST /api/v1/services/audio/asr/transcription (X-DashScope-Async: enable)
 *     → 返回 task_id
 *   GET  /api/v1/tasks/{task_id}  (轮询)
 *     → SUCCEEDED 后从 transcription_url 拉取完整结果
 *
 * 返回结构（Fun-ASR + diarization）：
 *   { transcripts: [{ sentences: [{ text, begin_time, end_time, speaker_id }] }] }
 */

import { createLogger } from '@/lib/logger';

const log = createLogger('diarization');

const DASHSCOPE_API_BASE = 'https://dashscope.aliyuncs.com/api/v1';
const ASR_TRANSCRIPTION_URL = `${DASHSCOPE_API_BASE}/services/audio/asr/transcription`;
const TASK_QUERY_URL = `${DASHSCOPE_API_BASE}/tasks`;

/** 带说话人标识的句子 */
export interface DiarizationSentence {
  text: string;
  beginTime: number;
  endTime: number;
  speakerId: number;
}

export interface DiarizationResult {
  success: boolean;
  sentences: DiarizationSentence[];
  /** 识别到的说话人总数（speaker_id 最大值 + 1） */
  speakerCount: number;
  error?: string;
}

/**
 * 提交说话人分离任务
 *
 * 模型选 fun-asr（阿里云官方推荐支持说话人分离 + 热词的模型）。
 * 可通过环境变量 DASHSCOPE_DIARIZATION_MODEL 覆盖。
 */
export async function submitDiarizationTask(
  fileUrl: string,
  apiKey: string,
  language: string = 'zh',
): Promise<{ success: boolean; taskId?: string; error?: string }> {
  const model = process.env.DASHSCOPE_DIARIZATION_MODEL || 'fun-asr';

  const requestBody = {
    model,
    input: {
      file_urls: [fileUrl],
    },
    parameters: {
      diarization_enabled: true,
      language,
      enable_itn: true,
    },
  };

  log.info('Submitting diarization task', { model, language, fileUrl });

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
    log.error('Diarization submit failed', { status: response.status, body: responseText });
    return { success: false, error: responseText };
  }

  const data = JSON.parse(responseText);
  const taskId = data.output?.task_id;

  if (!taskId) {
    return { success: false, error: '未获取到任务 ID' };
  }

  return { success: true, taskId };
}

/**
 * 查询说话人分离任务状态
 */
async function queryDiarizationTask(
  taskId: string,
  apiKey: string,
): Promise<{
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
  transcriptionUrl?: string;
  error?: string;
}> {
  const response = await fetch(`${TASK_QUERY_URL}/${taskId}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  const responseText = await response.text();

  if (!response.ok) {
    return { status: 'UNKNOWN', error: responseText };
  }

  const data = JSON.parse(responseText);
  const taskStatus = data.output?.task_status || 'UNKNOWN';

  if (taskStatus === 'SUCCEEDED') {
    return {
      status: 'SUCCEEDED',
      transcriptionUrl: data.output?.result?.transcription_url,
    };
  }

  if (taskStatus === 'FAILED') {
    return {
      status: 'FAILED',
      error: data.output?.message || data.message || '任务失败',
    };
  }

  return { status: taskStatus };
}

/**
 * 从 transcription_url 拉取完整结果，解析出带 speaker_id 的句子
 */
async function fetchDiarizationResult(url: string): Promise<DiarizationResult> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`fetch diarization result failed: HTTP ${response.status}`);
  }

  const data = (await response.json()) as {
    transcripts?: Array<{
      sentences?: Array<{
        text?: string;
        begin_time?: number;
        end_time?: number;
        speaker_id?: number;
      }>;
    }>;
  };

  const sentences: DiarizationSentence[] = [];
  let maxSpeakerId = -1;

  const transcripts = Array.isArray(data.transcripts) ? data.transcripts : [];

  for (const transcript of transcripts) {
    const ts = Array.isArray(transcript.sentences) ? transcript.sentences : [];
    for (const s of ts) {
      const speakerId = typeof s.speaker_id === 'number' ? s.speaker_id : 0;
      sentences.push({
        text: s.text || '',
        beginTime: s.begin_time ?? 0,
        endTime: s.end_time ?? 0,
        speakerId,
      });
      if (speakerId > maxSpeakerId) maxSpeakerId = speakerId;
    }
  }

  return {
    success: sentences.length > 0,
    sentences,
    speakerCount: maxSpeakerId + 1,
    error: sentences.length > 0 ? undefined : '说话人分离结果为空',
  };
}

/**
 * 等待说话人分离任务完成（轮询）
 *
 * 最长等待 10 分钟，每 3 秒轮询一次。
 * 一节课的音频通常 1-5 分钟处理完。
 */
export async function waitForDiarizationTask(
  taskId: string,
  apiKey: string,
  maxWaitMs: number = 600_000,
  pollIntervalMs: number = 3_000,
): Promise<DiarizationResult> {
  const startTime = Date.now();
  let pollCount = 0;

  while (Date.now() - startTime < maxWaitMs) {
    pollCount++;
    const result = await queryDiarizationTask(taskId, apiKey);

    if (result.status === 'SUCCEEDED' && result.transcriptionUrl) {
      try {
        return await fetchDiarizationResult(result.transcriptionUrl);
      } catch (error) {
        return {
          success: false,
          sentences: [],
          speakerCount: 0,
          error: error instanceof Error ? error.message : '获取说话人分离结果失败',
        };
      }
    }

    if (result.status === 'FAILED') {
      return {
        success: false,
        sentences: [],
        speakerCount: 0,
        error: result.error || '说话人分离任务失败',
      };
    }

    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    if (pollCount % 5 === 0) {
      log.info('Diarization polling', { elapsed: `${elapsed}s`, pollCount, status: result.status });
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  return {
    success: false,
    sentences: [],
    speakerCount: 0,
    error: '说话人分离超时',
  };
}

/**
 * 一站式入口：提交 + 等待 + 返回结果
 */
export async function runDiarization(
  fileUrl: string,
  apiKey: string,
  language: string = 'zh',
): Promise<DiarizationResult> {
  const submit = await submitDiarizationTask(fileUrl, apiKey, language);
  if (!submit.success || !submit.taskId) {
    return { success: false, sentences: [], speakerCount: 0, error: submit.error };
  }

  log.info('Diarization task submitted', { taskId: submit.taskId });
  return waitForDiarizationTask(submit.taskId, apiKey);
}
