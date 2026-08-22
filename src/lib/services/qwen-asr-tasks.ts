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
const ASR_BATCH_SYNC_URL = `${DASHSCOPE_API_BASE}/services/aigc/multimodal-generation/generation`;
const TASK_QUERY_URL = `${DASHSCOPE_API_BASE}/tasks`;

// Re-export for main service
export { ASR_TRANSCRIPTION_URL };

/**
 * 新一代模型族（qwen-audio-3.0-* / fun-asr*）与旧 qwen3-asr-* 的 API 形状不同，按模型名前缀分派。
 * 改 DASHSCOPE_ASR_*_MODEL 环境变量即可回退旧模型，无需改代码。
 * 协议依据：
 * - 实时:   https://help.aliyun.com/zh/model-studio/real-time-speech-recognition-user-guide
 * - 非实时: https://help.aliyun.com/zh/model-studio/non-realtime-speech-recognition-user-guide
 * - filetrans HTTP API: https://help.aliyun.com/en/model-studio/fun-asr-recorded-speech-recognition-http-api
 */
export function isNextGenAsrModel(model: string): boolean {
  return /^(qwen-audio-3\.0|fun-asr)/i.test((model || '').trim());
}

/**
 * filetrans 提交体（按模型族分派）：
 * - 新族 qwen-audio-3.0-asr-flash-filetrans: input.file_urls（数组）+ parameters.language_hints（数组）。
 *   新族参数表没有 enable_itn / language（单数），不要下发旧字段。
 * - 旧族 qwen3-asr-flash-filetrans: input.file_url + parameters.language + enable_itn。
 * language='auto' 时两族都省略语种参数，让模型自动识别（M7.6 修复中英夹杂）。
 */
export function buildFiletransSubmitBody(
  model: string,
  fileUrl: string,
  language: string
): Record<string, unknown> {
  if (isNextGenAsrModel(model)) {
    const parameters: Record<string, unknown> = { channel_id: [0] };
    if (language && language !== 'auto') {
      parameters.language_hints = [language];
    }
    return {
      model,
      input: { file_urls: [fileUrl] },
      parameters,
    };
  }

  return {
    model,
    input: { file_url: fileUrl },
    parameters: {
      channel_id: [0],
      ...(language && language !== 'auto' ? { language } : {}),
      enable_itn: true,
    },
  };
}

/**
 * 任务查询结果里的转写 URL：新族在 output.results[0].transcription_url，
 * 旧族在 output.result.transcription_url。
 */
export function extractTranscriptionUrl(output: unknown): string | undefined {
  if (!output || typeof output !== 'object') return undefined;
  const record = output as {
    results?: Array<{ transcription_url?: string }>;
    result?: { transcription_url?: string };
  };
  return record.results?.[0]?.transcription_url || record.result?.transcription_url;
}

/**
 * 提交异步转录任务（qwen-audio-3.0-asr-flash-filetrans / qwen3-asr-flash-filetrans）
 */
export async function submitAsyncTask(
  fileUrl: string,
  apiKey: string,
  language: string = 'zh'
): Promise<{ success: boolean; taskId?: string; error?: string }> {

  const model = process.env.DASHSCOPE_ASR_FILE_MODEL || 'qwen-audio-3.0-asr-flash-filetrans';
  const requestBody = buildFiletransSubmitBody(model, fileUrl, language);

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
      transcriptionUrl: extractTranscriptionUrl(data.output),
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
 *
 * 按模型族分派：
 * - 新族 qwen-audio-3.0-asr-flash：POST multimodal-generation/generation，
 *   消息式 input_audio（data URI base64），响应文本在 output.text / output.output.sentence.text。
 * - 旧族 qwen3-asr-flash：POST audio/asr/transcription，input.audio base64。
 */
export async function transcribeWavChunk(
  wavBuffer: Buffer,
  apiKey: string,
  language: string
): Promise<{ success: boolean; sentences: ASRSentence[]; text: string; error?: string }> {
  const model = process.env.DASHSCOPE_ASR_BATCH_MODEL || 'qwen-audio-3.0-asr-flash';
  const audioBase64 = wavBuffer.toString('base64');

  if (isNextGenAsrModel(model)) {
    return transcribeWavChunkNextGen(model, audioBase64, apiKey, language);
  }

  const requestBody = {
    model,
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

/**
 * 新族（qwen-audio-3.0-asr-flash）短音频同步转写。
 * 请求/响应形状见官方文档"非实时语音识别" Qwen-Audio-3.0-ASR-Flash 章节：
 * 响应不是标准多模态 choices 结构，文本在 output.text 与 output.output.sentence.text。
 * 官方未公开该端点的语种参数，language 仅记录日志不下发。
 */
async function transcribeWavChunkNextGen(
  model: string,
  audioBase64: string,
  apiKey: string,
  language: string
): Promise<{ success: boolean; sentences: ASRSentence[]; text: string; error?: string }> {
  if (language && language !== 'auto') {
    log.info('[qwen-asr-tasks] next-gen batch model: language hint ignored (unsupported by sync API)', { model, language });
  }

  const requestBody = {
    model,
    input: {
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'input_audio',
              input_audio: {
                data: `data:audio/wav;base64,${audioBase64}`,
              },
            },
          ],
        },
      ],
    },
    parameters: {
      format: 'wav',
      // 官方 curl 示例中 sample_rate 为字符串，保持与文档一致
      sample_rate: '16000',
    },
  };

  const response = await fetch(ASR_BATCH_SYNC_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-DashScope-SSE': 'disable',
    },
    body: JSON.stringify(requestBody),
  });

  const responseText = await response.text();
  if (!response.ok) {
    return { success: false, sentences: [], text: '', error: responseText };
  }

  const data = JSON.parse(responseText);
  const output = data?.output ?? {};
  const sentence = output?.output?.sentence;
  const overallText: string =
    (typeof sentence?.text === 'string' && sentence.text.trim()) ||
    (typeof output?.text === 'string' ? output.text.trim() : '') || '';

  const sentences: ASRSentence[] = [];
  if (overallText) {
    sentences.push({
      id: 'seg-0',
      text: overallText,
      beginTime: typeof sentence?.begin_time === 'number' ? sentence.begin_time : 0,
      endTime: typeof sentence?.end_time === 'number' ? sentence.end_time : 0,
      confidence: 0.95,
    });
  }

  return {
    success: sentences.length > 0,
    sentences,
    text: overallText,
    error: sentences.length > 0 ? undefined : '新族 batch 响应为空',
  };
}
