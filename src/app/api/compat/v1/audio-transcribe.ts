// 清小搭 input_audio 链路 — OSS 语音 URL → 转写文本
//
// 平台只会给公网签名 URL（无 base64），签名有时效，收到请求当次处理、不缓存。
// 复用现有批量转写链路 `src/lib/services/qwen-asr-tasks.ts` 的
// `submitAsyncTask` + `waitForTask`（DashScope filetrans，env 复用
// DASHSCOPE_API_KEY / DASHSCOPE_ASR_FILE_MODEL）：提交时把 OSS URL 直接交给
// DashScope 拉取（同云 OSS 可达），本侧不落地音频、不依赖 ASR_PUBLIC_HOST 回源。
//
// 本侧只做一次"预检拉取"：headers-only GET（拿到响应头即 cancel body），
// 用于 ① 校验 URL 可达 ② Content-Length 超过 25MB 直接拒绝 ③ 30s 超时兜底。
// 预检或转写任何一步失败都不抛错——返回 ok:false，由调用方在消息里留降级说明。

import { createLogger } from '@/lib/logger';
import { submitAsyncTask, waitForTask } from '@/lib/services/qwen-asr-tasks';
import { recordAudioTranscribe } from './daily-cap';

const log = createLogger('xiaoda-compat');

const FETCH_TIMEOUT_MS = 30_000;
const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25MB
// 平台网关总超时 120s，要给 LLM 推理留余量：filetrans 轮询预算压到 60s，
// 几分钟的试讲语音实测通常 10-20s 完成。
const ASR_MAX_WAIT_MS = 60_000;
const ASR_POLL_INTERVAL_MS = 2_000;

export interface InputAudioRef {
  url: string;
  format?: string;
}

export type TranscribeOutcome =
  | { ok: true; text: string }
  | { ok: false; reason: string };

/**
 * 转写阶段进度（供流式路径发 reasoning 进度帧）：
 * receiving → 预检拉取中；transcribing → 已提交转写、轮询中；
 * done → 转写成功（audioMs 为音频时长，取不到时不带）。失败不回调，
 * 由消息里的降级说明兜底。
 */
export type TranscribeProgress = (
  stage: 'receiving' | 'transcribing' | 'done',
  info?: { audioMs?: number },
) => void;

/** 从多模态 content 数组里挑出 input_audio part（只收公网 URL；data: base64 不收）。 */
export function extractInputAudioRefs(content: unknown): InputAudioRef[] {
  if (!Array.isArray(content)) return [];
  const refs: InputAudioRef[] = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    const p = part as { type?: unknown; input_audio?: unknown };
    if (p.type !== 'input_audio' || !p.input_audio || typeof p.input_audio !== 'object') continue;
    const audio = p.input_audio as { url?: unknown; format?: unknown };
    if (typeof audio.url === 'string' && audio.url.trim()) {
      refs.push({
        url: audio.url.trim(),
        format: typeof audio.format === 'string' ? audio.format : undefined,
      });
    }
  }
  return refs;
}

/**
 * 预检拉取：仅 http/https；30s 超时；读响应头即中断 body。
 * Content-Length 缺失（理论上 OSS 都会带）时放行，交由 DashScope 自取。
 */
async function preflightAudioUrl(url: string): Promise<
  { ok: true; size: number | null } | { ok: false; reason: string }
> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: `unsupported_scheme:${parsed.protocol}` };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    const lengthHeader = response.headers.get('content-length');
    const size = lengthHeader ? Number(lengthHeader) : null;
    // 只要头部，不下载正文
    await response.body?.cancel().catch(() => undefined);
    if (!response.ok) {
      return { ok: false, reason: `http_${response.status}` };
    }
    if (size !== null && Number.isFinite(size) && size > MAX_AUDIO_BYTES) {
      return { ok: false, reason: `too_large:${size}` };
    }
    return { ok: true, size: size !== null && Number.isFinite(size) ? size : null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const reason = controller.signal.aborted ? `timeout_${FETCH_TIMEOUT_MS}ms` : message;
    return { ok: false, reason };
  } finally {
    clearTimeout(timer);
  }
}

/** 单条语音 URL → 转写文本。任何失败都收敛为 ok:false，不抛出。 */
export async function transcribeInputAudio(
  ref: InputAudioRef,
  onProgress?: TranscribeProgress,
): Promise<TranscribeOutcome> {
  const startedAt = Date.now();
  // 每日成本闸：确实进入转写流程才计数（预检失败/缺 key 的降级也计——资源消耗在意图）
  recordAudioTranscribe();

  onProgress?.('receiving');
  const preflight = await preflightAudioUrl(ref.url);
  if (!preflight.ok) {
    log.warn('input_audio preflight failed', { reason: preflight.reason, format: ref.format });
    return { ok: false, reason: preflight.reason };
  }

  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    log.warn('input_audio skipped: DASHSCOPE_API_KEY not configured');
    return { ok: false, reason: 'asr_key_missing' };
  }

  try {
    onProgress?.('transcribing');
    // language='auto'：与 /api/transcribe-fast 的 M7.6 约定一致，自动识别中英夹杂
    const submit = await submitAsyncTask(ref.url, apiKey, 'auto');
    if (!submit.success || !submit.taskId) {
      log.warn('input_audio asr submit failed', { error: submit.error });
      return { ok: false, reason: submit.error ?? 'submit_failed' };
    }

    const result = await waitForTask(submit.taskId, apiKey, undefined, ASR_MAX_WAIT_MS, ASR_POLL_INTERVAL_MS);
    const text = (result.text || '').trim();
    if (!result.success || !text) {
      log.warn('input_audio asr failed', { taskId: submit.taskId, error: result.error ?? 'empty_transcript' });
      return { ok: false, reason: result.error ?? 'empty_transcript' };
    }

    log.debug('input_audio transcribed', {
      bytes: preflight.size,
      audioMs: result.totalDuration,
      elapsedMs: Date.now() - startedAt,
      chars: text.length,
    });
    onProgress?.('done', { audioMs: result.totalDuration > 0 ? result.totalDuration : undefined });
    return { ok: true, text };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn('input_audio transcribe error', { err: message });
    return { ok: false, reason: message };
  }
}
