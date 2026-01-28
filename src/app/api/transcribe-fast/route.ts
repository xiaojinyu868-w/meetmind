/**
 * 快速转录 API（并行分片模式）
 * 
 * POST /api/transcribe-fast
 * 将长音频切分为多个小片段，并行提交转录任务
 * 适用于长音频（>5分钟），可显著提升转录速度
 * 
 * 原理：
 * 1. 使用 ffmpeg 将音频切分为 N 个片段（默认每段 3 分钟）
 * 2. 并行提交所有片段到阿里云 ASR
 * 3. 等待所有任务完成
 * 4. 合并结果并调整时间戳偏移
 * 
 * 性能预估：
 * - 原来 18 分钟音频需要 ~130 秒
 * - 并行 6 个 3 分钟片段，只需要 ~25-35 秒
 */

import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { applyRateLimit } from '@/lib/utils/rate-limit';

const execAsync = promisify(exec);

// ==================== 配置 ====================

const MAX_FILE_SIZE = 500 * 1024 * 1024;
const SUPPORTED_FORMATS = [
  'audio/mpeg', 'audio/mp3', 'audio/x-m4a', 'audio/mp4',
  'audio/wav', 'audio/webm', 'audio/ogg', 'audio/flac'
];

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'temp-audio');
const DASHSCOPE_API_BASE = 'https://dashscope.aliyuncs.com/api/v1';
const ASR_TRANSCRIPTION_URL = `${DASHSCOPE_API_BASE}/services/audio/asr/transcription`;
const TASK_QUERY_URL = `${DASHSCOPE_API_BASE}/tasks`;

const PUBLIC_HOST = process.env.PUBLIC_HOST || '47.112.160.134:3001';
const PUBLIC_PROTOCOL = process.env.PUBLIC_PROTOCOL || 'http';

// 分片配置（阿里云建议：3-5分钟最优，RPM限制100次/分钟）
const SEGMENT_DURATION_SEC = 180;  // 每片 3 分钟
const MIN_DURATION_FOR_SPLIT = 240; // 超过 4 分钟才分片
const MAX_PARALLEL_TASKS = 10;     // 最大并行任务数（留有余量避免触发限流）

// ==================== 工具函数 ====================

function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

/**
 * 获取音频时长（秒）
 */
