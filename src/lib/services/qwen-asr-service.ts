/**
 * 通义千问 ASR 语音转录服务
 * 
 * 支持两种模式：
 * 1. qwen3-asr-flash（同步）- 适合短音频（≤5分钟）
 * 2. qwen3-asr-flash-filetrans（异步）- 适合长音频（≤12小时）
 * 
 * 异步模式需要提供公网可访问的音频 URL
 *
 * 子模块：
 *   qwen-asr-audio.ts — 音频格式转换（ffmpeg 交互）
 *   qwen-asr-tasks.ts — DashScope 异步任务管理 + 单块转录
 */

import { createLogger } from '@/lib/logger';

import { splitAudioToWavChunks, convertToMp3 } from './qwen-asr-audio';
import {
  submitAsyncTask,
  queryTaskStatus,
  waitForTask,
  transcribeWavChunk,
} from './qwen-asr-tasks';

const log = createLogger('qwen-asr');

// ============ 类型定义 ============

export interface ASRSentence {
  id: string;
  text: string;
  beginTime: number;
  endTime: number;
  confidence?: number;
}

export interface ASRResult {
  success: boolean;
  sentences: ASRSentence[];
  totalDuration: number;
  text?: string;
  error?: string;
}

export interface TranscribeOptions {
  sampleRate?: number;
  format?: string;
  language?: string;
  /** 使用异步模式（适合长音频） */
  async?: boolean;
  /** 异步模式需要的音频文件 URL */
  fileUrl?: string;
  /** 进度回调 */
  onProgress?: (status: string, progress?: number) => void;
}

// ============ 主入口 ============

/**
 * 使用 DashScope ASR 进行转写
 * 
 * 模式选择：
 * - 默认使用 qwen3-asr-flash 同步模式（自动分块处理长音频）
 * - 如果指定 async=true 且提供 fileUrl，使用异步模式
 */
export async function transcribeAudio(
  audioBlob: Blob,
  apiKey: string,
  options: TranscribeOptions = {}
): Promise<ASRResult> {
  const { language = 'zh', async: useAsync = false, fileUrl, onProgress } = options;

  // 如果明确指定异步模式且提供了 fileUrl，使用异步
  if (useAsync && fileUrl) {
    onProgress?.('提交转录任务...');
    
    const submitResult = await submitAsyncTask(fileUrl, apiKey, language);
    if (!submitResult.success || !submitResult.taskId) {
      return {
        success: false,
        sentences: [],
        totalDuration: 0,
        error: submitResult.error || '提交任务失败',
      };
    }
    
    onProgress?.('任务已提交，等待处理...');
    
    return waitForTask(submitResult.taskId, apiKey, onProgress);
  }

  // 同步模式：使用 qwen3-asr-flash（分块处理长音频）
  try {
    onProgress?.('转换音频格式...');
    
    let chunks: Buffer[];
    let durations: number[];
    
    try {
      const result = await splitAudioToWavChunks(audioBlob);
      chunks = result.chunks;
      durations = result.durations;
    } catch (error) {
      log.error('[QwenASR] Audio conversion failed:', error);
      return {
        success: false,
        sentences: [],
        totalDuration: 0,
        error: `音频转换失败: ${error instanceof Error ? error.message : '未知错误'}`,
      };
    }

    // 逐块转录
    const allSentences: ASRSentence[] = [];
    let timeOffset = 0;
    let sentenceIndex = 0;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkDuration = durations[i] * 1000;
      
      onProgress?.(`正在转录... (${i + 1}/${chunks.length})`);

      const result = await transcribeWavChunk(chunk, apiKey, language);
      
      if (!result.success) {
        log.error(`[QwenASR] Chunk ${i + 1} failed`, result.error);
        timeOffset += chunkDuration;
        continue;
      }

      for (const s of result.sentences) {
        allSentences.push({
          id: `seg-${sentenceIndex++}`,
          text: s.text,
          beginTime: s.beginTime + timeOffset,
          endTime: s.endTime + timeOffset,
          confidence: s.confidence,
        });
      }

      timeOffset += chunkDuration;
    }

    if (allSentences.length === 0) {
      return {
        success: false,
        sentences: [],
        totalDuration: 0,
        error: '未能提取转录文本',
      };
    }

    return {
      success: true,
      sentences: allSentences,
      totalDuration: allSentences[allSentences.length - 1]?.endTime || timeOffset,
      text: allSentences.map(s => s.text).join(' '),
    };

  } catch (error) {
    log.error('[QwenASR] Error:', error);
    return {
      success: false,
      sentences: [],
      totalDuration: 0,
      error: error instanceof Error ? error.message : '转录失败',
    };
  }
}

// ============ 工具函数 ============

/**
 * 根据时间戳找到对应的句子
 */
export function findSentenceAtTimestamp(
  sentences: ASRSentence[],
  timestamp: number,
  contextRange: number = 30000
): {
  current: ASRSentence | null;
  context: ASRSentence[];
  contextText: string;
} {
  const current = sentences.find(
    s => s.beginTime <= timestamp && s.endTime >= timestamp
  ) || sentences.find(
    s => Math.abs(s.beginTime - timestamp) < 5000 || Math.abs(s.endTime - timestamp) < 5000
  ) || null;

  const startTime = Math.max(0, timestamp - contextRange);
  const endTime = timestamp + contextRange;
  
  const context = sentences.filter(
    s => s.endTime >= startTime && s.beginTime <= endTime
  );

  const contextText = context.map(s => s.text).join(' ');

  return { current, context, contextText };
}

/**
 * 将 ASRSentence 转换为 TranscriptSegment 格式
 */
export function toTranscriptSegments(sentences: ASRSentence[]): Array<{
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  confidence: number;
  isFinal: boolean;
}> {
  return sentences.map(s => ({
    id: s.id,
    text: s.text,
    startMs: s.beginTime,
    endMs: s.endTime,
    confidence: s.confidence || 0.95,
    isFinal: true,
  }));
}

// ============ 服务单例 ============

export const qwenASRService = {
  async transcribe(audioBlob: Blob, apiKey: string, options?: TranscribeOptions): Promise<ASRResult> {
    return transcribeAudio(audioBlob, apiKey, options);
  },
  
  async submitAsyncTask(fileUrl: string, apiKey: string, language?: string) {
    return submitAsyncTask(fileUrl, apiKey, language);
  },
  
  async queryTask(taskId: string, apiKey: string) {
    return queryTaskStatus(taskId, apiKey);
  },
  
  async waitForTask(taskId: string, apiKey: string, onProgress?: (status: string) => void) {
    return waitForTask(taskId, apiKey, onProgress);
  },
  
  async convertToMp3(audioBlob: Blob) {
    return convertToMp3(audioBlob);
  },
  
  findAtTimestamp: findSentenceAtTimestamp,
  toSegments: toTranscriptSegments,
};

export default qwenASRService;
