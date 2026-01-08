/**
 * 语音转录 API
 * 
 * POST /api/transcribe
 * 接收音频文件，调用通义千问 ASR 进行转录
 * 返回带时间戳的句子列表
 * 
 * 支持两种模式：
 * 1. 同步模式（默认）：使用 qwen3-asr-flash，适合 ≤5分钟的音频
 * 2. 异步模式：使用 qwen3-asr-flash-filetrans，适合长音频（需要提供公网 URL）
 */

import { NextRequest, NextResponse } from 'next/server';
import { qwenASRService, type ASRResult } from '@/lib/services/qwen-asr-service';

// 最大文件大小 100MB（异步模式支持更大文件）
const MAX_FILE_SIZE = 100 * 1024 * 1024;
// 同步模式最大时长估算（5分钟，按 webm 约 1KB/s 估算）
const SYNC_MAX_SIZE = 5 * 60 * 1000;

export async function POST(request: NextRequest) {
  console.log('[Transcribe API] ===== Request received =====');
  
  try {
    // 获取 DashScope API Key
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey) {
      console.error('[Transcribe API] DASHSCOPE_API_KEY not configured');
      return NextResponse.json(
        { error: 'DASHSCOPE_API_KEY 未配置' },
        { status: 500 }
      );
    }
    console.log('[Transcribe API] DashScope API Key configured:', apiKey.substring(0, 10) + '...');

    // 解析 multipart/form-data
    const formData = await request.formData();
    const audioFile = formData.get('audio') as File | null;
    const fileUrl = formData.get('fileUrl') as string | null;  // 可选：用于异步模式
    const forceAsync = formData.get('async') === 'true';

    if (!audioFile && !fileUrl) {
      console.error('[Transcribe API] No audio file or URL provided');
      return NextResponse.json(
        { error: '未提供音频文件或 URL' },
        { status: 400 }
      );
    }

    // 如果提供了 fileUrl，使用异步模式
    if (fileUrl) {
      console.log('[Transcribe API] Using async mode with fileUrl:', fileUrl);
      
      const submitResult = await qwenASRService.submitAsyncTask(fileUrl, apiKey);
      if (!submitResult.success || !submitResult.taskId) {
        return NextResponse.json(
          { error: submitResult.error || '提交任务失败' },
          { status: 500 }
        );
      }
      
      // 返回任务 ID，让前端轮询
      return NextResponse.json({
        success: true,
        async: true,
        taskId: submitResult.taskId,
        message: '异步任务已提交，请使用 /api/transcribe/status 查询结果',
      });
    }

    // 检查文件大小
    if (audioFile!.size > MAX_FILE_SIZE) {
      console.error('[Transcribe API] File too large:', audioFile!.size);
      return NextResponse.json(
        { error: `文件过大，最大支持 ${MAX_FILE_SIZE / 1024 / 1024}MB` },
        { status: 400 }
      );
    }

    console.log('[Transcribe API] Received audio:', {
      name: audioFile!.name,
      type: audioFile!.type,
      size: audioFile!.size,
    });

    // 检查是否需要异步模式（文件太大）
    const needAsync = forceAsync || audioFile!.size > SYNC_MAX_SIZE;
    
    if (needAsync) {
      console.log('[Transcribe API] File too large for sync mode, need async');
      // 异步模式需要公网 URL，这里返回提示
      // 生产环境应该：1. 上传到 OSS  2. 获取 URL  3. 提交异步任务
      return NextResponse.json({
        success: false,
        error: '音频文件过长（>5分钟），需要使用异步模式。请先上传文件到 OSS 获取公网 URL，然后使用 fileUrl 参数提交。',
        needAsync: true,
        estimatedDuration: Math.round(audioFile!.size / 1000),
      }, { status: 400 });
    }

    // 转换为 Blob
    const audioBlob = new Blob([await audioFile!.arrayBuffer()], {
      type: audioFile!.type || 'audio/webm',
    });

    console.log('[Transcribe API] Calling transcription service (sync mode)...');
    
    // 调用转录服务（同步模式）
    const result: ASRResult = await qwenASRService.transcribe(audioBlob, apiKey);

    console.log('[Transcribe API] Transcription result:', {
      success: result.success,
      sentenceCount: result.sentences?.length || 0,
      error: result.error,
    });

    if (!result.success) {
      console.error('[Transcribe API] Transcription failed:', result.error);
      return NextResponse.json(
        { error: result.error || '转录失败' },
        { status: 500 }
      );
    }

    console.log('[Transcribe API] Transcription success:', {
      sentences: result.sentences.length,
      duration: result.totalDuration,
    });

    // 返回转录结果
    return NextResponse.json({
      success: true,
      text: result.text || result.sentences.map(s => s.text).join(' '),
      sentences: result.sentences,
      totalDuration: result.totalDuration,
      // 同时返回兼容格式
      segments: qwenASRService.toSegments(result.sentences),
    });

  } catch (error) {
    console.error('[Transcribe API] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '服务器错误' },
      { status: 500 }
    );
  }
}

// 配置 Next.js 不解析 body（因为我们需要处理 multipart）
export const config = {
  api: {
    bodyParser: false,
  },
};
