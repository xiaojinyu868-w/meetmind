/**
 * POST /api/asr/diarize — 说话人分离
 *
 * 两种调用方式：
 * 1. { audioUrl: string } — 已上传的音频公网 URL
 * 2. multipart/form-data — 直接上传音频 blob（不需要预先登录鉴权上传）
 *
 * 调用 DashScope 非实时 ASR（默认 qwen-audio-3.0-asr-flash-filetrans）+ diarization_enabled，
 * 返回带 speaker_id 的句子列表。
 *
 * 注意：此路由 maxDuration = 300（5 分钟），因为非实时 ASR 需要轮询。
 */

import { NextRequest, NextResponse } from 'next/server';
import { applyRateLimit } from '@/lib/utils/rate-limit';
import { runDiarization } from '@/lib/services/asr/diarization-tasks';
import { createLogger } from '@/lib/logger';
import * as fs from 'fs';
import * as path from 'path';

const log = createLogger('asr-diarize');

export const runtime = 'nodejs';
export const maxDuration = 300;

const MAX_FILE_SIZE = 500 * 1024 * 1024;
const UPLOAD_DIR = path.join(process.cwd(), 'public', 'temp-audio');

export async function POST(request: NextRequest) {
  const rateLimit = await applyRateLimit(request, 'tutor');
  if (rateLimit) return rateLimit;

  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { success: false, error: '语音识别未配置，请联系管理员' },
      { status: 500 },
    );
  }

  let audioUrl = '';
  let language = 'zh';
  let tempFilePath: string | null = null;

  try {
    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      // 方式 2：直接上传 blob
      const formData = await request.formData();
      const audioFile = formData.get('audio') as File | null;
      const langField = formData.get('language');
      language = typeof langField === 'string' ? langField : 'zh';

      if (!audioFile) {
        return NextResponse.json(
          { success: false, error: '缺少音频文件' },
          { status: 400 },
        );
      }
      if (audioFile.size > MAX_FILE_SIZE) {
        return NextResponse.json(
          { success: false, error: '文件过大' },
          { status: 413 },
        );
      }

      // 保存到 temp-audio 目录
      if (!fs.existsSync(UPLOAD_DIR)) {
        fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      }
      const timestamp = Date.now();
      const randomId = Math.random().toString(36).substring(2, 8);
      const originalExt = path.extname(audioFile.name) || '.webm';
      const fileName = `diarize_${timestamp}_${randomId}${originalExt}`;
      tempFilePath = path.join(UPLOAD_DIR, fileName);

      const arrayBuffer = await audioFile.arrayBuffer();
      fs.writeFileSync(tempFilePath, Buffer.from(arrayBuffer));

      // 构建公网可访问的 URL
      const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || 'localhost:3001';
      const proto = request.headers.get('x-forwarded-proto') || 'https';
      audioUrl = `${proto}://${host}/temp-audio/${fileName}`;

      log.info('Diarize: uploaded blob', { audioUrl, size: audioFile.size, language });
    } else {
      // 方式 1：JSON body 带 audioUrl
      const body = await request.json();
      const jsonBody = body as { audioUrl?: string; language?: string };
      audioUrl = jsonBody.audioUrl || '';
      language = jsonBody.language || 'zh';
    }

    if (!audioUrl || typeof audioUrl !== 'string') {
      return NextResponse.json(
        { success: false, error: '缺少 audioUrl 参数或音频文件' },
        { status: 400 },
      );
    }

    log.info('Diarize request', { audioUrl, language });

    const result = await runDiarization(audioUrl, apiKey, language);

    // 清理临时文件
    if (tempFilePath) {
      try { fs.unlinkSync(tempFilePath); } catch { /* ignore */ }
    }

    if (!result.success) {
      log.warn('Diarization failed', { error: result.error });
      return NextResponse.json(
        { success: false, error: result.error || '说话人分离失败' },
        { status: 502 },
      );
    }

    log.info('Diarization succeeded', {
      sentenceCount: result.sentences.length,
      speakerCount: result.speakerCount,
    });

    return NextResponse.json(result);
  } catch (error) {
    // 清理临时文件
    if (tempFilePath) {
      try { fs.unlinkSync(tempFilePath); } catch { /* ignore */ }
    }
    log.error('Diarize endpoint error', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '服务器错误' },
      { status: 500 },
    );
  }
}
