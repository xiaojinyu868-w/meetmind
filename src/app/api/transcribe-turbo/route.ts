/**
 * 极速转录 API（同步调用模式）
 * 
 * POST /api/transcribe-turbo
 * 使用 qwen3-asr-flash 同步调用，每片 5 分钟内音频约 5-10 秒返回
 * 比异步模式快 3-5 倍！
 * 
 * 原理：
 * 1. 切分为 ≤5 分钟的片段
 * 2. 并行同步调用 qwen3-asr-flash
 * 3. 直接返回结果，无需轮询
 * 
 * 性能预估：
 * - 18 分钟音频 → 4 片 × 5-10 秒 = ~15-25 秒完成
 */

import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ==================== 配置 ====================

const MAX_FILE_SIZE = 500 * 1024 * 1024;
const UPLOAD_DIR = path.join(process.cwd(), 'public', 'temp-audio');

// 同步调用 API 端点（正确的 DashScope 多模态端点）
const SYNC_ASR_URL = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';

const PUBLIC_HOST = process.env.PUBLIC_HOST || '47.112.160.134:3001';
const PUBLIC_PROTOCOL = process.env.PUBLIC_PROTOCOL || 'http';

// 分片配置（同步调用限制 ≤5 分钟）
const SEGMENT_DURATION_SEC = 300;   // 每片 5 分钟（同步最大限制）
const MIN_DURATION_FOR_SPLIT = 300; // 超过 5 分钟才分片
const MAX_PARALLEL_TASKS = 10;      // 最大并行（注意 RPM 100 限制）

// ==================== 工具函数 ====================

function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

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

async function splitAudio(
  inputPath: string,
  outputDir: string,
  segmentDuration: number,
  baseName: string
): Promise<{ segments: string[]; durations: number[] }> {
  const totalDuration = await getAudioDuration(inputPath);
  console.log('[Turbo] Total duration:', totalDuration, 'seconds');
  
  if (totalDuration <= MIN_DURATION_FOR_SPLIT) {
    return { segments: [inputPath], durations: [totalDuration * 1000] };
  }
  
  const segments: string[] = [];
  const durations: number[] = [];
  const ext = path.extname(inputPath);
  
  let startTime = 0;
  let segIndex = 0;
  
  while (startTime < totalDuration) {
    const outputPath = path.join(outputDir, `${baseName}_turbo${segIndex}${ext}`);
    const duration = Math.min(segmentDuration, totalDuration - startTime);
    
    try {
      await execAsync(
        `ffmpeg -y -ss ${startTime} -i "${inputPath}" -t ${duration} -c copy "${outputPath}" 2>/dev/null`
      );
      segments.push(outputPath);
      durations.push(duration * 1000);
      console.log(`[Turbo] Segment ${segIndex}: ${startTime}s - ${startTime + duration}s`);
    } catch (e) {
      try {
        await execAsync(
          `ffmpeg -y -ss ${startTime} -i "${inputPath}" -t ${duration} "${outputPath}" 2>/dev/null`
        );
        segments.push(outputPath);
        durations.push(duration * 1000);
      } catch (e2) {
        console.error(`[Turbo] Split error at segment ${segIndex}:`, e2);
      }
    }
    
    startTime += segmentDuration;
    segIndex++;
  }
  
  return { segments, durations };
}

// ==================== 同步调用 ASR ====================

interface ASRSentence {
  text: string;
  begin_time?: number;
  end_time?: number;
  start_time?: number;
}

/**
 * 同步调用 qwen3-asr-flash（使用 DashScope 多模态格式）
 */
