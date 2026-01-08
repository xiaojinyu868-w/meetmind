/**
 * 通义千问 ASR 语音转录服务
 * 
 * 支持两种模式：
 * 1. qwen3-asr-flash（同步）- 适合短音频（≤5分钟）
 * 2. qwen3-asr-flash-filetrans（异步）- 适合长音频（≤12小时）
 * 
 * 异步模式需要提供公网可访问的音频 URL
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

// API 端点
const DASHSCOPE_API_BASE = 'https://dashscope.aliyuncs.com/api/v1';
const ASR_TRANSCRIPTION_URL = `${DASHSCOPE_API_BASE}/services/audio/asr/transcription`;
const TASK_QUERY_URL = `${DASHSCOPE_API_BASE}/tasks`;

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

/**
 * 获取 ffmpeg 路径
 */
function getFfmpegPath(): string {
  const possiblePaths = [
    path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg.exe'),
    path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg'),
  ];
  
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      console.log('[FFmpeg] Found ffmpeg at:', p);
      return p;
    }
  }
  
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ffmpegStatic = require('ffmpeg-static');
    if (ffmpegStatic && fs.existsSync(ffmpegStatic)) {
      console.log('[FFmpeg] Using ffmpeg-static:', ffmpegStatic);
      return ffmpegStatic;
    }
  } catch (e) {
    console.log('[FFmpeg] ffmpeg-static require failed:', e);
  }
  
  return 'ffmpeg';
}

/**
 * 使用 ffmpeg 将音频转换为 WAV 格式
 */
async function convertToWav(audioBlob: Blob): Promise<Buffer> {
  const ffmpegPath = getFfmpegPath();
  
  const arrayBuffer = await audioBlob.arrayBuffer();
  const inputBuffer = Buffer.from(arrayBuffer);
  
  const tempDir = os.tmpdir();
  const timestamp = Date.now();
  const inputPath = path.join(tempDir, `input_${timestamp}.webm`);
  const outputPath = path.join(tempDir, `output_${timestamp}.wav`);
  
  try {
    fs.writeFileSync(inputPath, inputBuffer);
    console.log('[FFmpeg] Input file written:', inputPath, 'size:', inputBuffer.length);
    
    // 转换为 WAV 格式 (16kHz, 单声道, 16bit)
    const cmd = `"${ffmpegPath}" -y -i "${inputPath}" -ar 16000 -ac 1 -sample_fmt s16 "${outputPath}"`;
    console.log('[FFmpeg] Running:', cmd);
    
    execSync(cmd, { stdio: 'pipe' });
    
    const wavBuffer = fs.readFileSync(outputPath);
    console.log('[FFmpeg] Output WAV size:', wavBuffer.length);
    
    return wavBuffer;
    
  } finally {
    try {
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    } catch (e) {
      console.warn('[FFmpeg] Cleanup error:', e);
    }
  }
}

/**
 * 将音频转换为 MP3 格式（用于异步任务，更小的文件体积）
 */
async function convertToMp3(audioBlob: Blob): Promise<{ buffer: Buffer; path: string }> {
  const ffmpegPath = getFfmpegPath();
  
  const arrayBuffer = await audioBlob.arrayBuffer();
  const inputBuffer = Buffer.from(arrayBuffer);
  
  const tempDir = os.tmpdir();
  const timestamp = Date.now();
  const inputPath = path.join(tempDir, `input_${timestamp}.webm`);
  const outputPath = path.join(tempDir, `output_${timestamp}.mp3`);
  
  fs.writeFileSync(inputPath, inputBuffer);
  console.log('[FFmpeg] Input file written:', inputPath, 'size:', inputBuffer.length);
  
  // 转换为 MP3 格式
  const cmd = `"${ffmpegPath}" -y -i "${inputPath}" -ar 16000 -ac 1 -b:a 64k "${outputPath}"`;
  console.log('[FFmpeg] Running:', cmd);
  
  execSync(cmd, { stdio: 'pipe' });
  
  const mp3Buffer = fs.readFileSync(outputPath);
  console.log('[FFmpeg] Output MP3 size:', mp3Buffer.length);
  
  // 清理输入文件，保留输出文件（异步任务需要）
  try {
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
  } catch (e) {
    console.warn('[FFmpeg] Cleanup error:', e);
  }
  
  return { buffer: mp3Buffer, path: outputPath };
}

/**
 * 提交异步转录任务 (qwen3-asr-flash-filetrans)
 */