async function getAudioDuration(filePath: string): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`
    );
    return parseFloat(stdout.trim()) || 0;
  } catch (e) {
    console.error('[FFProbe] Error:', e);
    return 0;
  }
}

/**
 * 将音频切分为多个片段
 */
async function splitAudio(
  inputPath: string,
  outputDir: string,
  segmentDuration: number,
  baseName: string
): Promise<{ segments: string[]; durations: number[] }> {
  const totalDuration = await getAudioDuration(inputPath);
  console.log('[Split] Total duration:', totalDuration, 'seconds');
  
  if (totalDuration <= MIN_DURATION_FOR_SPLIT) {
    // 不需要分片
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
      // 使用 ffmpeg 切分，-c copy 避免重编码（更快）
      await execAsync(
        `ffmpeg -y -ss ${startTime} -i "${inputPath}" -t ${duration} -c copy "${outputPath}" 2>/dev/null`
      );
      
      segments.push(outputPath);
      durations.push(duration * 1000); // 转为毫秒
      console.log(`[Split] Segment ${segIndex}: ${startTime}s - ${startTime + duration}s`);
    } catch (e) {
      console.error(`[Split] Error at segment ${segIndex}:`, e);
      // 如果 copy 模式失败，尝试重编码
      try {
        await execAsync(
          `ffmpeg -y -ss ${startTime} -i "${inputPath}" -t ${duration} "${outputPath}" 2>/dev/null`
        );
        segments.push(outputPath);
        durations.push(duration * 1000);
      } catch (e2) {
        console.error(`[Split] Re-encode also failed:`, e2);
      }
    }
    
    startTime += segmentDuration;
    segIndex++;
  }
  
  return { segments, durations };
}

// ==================== ASR API ====================

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

async function submitAsyncTask(
  fileUrl: string,
  apiKey: string,
  language: string = 'zh'
): Promise<{ success: boolean; taskId?: string; error?: string }> {
  const requestBody = {
    model: 'qwen3-asr-flash-filetrans',
    input: { file_url: fileUrl },
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
  
  if (!response.ok) {
    const text = await response.text();
    return { success: false, error: `API 错误: ${text}` };
  }
  
  const data = await response.json();
  const taskId = data.output?.task_id;
  
  if (!taskId) {
    return { success: false, error: '未获取到任务 ID' };
  }
  
  return { success: true, taskId };
}

async function queryTaskStatus(taskId: string, apiKey: string): Promise<TaskResult> {
  const response = await fetch(`${TASK_QUERY_URL}/${taskId}`, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });
  
  if (!response.ok) {
    return { status: 'UNKNOWN', error: await response.text() };
  }
  
  const data = await response.json();
  const status = data.output?.task_status || 'UNKNOWN';
  
  if (status === 'SUCCEEDED') {
    return {
      status: 'SUCCEEDED',
      transcription_url: data.output?.result?.transcription_url,
    };
  } else if (status === 'FAILED') {
    return { status: 'FAILED', error: data.output?.message || '任务失败' };
  }
  
  return { status };
}

async function fetchTranscriptionResult(url: string): Promise<ASRSentence[]> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`获取结果失败: ${response.status}`);
  
  const data = await response.json();
  const sentences: ASRSentence[] = [];
  const transcripts = data.transcripts || [data];
  
  for (const t of transcripts) {
    if (t.sentences?.length) {
      sentences.push(...t.sentences);
    }
  }
  
  return sentences;
}

/**
 * 等待单个任务完成（使用指数退避策略减少轮询开销）
 */
async function waitForSingleTask(
  taskId: string,
  apiKey: string,
  maxWaitMs: number = 300000
): Promise<{ success: boolean; sentences: ASRSentence[]; error?: string }> {
  const startTime = Date.now();
  let pollInterval = 2000; // 初始 2 秒
  const maxInterval = 5000; // 最大 5 秒
  const intervalGrowth = 1.2; // 增长系数
  
  while (Date.now() - startTime < maxWaitMs) {
    const result = await queryTaskStatus(taskId, apiKey);
    
    if (result.status === 'SUCCEEDED' && result.transcription_url) {
      const sentences = await fetchTranscriptionResult(result.transcription_url);
      return { success: true, sentences };
    }
    
    if (result.status === 'FAILED') {
      return { success: false, sentences: [], error: result.error };
    }
    
    await new Promise(r => setTimeout(r, pollInterval));
    // 指数退避：逐渐增加轮询间隔
    pollInterval = Math.min(pollInterval * intervalGrowth, maxInterval);
  }
  
  return { success: false, sentences: [], error: '任务超时' };
}

/**
 * 并行处理多个转录任务
 */
async function processParallelTasks(
  segmentPaths: string[],
  segmentDurations: number[],
  apiKey: string,
  language: string
): Promise<{ success: boolean; allSentences: ASRSentence[]; error?: string }> {
  const startTime = Date.now();
  
  // 1. 并行提交所有任务
  console.log(`[Parallel] Submitting ${segmentPaths.length} tasks...`);
  
  const submitPromises = segmentPaths.map(async (segPath, index) => {
    const fileName = path.basename(segPath);
    const fileUrl = `${PUBLIC_PROTOCOL}://${PUBLIC_HOST}/temp-audio/${fileName}`;
    console.log(`[Parallel] Task ${index}: ${fileUrl}`);
    return submitAsyncTask(fileUrl, apiKey, language);
  });
  
  const submitResults = await Promise.all(submitPromises);
  
  // 检查提交结果
  const taskIds: (string | null)[] = submitResults.map((r, i) => {
    if (r.success && r.taskId) {
      console.log(`[Parallel] Task ${i} submitted: ${r.taskId}`);
      return r.taskId;
    }
    console.error(`[Parallel] Task ${i} submit failed: ${r.error}`);
    return null;
  });
  
  const validTaskCount = taskIds.filter(Boolean).length;
  if (validTaskCount === 0) {
    return { success: false, allSentences: [], error: '所有任务提交失败' };
  }
  
  console.log(`[Parallel] ${validTaskCount}/${segmentPaths.length} tasks submitted successfully`);
  
  // 2. 并行等待所有任务完成
  const waitPromises = taskIds.map((taskId, index) => {
    if (!taskId) {
      return Promise.resolve({ success: false, sentences: [] as ASRSentence[], error: '未提交' });
    }
    return waitForSingleTask(taskId, apiKey);
  });
  
  const results = await Promise.all(waitPromises);
  
  // 3. 合并结果并调整时间戳
  const allSentences: ASRSentence[] = [];
  let timeOffset = 0;
  
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    
    if (result.success && result.sentences.length > 0) {
      // 调整时间戳偏移
      const adjustedSentences = result.sentences.map(s => ({
        ...s,
        begin_time: (s.begin_time ?? s.start_time ?? 0) + timeOffset,
        end_time: (s.end_time ?? 0) + timeOffset,
      }));
      
      allSentences.push(...adjustedSentences);
      console.log(`[Parallel] Task ${i}: ${result.sentences.length} sentences, offset: ${timeOffset}ms`);
    } else {
      console.warn(`[Parallel] Task ${i} failed: ${result.error}`);
    }
    
    // 累加偏移量
    timeOffset += segmentDurations[i] || 0;
  }
  
  const totalTime = Math.floor((Date.now() - startTime) / 1000);
  console.log(`[Parallel] All tasks completed in ${totalTime}s, total sentences: ${allSentences.length}`);
  
  return { success: allSentences.length > 0, allSentences };
}

