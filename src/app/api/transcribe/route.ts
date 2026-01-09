/**
 * 语音转录 API
 * 
 * POST /api/transcribe
 * 接收音频文件，调用 OpenAI Whisper 进行转录
 * 返回带时间戳的句子列表
 */

import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

// 最大文件大小 25MB（OpenAI Whisper 限制）
const MAX_FILE_SIZE = 25 * 1024 * 1024;

// 支持的音频格式
const SUPPORTED_FORMATS = ['audio/mpeg', 'audio/mp3', 'audio/x-m4a', 'audio/mp4', 'audio/wav', 'audio/webm', 'audio/ogg'];

export async function POST(request: NextRequest) {
  console.log('[Transcribe API] ===== Request received =====');
  
  try {
    // 获取 OpenAI API Key
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error('[Transcribe API] OPENAI_API_KEY not configured');
      return NextResponse.json(
        { error: 'OPENAI_API_KEY 未配置' },
        { status: 500 }
      );
    }
    console.log('[Transcribe API] OpenAI API Key configured');

    // 初始化 OpenAI 客户端
    const openai = new OpenAI({ apiKey });

    // 解析 multipart/form-data
    const formData = await request.formData();
    const audioFile = formData.get('audio') as File | null;
    const language = formData.get('language') as string | null;

    if (!audioFile) {
      console.error('[Transcribe API] No audio file provided');
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
      console.error('[Transcribe API] File too large:', audioFile.size);
      return NextResponse.json(
        { error: `文件过大 (${(audioFile.size / 1024 / 1024).toFixed(1)}MB)，最大支持 25MB` },
        { status: 400 }
      );
    }

    console.log('[Transcribe API] Received audio:', {
      name: audioFile.name,
      type: audioFile.type,
      size: audioFile.size,
    });

    // 创建 File 对象用于 OpenAI API
    const buffer = Buffer.from(await audioFile.arrayBuffer());
    const fileName = audioFile.name || 'audio.mp3';
    const file = new File([buffer], fileName, { type: audioFile.type || 'audio/mpeg' });

    console.log('[Transcribe API] Calling OpenAI Whisper...');
    
    // 调用 OpenAI Whisper 转录
    // 不指定 language 参数，让 Whisper 自动检测源语言并保持原文
    const transcriptionOptions: {
      file: File;
      model: 'whisper-1';
      response_format: 'verbose_json';
      timestamp_granularities: ['segment'];
      language?: string;
    } = {
      file: file,
      model: 'whisper-1',
      response_format: 'verbose_json',
      timestamp_granularities: ['segment'],
    };
    
    // 只有明确指定语言时才传递 language 参数
    if (language) {
      transcriptionOptions.language = language;
      console.log('[Transcribe API] Using specified language:', language);
    } else {
      console.log('[Transcribe API] Auto-detecting language (no translation)');
    }
    
    const transcription = await openai.audio.transcriptions.create(transcriptionOptions);

    console.log('[Transcribe API] Transcription completed');

    // 转换 Whisper segments 为统一格式
    const segments = (transcription.segments || []).map(
      (segment: { id?: number; start: number; end: number; text: string }, index: number) => ({
        id: `seg-${segment.id ?? index}`,
        text: segment.text.trim(),
        startMs: Math.round(segment.start * 1000),
        endMs: Math.round(segment.end * 1000),
        confidence: 0.95,
        isFinal: true,
      })
    );

    // 计算总时长
    const totalDuration = segments.length > 0
      ? segments[segments.length - 1].endMs
      : 0;

    console.log('[Transcribe API] Transcription success:', {
      segments: segments.length,
      duration: totalDuration,
    });

    // 返回转录结果
    return NextResponse.json({
      success: true,
      text: transcription.text,
      sentences: segments.map(s => ({
        id: s.id,
        text: s.text,
        beginTime: s.startMs,
        endTime: s.endMs,
        confidence: s.confidence,
      })),
      totalDuration,
      segments,
      language: transcription.language || language || 'zh',
    });

  } catch (error) {
    console.error('[Transcribe API] Error:', error);
    
    // 处理 OpenAI 特定错误
    if (error instanceof OpenAI.APIError) {
      return NextResponse.json(
        { error: `OpenAI API 错误: ${error.message}` },
        { status: error.status || 500 }
      );
    }
    
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '服务器错误' },
      { status: 500 }
    );
  }
}

// 配置超时时间
export const maxDuration = 60;
