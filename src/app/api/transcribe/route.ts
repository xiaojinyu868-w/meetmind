/**
 * 语音转录 API
 * 
 * POST /api/transcribe
 * 接收音频文件，调用阿里云 DashScope ASR 进行转录
 * 支持长音频（整节课录音），返回带时间戳的句子列表
 * 
 * 使用异步模式 qwen3-asr-flash-filetrans：
 * 1. 保存音频到 public/temp-audio/
 * 2. 构建公网 URL
 * 3. 提交异步任务
 * 4. 轮询等待结果
 */

import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

// ==================== 配置 ====================

// 最大文件大小 500MB（支持长音频）
const MAX_FILE_SIZE = 500 * 1024 * 1024;

// 支持的音频格式
const SUPPORTED_FORMATS = [
  'audio/mpeg', 'audio/mp3', 'audio/x-m4a', 'audio/mp4',
  'audio/wav', 'audio/webm', 'audio/ogg', 'audio/flac'
];

// 临时音频目录
const UPLOAD_DIR = path.join(process.cwd(), 'public', 'temp-audio');

// 阿里云 DashScope API
const DASHSCOPE_API_BASE = 'https://dashscope.aliyuncs.com/api/v1';
const ASR_TRANSCRIPTION_URL = `${DASHSCOPE_API_BASE}/services/audio/asr/transcription`;
const TASK_QUERY_URL = `${DASHSCOPE_API_BASE}/tasks`;

// 公网访问配置（云服务器）
const PUBLIC_HOST = process.env.PUBLIC_HOST || '47.112.160.134:3001';
const PUBLIC_PROTOCOL = process.env.PUBLIC_PROTOCOL || 'http';

// ==================== 工具函数 ====================

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
          console.log('[Transcribe] Cleaned up:', file);
        }
      } catch {
        // ignore
      }
    }
  } catch (e) {
    console.warn('[Transcribe] Cleanup error:', e);
  }
}

// ==================== 阿里云 ASR API ====================

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

/**
 * 提交异步转录任务
 */
async function submitAsyncTask(
  fileUrl: string,
  apiKey: string,
  language: string = 'zh'
): Promise<{ success: boolean; taskId?: string; error?: string }> {
  console.log('[ASR] Submitting async task for:', fileUrl);
  
  const requestBody = {
    model: 'qwen3-asr-flash-filetrans',
    input: {
      file_url: fileUrl,
    },
    parameters: {
      channel_id: [0],
      language: language,
      enable_itn: true,  // 逆文本正则化（数字、日期等）
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
  console.log('[ASR] Submit response:', response.status, responseText.substring(0, 300));
  
  if (!response.ok) {
    return { success: false, error: `API 错误 (${response.status}): ${responseText}` };
  }
  
  try {
    const data = JSON.parse(responseText);
    const taskId = data.output?.task_id;
    
    if (!taskId) {
      return { success: false, error: '未获取到任务 ID: ' + responseText };
    }
    
    console.log('[ASR] Task ID:', taskId);
    return { success: true, taskId };
  } catch (e) {
    return { success: false, error: '解析响应失败: ' + responseText };
  }
}

/**
 * 查询任务状态
 */
async function queryTaskStatus(taskId: string, apiKey: string): Promise<TaskResult> {
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
  
  try {
    const data = JSON.parse(responseText);
    const taskStatus = data.output?.task_status || 'UNKNOWN';
    
    if (taskStatus === 'SUCCEEDED') {
      // 阿里云返回格式: data.output.result.transcription_url
      const transcriptionUrl = data.output?.result?.transcription_url;
      console.log('[ASR] Transcription URL:', transcriptionUrl);
      return {
        status: 'SUCCEEDED',
        transcription_url: transcriptionUrl,
        result: data.output?.result || data.output,
      };
    } else if (taskStatus === 'FAILED') {
      return {
        status: 'FAILED',
        error: data.output?.message || data.message || '任务失败',
      };
    }
    
    return { status: taskStatus };
  } catch {
    return { status: 'UNKNOWN', error: '解析响应失败' };
  }
}

/**
 * 获取转录结果（从 transcription_url）
 */
async function fetchTranscriptionResult(url: string): Promise<ASRSentence[]> {
  console.log('[ASR] Fetching result from:', url);
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`获取结果失败: ${response.status}`);
  }
  
  const data = await response.json();
  console.log('[ASR] Result structure:', JSON.stringify(data).substring(0, 500));
  
  // 解析结果 - 阿里云返回格式
  const sentences: ASRSentence[] = [];
  
  // 尝试多种可能的结构
  const transcripts = data.transcripts || data.output?.transcripts || [data];
  
  for (const transcript of transcripts) {
    if (transcript.sentences && Array.isArray(transcript.sentences)) {
      sentences.push(...transcript.sentences);
    }
  }
  
  return sentences;
}

/**
 * 等待任务完成（轮询）
 */