// ==================== API Handler ====================

export async function POST(request: NextRequest) {
  // 应用速率限制
  const rateLimitResponse = await applyRateLimit(request, 'transcribe');
  if (rateLimitResponse) return rateLimitResponse;

  console.log('[TranscribeFast] ===== Request received =====');
  const overallStartTime = Date.now();
  
  try {
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'DASHSCOPE_API_KEY 未配置' }, { status: 500 });
    }
    
    ensureUploadDir();
    
    const formData = await request.formData();
    const audioFile = formData.get('audio') as File | null;
    const language = (formData.get('language') as string) || 'zh';
    
    if (!audioFile) {
      return NextResponse.json({ error: '未提供音频文件' }, { status: 400 });
    }
    
    if (audioFile.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: '文件过大' }, { status: 400 });
    }
    
    console.log('[TranscribeFast] Received:', {
      name: audioFile.name,
      size: `${(audioFile.size / 1024 / 1024).toFixed(2)}MB`,
    });
    
    // 保存原始音频
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 8);
    const ext = path.extname(audioFile.name) || '.mp3';
    const baseName = `audio_${timestamp}_${randomId}`;
    const originalPath = path.join(UPLOAD_DIR, `${baseName}${ext}`);
    
    const buffer = Buffer.from(await audioFile.arrayBuffer());
    fs.writeFileSync(originalPath, buffer);
    
    // 切分音频
    console.log('[TranscribeFast] Splitting audio...');
    const { segments, durations } = await splitAudio(
      originalPath,
      UPLOAD_DIR,
      SEGMENT_DURATION_SEC,
      baseName
    );
    
    console.log(`[TranscribeFast] Split into ${segments.length} segments`);
    
    // 并行转录
    const result = await processParallelTasks(segments, durations, apiKey, language);
    
    // 清理临时文件
    for (const seg of segments) {
      try { fs.unlinkSync(seg); } catch {}
    }
    if (segments[0] !== originalPath) {
      try { fs.unlinkSync(originalPath); } catch {}
    }
    
    if (!result.success) {
      return NextResponse.json({ error: result.error || '转录失败' }, { status: 500 });
    }
    
    // 格式化输出
    const outputSegments = result.allSentences.map((s, i) => ({
      id: `seg-${i}`,
      text: s.text.trim(),
      startMs: s.begin_time ?? s.start_time ?? 0,
      endMs: s.end_time ?? 0,
      confidence: 0.95,
      isFinal: true,
    }));
    
    const totalDuration = outputSegments.length > 0
      ? outputSegments[outputSegments.length - 1].endMs
      : 0;
    
    const fullText = outputSegments.map(s => s.text).join('');
    
    const totalTime = Math.floor((Date.now() - overallStartTime) / 1000);
    console.log('[TranscribeFast] Completed:', {
      segments: outputSegments.length,
      duration: `${(totalDuration / 1000 / 60).toFixed(1)}分钟`,
      processingTime: `${totalTime}秒`,
      speedRatio: `${(totalDuration / 1000 / totalTime).toFixed(1)}x 实时`,
    });
    
    return NextResponse.json({
      success: true,
      text: fullText,
      sentences: outputSegments.map(s => ({
        id: s.id,
        text: s.text,
        beginTime: s.startMs,
        endTime: s.endMs,
      })),
      totalDuration,
      segments: outputSegments,
      language,
      processingTime: totalTime,
      mode: 'parallel',
    });
    
  } catch (error) {
    console.error('[TranscribeFast] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '服务器错误' },
      { status: 500 }
    );
  }
}

export const maxDuration = 600;