async function syncTranscribe(
  fileUrl: string,
  apiKey: string,
  language: string = 'zh'
): Promise<{ success: boolean; sentences: ASRSentence[]; error?: string }> {
  // 使用正确的 DashScope 多模态请求格式
  const requestBody = {
    model: 'qwen3-asr-flash',
    input: {
      messages: [
        {
          role: 'system',
          content: [{ text: '' }]  // 可用于上下文增强
        },
        {
          role: 'user',
          content: [
            { audio: fileUrl }  // 注意：用 audio 字段，不是 file_url
          ]
        }
      ]
    },
    parameters: {
      asr_options: {
        language: language,
        enable_itn: true
      }
    }
  };
  
  console.log(`[Turbo] Sync call: ${fileUrl}`);
  const startTime = Date.now();
  
  try {
    const response = await fetch(SYNC_ASR_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
    
    const elapsed = Date.now() - startTime;
    
    if (!response.ok) {
      const text = await response.text();
      console.error(`[Turbo] Sync call failed (${elapsed}ms):`, text);
      return { success: false, sentences: [], error: `API 错误: ${text}` };
    }
    
    const data = await response.json();
    console.log(`[Turbo] Sync call completed in ${elapsed}ms, response:`, JSON.stringify(data).slice(0, 500));
    
    // 解析 DashScope 多模态返回格式
    const sentences: ASRSentence[] = [];
    
    // 格式: output.choices[0].message.content[0].text
    const choices = data.output?.choices;
    if (choices?.[0]?.message?.content) {
      const content = choices[0].message.content;
      if (Array.isArray(content) && content[0]?.text) {
        // 同步返回的是纯文本，没有时间戳
        sentences.push({ text: content[0].text, begin_time: 0, end_time: 0 });
      } else if (typeof content === 'string') {
        sentences.push({ text: content, begin_time: 0, end_time: 0 });
      }
    } else if (data.output?.text) {
      sentences.push({ text: data.output.text, begin_time: 0, end_time: 0 });
    }
    
    return { success: sentences.length > 0, sentences };
    
  } catch (e) {
    console.error('[Turbo] Sync call exception:', e);
    return { success: false, sentences: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 并行同步转录多个片段
 */
async function processParallelSync(
  segmentPaths: string[],
  segmentDurations: number[],
  apiKey: string,
  language: string
): Promise<{ success: boolean; allSentences: ASRSentence[]; error?: string }> {
  const startTime = Date.now();
  
  console.log(`[Turbo] Processing ${segmentPaths.length} segments in parallel...`);
  
  // 构建 URL 并并行调用
  const promises = segmentPaths.map(async (segPath, index) => {
    const fileName = path.basename(segPath);
    const fileUrl = `${PUBLIC_PROTOCOL}://${PUBLIC_HOST}/temp-audio/${fileName}`;
    return syncTranscribe(fileUrl, apiKey, language);
  });
  
  const results = await Promise.all(promises);
  
  // 合并结果并调整时间戳
  const allSentences: ASRSentence[] = [];
  let timeOffset = 0;
  
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    
    if (result.success && result.sentences.length > 0) {
      const adjustedSentences = result.sentences.map(s => ({
        ...s,
        begin_time: (s.begin_time ?? s.start_time ?? 0) + timeOffset,
        end_time: (s.end_time ?? 0) + timeOffset,
      }));
      
      allSentences.push(...adjustedSentences);
      console.log(`[Turbo] Segment ${i}: ${result.sentences.length} sentences, offset: ${timeOffset}ms`);
    } else {
      console.warn(`[Turbo] Segment ${i} failed: ${result.error}`);
    }
    
    timeOffset += segmentDurations[i] || 0;
  }
  
  const totalTime = Math.floor((Date.now() - startTime) / 1000);
  console.log(`[Turbo] All segments completed in ${totalTime}s, total sentences: ${allSentences.length}`);
  
  return { success: allSentences.length > 0, allSentences };
}

// ==================== API Handler ====================

export async function POST(request: NextRequest) {
  console.log('[Turbo] ===== Request received =====');
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
    
    console.log('[Turbo] Received:', {
      name: audioFile.name,
      size: `${(audioFile.size / 1024 / 1024).toFixed(2)}MB`,
    });
    
    // 保存原始音频
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 8);
    const ext = path.extname(audioFile.name) || '.mp3';
    const baseName = `turbo_${timestamp}_${randomId}`;
    const originalPath = path.join(UPLOAD_DIR, `${baseName}${ext}`);
    
    const buffer = Buffer.from(await audioFile.arrayBuffer());
    fs.writeFileSync(originalPath, buffer);
    
    // 切分音频（≤5分钟片段）
    console.log('[Turbo] Splitting audio...');
    const { segments, durations } = await splitAudio(
      originalPath,
      UPLOAD_DIR,
      SEGMENT_DURATION_SEC,
      baseName
    );
    
    console.log(`[Turbo] Split into ${segments.length} segments`);
    
    // 并行同步转录
    const result = await processParallelSync(segments, durations, apiKey, language);
    
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
    const speedRatio = totalDuration > 0 ? (totalDuration / 1000 / totalTime).toFixed(1) : '0';
    
    console.log('[Turbo] Completed:', {
      segments: outputSegments.length,
      duration: `${(totalDuration / 1000 / 60).toFixed(1)}分钟`,
      processingTime: `${totalTime}秒`,
      speedRatio: `${speedRatio}x 实时`,
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
      mode: 'turbo-sync',
    });
    
  } catch (error) {
    console.error('[Turbo] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '服务器错误' },
      { status: 500 }
    );
  }
}

export const maxDuration = 300;