async function submitAsyncTask(
  fileUrl: string,
  apiKey: string,
  language: string = 'zh'
): Promise<{ success: boolean; taskId?: string; error?: string }> {
  console.log('[QwenASR-Async] Submitting task for:', fileUrl);
  
  const requestBody = {
    model: 'qwen3-asr-flash-filetrans',
    input: {
      file_url: fileUrl,
    },
    parameters: {
      channel_id: [0],
      language: language,
      enable_itn: true,  // 启用逆文本正则化（数字、日期等）
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
  console.log('[QwenASR-Async] Submit response:', responseText.substring(0, 500));
  
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
async function queryTaskStatus(
  taskId: string,
  apiKey: string
): Promise<{
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
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
      result: data.output?.result || data.output,
    };
  } else if (taskStatus === 'FAILED') {
    return {
      status: 'FAILED',
      error: data.output?.message || '任务失败',
    };
  }
  
  return { status: taskStatus };
}

/**
 * 等待异步任务完成（轮询）
 */
async function waitForTask(
  taskId: string,
  apiKey: string,
  onProgress?: (status: string, progress?: number) => void,
  maxWaitMs: number = 600000,  // 最长等待10分钟
  pollIntervalMs: number = 2000  // 每2秒查询一次
): Promise<ASRResult> {
  const startTime = Date.now();
  let pollCount = 0;
  
  while (Date.now() - startTime < maxWaitMs) {
    pollCount++;
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    onProgress?.(`正在转录... (${elapsed}秒)`, pollCount);
    
    const result = await queryTaskStatus(taskId, apiKey);
    console.log('[QwenASR-Async] Poll', pollCount, 'status:', result.status);
    
    if (result.status === 'SUCCEEDED' && result.result) {
      // 解析结果
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
      
      // 如果没有 sentences，尝试从 text 创建
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
    
    if (result.status === 'FAILED') {
      return {
        success: false,
        sentences: [],
        totalDuration: 0,
        error: result.error || '转录任务失败',
      };
    }
    
    // 等待后继续轮询
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
 * 使用 DashScope ASR 进行转写
 * 
 * 自动选择模式：
 * - 短音频（≤5分钟）：qwen3-asr-flash 同步
 * - 长音频或指定异步：qwen3-asr-flash-filetrans 异步
 */
export async function transcribeAudio(
  audioBlob: Blob,
  apiKey: string,
  options: TranscribeOptions = {}
): Promise<ASRResult> {
  const { language = 'zh', async: useAsync = false, fileUrl, onProgress } = options;

  console.log('[QwenASR] Starting transcription...');
  console.log('[QwenASR] Audio blob:', { size: audioBlob.size, type: audioBlob.type });
  console.log('[QwenASR] Options:', { useAsync, hasFileUrl: !!fileUrl });

  // 估算音频时长（粗略：webm 约 8kbps = 1KB/s）
  const estimatedDurationSec = audioBlob.size / 1000;
  const isLongAudio = estimatedDurationSec > 300;  // > 5分钟
  
  console.log('[QwenASR] Estimated duration:', estimatedDurationSec, 'seconds, isLong:', isLongAudio);

  // 如果指定了异步模式或是长音频，且提供了 fileUrl，使用异步
  if ((useAsync || isLongAudio) && fileUrl) {
    console.log('[QwenASR] Using async mode with fileUrl');
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
    
    console.log('[QwenASR] Task submitted:', submitResult.taskId);
    onProgress?.('任务已提交，等待处理...');
    
    return waitForTask(submitResult.taskId, apiKey, onProgress);
  }

  // 同步模式：使用 qwen3-asr-flash
  try {
    // 转换为 WAV 格式 (16k/mono)
    let wavBuffer: Buffer;
    try {
      console.log('[QwenASR] Converting audio to WAV...');
      onProgress?.('转换音频格式...');
      wavBuffer = await convertToWav(audioBlob);
      console.log('[QwenASR] WAV conversion done, size:', wavBuffer.length);
    } catch (error) {
      console.error('[QwenASR] Audio conversion failed:', error);
      return {
        success: false,
        sentences: [],
        totalDuration: 0,
        error: `音频转换失败: ${error instanceof Error ? error.message : '未知错误'}`,
      };
    }

    // Base64 编码
    const audioBase64 = wavBuffer.toString('base64');
    
    onProgress?.('正在转录...');

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

    console.log('[QwenASR] Sending request to:', ASR_TRANSCRIPTION_URL);

    const response = await fetch(ASR_TRANSCRIPTION_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    console.log('[QwenASR] Response status:', response.status);

    const responseText = await response.text();
    console.log('[QwenASR] Response:', responseText.substring(0, 500));

    if (!response.ok) {
      return {
        success: false,
        sentences: [],
        totalDuration: 0,
        error: responseText,
      };
    }

    const data = JSON.parse(responseText);

    // 解析结果：首选 sentences，其次 text
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

    if (sentences.length === 0) {
      return {
        success: false,
        sentences: [],
        totalDuration: 0,
        error: '未能提取转录文本',
      };
    }

    return {
      success: true,
      sentences,
      totalDuration: sentences[sentences.length - 1]?.endTime || 0,
      text: sentences.map(s => s.text).join(' '),
    };

  } catch (error) {
    console.error('[QwenASR] Error:', error);
    return {
      success: false,
      sentences: [],
      totalDuration: 0,
      error: error instanceof Error ? error.message : '转录失败',
    };
  }
}

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

/**
 * QwenASR 服务单例
 */
export const qwenASRService = {
  /** 转录音频（自动选择同步/异步模式） */
  async transcribe(audioBlob: Blob, apiKey: string, options?: TranscribeOptions): Promise<ASRResult> {
    return transcribeAudio(audioBlob, apiKey, options);
  },
  
  /** 提交异步转录任务 */
  async submitAsyncTask(fileUrl: string, apiKey: string, language?: string) {
    return submitAsyncTask(fileUrl, apiKey, language);
  },
  
  /** 查询异步任务状态 */
  async queryTask(taskId: string, apiKey: string) {
    return queryTaskStatus(taskId, apiKey);
  },
  
  /** 等待异步任务完成 */
  async waitForTask(taskId: string, apiKey: string, onProgress?: (status: string) => void) {
    return waitForTask(taskId, apiKey, onProgress);
  },
  
  /** 转换音频为 MP3（用于上传） */
  async convertToMp3(audioBlob: Blob) {
    return convertToMp3(audioBlob);
  },
  
  findAtTimestamp: findSentenceAtTimestamp,
  toSegments: toTranscriptSegments,
};

export default qwenASRService;
