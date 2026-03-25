/**
 * Qwen ASR — 异步任务管理
 *
 * 从 qwen-asr-service.ts 提取，封装 DashScope API 的异步任务交互。
 */

import { createLogger } from '@/lib/logger';
import type { ASRSentence, ASRResult } from './qwen-asr-service';

const log = createLogger('qwen-asr-tasks');

// API 端点
const DASHSCOPE_API_BASE = 'https://dashscope.aliyuncs.com/api/v1';
const ASR_TRANSCRIPTION_URL = `${DASHSCOPE_API_BASE}/services/audio/asr/transcription`;
const TASK_QUERY_URL = `${DASHSCOPE_API_BASE}/tasks`;

// Re-export for main service
export { ASR_TRANSCRIPTION_URL };

/**
 * 提交异步转录任务 (qwen3-asr-flash-filetrans)
 */
export async function submitAsyncTask(
  fileUrl: string,
  apiKey: string,
  language: string = 'zh'
): Promise<{ success: boolean; taskId?: string; error?: string }> {

  const requestBody = {
    model: 'qwen3-asr-flash-filetrans',
    input: {
      file_url: fileUrl,
    },
    parameters: {
      channel_id: [0],
      language: language,
      enable_itn: true,
    },
  };

  const response = await fetch(ASR_TRANSCRIPTION_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-DashScope-Async': 'enable',
    },
    body: JSON.stringify(requestBody),
  });

  const responseText = await response.text();

  if (!response.ok) {
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
 * 查询异步任务状态
 */
export async function queryTaskStatus(
  taskId: string,
  apiKey: string
): Promise<{
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
  transcriptionUrl?: string;
  result?: { text?: string; sentences?: Array<{ text: string; start_time: number; end_time: number }> };
  error?: string;
}> {
  const response = await fetch(`${TASK_QUERY_URL}/${taskId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
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
      result: data.output?.result || data.output,
    };
  } else if (taskStatus === 'FAILED') {
    return {
      status: 'FAILED',
      error: data.output?.message || data.message || '任务失败',
    };
  }

  return { status: taskStatus };
}

/**
 * 获取异步转写结果（从 transcription URL）
 */
export async function fetchAsyncTranscriptionResult(url: string): Promise<ASRResult> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`fetch result failed: HTTP ${response.status}`);
  }

  const data = await response.json() as {
    transcripts?: Array<{
      text?: string;
      sentences?: Array<{
        text?: string;
        begin_time?: number;
        beginTime?: number;
        start_time?: number;
        end_time?: number;
        endTime?: number;
      }>;
    }>;
  };

  const sentences: ASRSentence[] = [];
  const transcripts = Array.isArray(data.transcripts) ? data.transcripts : [];

  for (const transcript of transcripts) {
    const transcriptSentences = Array.isArray(transcript.sentences) ? transcript.sentences : [];
    for (let i = 0; i < transcriptSentences.length; i++) {
      const sentence = transcriptSentences[i];
      sentences.push({
        id: `seg-${sentences.length}`,
        text: sentence.text || '',
        beginTime: sentence.begin_time ?? sentence.beginTime ?? sentence.start_time ?? 0,
        endTime: sentence.end_time ?? sentence.endTime ?? 0,
        confidence: 0.95,
      });
    }

    if (transcriptSentences.length === 0 && transcript.text) {
      sentences.push({
        id: `seg-${sentences.length}`,
        text: transcript.text,
        beginTime: 0,
        endTime: 0,
        confidence: 0.95,
      });
    }
  }

  return {
    success: sentences.length > 0,
    sentences,
    totalDuration: sentences[sentences.length - 1]?.endTime || 0,
    text: sentences.map((sentence) => sentence.text).join(' ').trim(),
    error: sentences.length > 0 ? undefined : '异步转写结果为空',
  };
}

/**
 * 等待异步任务完成（轮询）
 */
export async function waitForTask(
  taskId: string,
  apiKey: string,
  onProgress?: (status: string, progress?: number) => void,
  maxWaitMs: number = 600000,
  pollIntervalMs: number = 2000
): Promise<ASRResult> {
  const startTime = Date.now();
  let pollCount = 0;

  while (Date.now() - startTime < maxWaitMs) {
    pollCount++;
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    onProgress?.(`正在转录... (${elapsed}秒)`, pollCount);

    const result = await queryTaskStatus(taskId, apiKey);

    if (result.status === 'SUCCEEDED') {
      if (result.transcriptionUrl) {
        try {
          return await fetchAsyncTranscriptionResult(result.transcriptionUrl);
        } catch (error) {
          return {
            success: false,
            sentences: [],
            totalDuration: 0,
            error: error instanceof Error ? error.message : '获取异步转写结果失败',
          };
        }
      }

      if (result.result) {
        const sentences: ASRSentence[] = [];
        const resultSentences = result.result.sentences || [];

        for (let i = 0; i < resultSentences.length; i++) {
          const s = resultSentences[i];
          sentences.push({
            id: `seg-${i}`,
            text: s.text || '',
            beginTime: s.start_time ?? 0,
            endTime: s.end_time ?? 0,
            confidence: 0.95,
          });
        }

        if (sentences.length === 0 && result.result.text) {
          sentences.push({
            id: 'seg-0',
            text: result.result.text,
            beginTime: 0,
            endTime: 0,
          });
        }

        return {
          success: true,
          sentences,
          totalDuration: sentences[sentences.length - 1]?.endTime || 0,
          text: sentences.map(s => s.text).join(' '),
        };
      }
    }

    if (result.status === 'FAILED') {
      return {
        success: false,
        sentences: [],
        totalDuration: 0,
        error: result.error || '转录任务失败',
      };
    }

    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }

  return {
    success: false,
    sentences: [],
    totalDuration: 0,
    error: '转录超时',
  };
}

/**
 * 转录单个 WAV 分块（同步 API 调用）
 */
export async function transcribeWavChunk(
  wavBuffer: Buffer,
  apiKey: string,
  language: string
): Promise<{ success: boolean; sentences: ASRSentence[]; text: string; error?: string }> {
  const audioBase64 = wavBuffer.toString('base64');

  const requestBody = {
    model: 'qwen3-asr-flash',
    input: {
      audio: [
        {
          format: 'wav',
          content: audioBase64,
        },
      ],
    },
    parameters: {
      language: language,
      enable_punctuation: true,
    },
  };

  const response = await fetch(ASR_TRANSCRIPTION_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  const responseText = await response.text();

  if (!response.ok) {
    return { success: false, sentences: [], text: '', error: responseText };
  }

  const data = JSON.parse(responseText);
  const sentences: ASRSentence[] = [];
  const resultSentences = data.output?.results?.[0]?.sentences || data.sentences || [];
  const overallText = data.output?.results?.[0]?.text || data.text || '';

  if (Array.isArray(resultSentences) && resultSentences.length > 0) {
    for (let i = 0; i < resultSentences.length; i++) {
      const s = resultSentences[i];
      sentences.push({
        id: `seg-${i}`,
        text: s.text || '',
        beginTime: s.begin_time ?? s.beginTime ?? s.start_time ?? 0,
        endTime: s.end_time ?? s.endTime ?? 0,
        confidence: s.confidence ?? 0.95,
      });
    }
  } else if (overallText) {
    sentences.push({ id: 'seg-0', text: overallText, beginTime: 0, endTime: 0 });
  }

  return {
    success: true,
    sentences,
    text: sentences.map(s => s.text).join(' '),
  };
}
