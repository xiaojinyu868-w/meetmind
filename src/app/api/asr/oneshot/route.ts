/**
 * /api/asr/oneshot — 一段语音转一段文字（M13）
 *
 * 用途：替代流式 ASR WebSocket。用户在对话框点麦克风录一段，
 * 松开/再点 → 客户端 MediaRecorder 输出 audio blob → POST 上传
 * → 服务端调 qwen3-asr-flash 同步识别 → 返回 { text }
 *
 * 设计原则：
 *   - **不持久化**：录音 blob 用完即弃（学到的内容比录音重要）
 *   - **不流式**：用户要的是"一次输入一段文字"，不是看着字一个个跳出来
 *   - **限制时长**：客户端硬限 60s，服务端硬限 90s 兜底（防滥用 + 控延迟）
 *   - **错误友好**：返回明确的中文错误（不暴露内部 stack）
 *
 * Rate limit: 走 'tutor' 类（和聊天共享配额，避免被滥用）
 */

import { NextRequest, NextResponse } from 'next/server';
import { applyRateLimit } from '@/lib/utils/rate-limit';
import { transcribeAudio } from '@/lib/services/qwen-asr-service';
import { createLogger } from '@/lib/logger';

const log = createLogger('asr-oneshot');

export const runtime = 'nodejs';
export const maxDuration = 90;

const MAX_BYTES = 8 * 1024 * 1024; // 8MB（约 60s webm/opus 64kbps × 2 余量）

export async function POST(request: NextRequest) {
  const rateLimit = await applyRateLimit(request, 'tutor');
  if (rateLimit) return rateLimit;

  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: '语音识别未配置，请联系管理员' },
      { status: 500 },
    );
  }

  let audioBlob: Blob;
  let language = 'zh';
  try {
    const contentType = request.headers.get('content-type') ?? '';
    if (contentType.startsWith('multipart/form-data')) {
      const form = await request.formData();
      const file = form.get('audio');
      if (!(file instanceof Blob)) {
        return NextResponse.json({ error: '请上传音频文件' }, { status: 400 });
      }
      audioBlob = file;
      const lang = form.get('language');
      if (typeof lang === 'string' && lang) language = lang;
    } else {
      // 直接 body 是 audio/* 也支持
      const buf = await request.arrayBuffer();
      audioBlob = new Blob([buf], {
        type: contentType || 'application/octet-stream',
      });
    }
  } catch (err) {
    log.error('[asr-oneshot] parse body failed:', err);
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 });
  }

  if (audioBlob.size === 0) {
    return NextResponse.json({ error: '没有录到声音' }, { status: 400 });
  }
  if (audioBlob.size > MAX_BYTES) {
    return NextResponse.json(
      { error: '录音太长，最长 60 秒' },
      { status: 413 },
    );
  }

  const start = Date.now();
  try {
    const result = await transcribeAudio(audioBlob, apiKey, { language });
    const elapsed = Date.now() - start;
    if (!result.success) {
      log.warn('[asr-oneshot] transcribe failed', { error: result.error, elapsed });
      return NextResponse.json(
        { error: result.error ?? '识别失败，请重试' },
        { status: 502 },
      );
    }
    const text =
      result.text?.trim() ??
      result.sentences.map((s) => s.text).join('').trim();
    if (!text) {
      return NextResponse.json({ text: '', error: '没听清——再说一次？' });
    }
    log.info('[asr-oneshot] ok', {
      bytes: audioBlob.size,
      chars: text.length,
      elapsedMs: elapsed,
    });
    return NextResponse.json({ text, elapsedMs: elapsed });
  } catch (err) {
    const elapsed = Date.now() - start;
    log.error('[asr-oneshot] error', { err, elapsed });
    return NextResponse.json(
      { error: '识别出错，请重试' },
      { status: 500 },
    );
  }
}