async function waitForTask(
  taskId: string,
  apiKey: string,
  maxWaitMs: number = 600000,  // 最长等待10分钟
  pollIntervalMs: number = 3000  // 每3秒查询一次
): Promise<{ success: boolean; sentences: ASRSentence[]; error?: string }> {
  const startTime = Date.now();
  let pollCount = 0;
  
  while (Date.now() - startTime < maxWaitMs) {
    pollCount++;
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    console.log(`[ASR] Poll ${pollCount}, elapsed: ${elapsed}s`);
    
    const result = await queryTaskStatus(taskId, apiKey);
    console.log('[ASR] Status:', result.status);
    
    if (result.status === 'SUCCEEDED') {
      // 获取转录结果
      if (result.transcription_url) {
        const sentences = await fetchTranscriptionResult(result.transcription_url);
        return { success: true, sentences };
      }
      
      // 直接从 result 解析
      const sentences: ASRSentence[] = [];
      const transcripts = result.result?.transcripts || [];
      for (const t of transcripts) {
        if (t.sentences) {
          sentences.push(...t.sentences);
        }
      }
      
      return { success: true, sentences };
    }
    
    if (result.status === 'FAILED') {
      return { success: false, sentences: [], error: result.error || '转录失败' };
    }
    
    // 等待后继续轮询
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }
  
  return { success: false, sentences: [], error: '转录超时（超过10分钟）' };
}

// ==================== API Handler ====================

export async function POST(request: NextRequest) {
  console.log('[Transcribe API] ===== Request received =====');
  
  try {
    // 获取 API Key
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey) {
      console.error('[Transcribe API] DASHSCOPE_API_KEY not configured');
      return NextResponse.json(
        { error: 'DASHSCOPE_API_KEY 未配置' },
        { status: 500 }
      );
    }
    
    ensureUploadDir();
    cleanupOldFiles();
    
    // 解析 form data
    const formData = await request.formData();
    const audioFile = formData.get('audio') as File | null;
    const language = (formData.get('language') as string) || 'zh';
    
    if (!audioFile) {
      return NextResponse.json(
        { error: '未提供音频文件' },
        { status: 400 }
      );
    }
    
    // 验证文件类型
    const isAudio = audioFile.type.startsWith('audio/') || SUPPORTED_FORMATS.includes(audioFile.type);
    if (!isAudio) {
      return NextResponse.json(
        { error: `不支持的文件格式: ${audioFile.type}` },
        { status: 400 }
      );
    }
    
    // 检查文件大小
    if (audioFile.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `文件过大 (${(audioFile.size / 1024 / 1024).toFixed(1)}MB)，最大支持 500MB` },
        { status: 400 }
      );
    }
    
    console.log('[Transcribe API] Received audio:', {
      name: audioFile.name,
      type: audioFile.type,
      size: `${(audioFile.size / 1024 / 1024).toFixed(2)}MB`,
    });
    
    // 保存音频文件
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 8);
    const ext = path.extname(audioFile.name) || '.mp3';
    const fileName = `audio_${timestamp}_${randomId}${ext}`;
    const filePath = path.join(UPLOAD_DIR, fileName);
    
    const arrayBuffer = await audioFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    fs.writeFileSync(filePath, buffer);
    
    console.log('[Transcribe API] Saved to:', filePath);
    
    // 构建公网 URL
    const fileUrl = `${PUBLIC_PROTOCOL}://${PUBLIC_HOST}/temp-audio/${fileName}`;
    console.log('[Transcribe API] Public URL:', fileUrl);
    
    // 提交异步转录任务
    const submitResult = await submitAsyncTask(fileUrl, apiKey, language);
    
    if (!submitResult.success || !submitResult.taskId) {
      // 清理文件
      try { fs.unlinkSync(filePath); } catch {}
      return NextResponse.json(
        { error: submitResult.error || '提交任务失败' },
        { status: 500 }
      );
    }
    
    console.log('[Transcribe API] Task submitted:', submitResult.taskId);
    
    // 等待任务完成
    const taskResult = await waitForTask(submitResult.taskId, apiKey);
    
    // 清理临时文件
    try { fs.unlinkSync(filePath); } catch {}
    
    if (!taskResult.success) {
      return NextResponse.json(
        { error: taskResult.error || '转录失败' },
        { status: 500 }
      );
    }
    
    // 转换结果格式
    const segments = taskResult.sentences.map((s, index) => {
      // 阿里云返回时间戳单位是毫秒（begin_time/end_time）
      const startMs = s.begin_time ?? s.start_time ?? 0;
      const endMs = s.end_time ?? 0;
      
      return {
        id: `seg-${index}`,
        text: s.text.trim(),
        startMs,
        endMs,
        confidence: 0.95,
        isFinal: true,
      };
    });
    
    // 计算总时长
    const totalDuration = segments.length > 0
      ? segments[segments.length - 1].endMs
      : 0;
    
    // 合并全文
    const fullText = segments.map(s => s.text).join('');
    
    console.log('[Transcribe API] Success:', {
      segments: segments.length,
      duration: `${(totalDuration / 1000 / 60).toFixed(1)}分钟`,
    });
    
    // 返回结果
    return NextResponse.json({
      success: true,
      text: fullText,
      sentences: segments.map(s => ({
        id: s.id,
        text: s.text,
        beginTime: s.startMs,
        endTime: s.endMs,
        confidence: s.confidence,
      })),
      totalDuration,
      segments,
      language,
    });
    
  } catch (error) {
    console.error('[Transcribe API] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '服务器错误' },
      { status: 500 }
    );
  }
}

// 配置：支持长时间请求
export const maxDuration = 600; // 10分钟
