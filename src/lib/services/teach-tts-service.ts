/**
 * teach-tts-service — 讲课声音合成（按句调用）。
 *
 * 默认 provider：百炼 qwen3-tts-instruct-flash（音色 Cherry + 教学语气指令，
 * 选型实测见 out/tts-spike/REPORT.md；复用 DASHSCOPE_API_KEY，零新增凭证）。
 * 端点是非流式的 multimodal-generation（返回 24h 有效音频 URL，需回源下载），
 * 单句 40~80 字实测总耗时 ~1-3s，前端"播第 i 句时预取第 i+1 句"盖住这个延迟。
 *
 * provider 抽象：配置在 teach.config.ts（TEACH_TTS_PROVIDER 一行切换）；
 * 新 provider（备选 MiniMax speech-2.8，百炼渠道）在这里加 case + 注册表一行。
 *
 * 上游限流：串行闸 1 路 + 1s/2s 退避（对齐 board-tts-service 的 428 教训）；
 * 失败返回 null（前端跳过该句，不打断讲课流）。
 */

import { createLogger } from '@/lib/logger';
import { resolveTeachTtsProvider } from '@/lib/config/teach.config';
import type { TeachTtsProviderConfig } from '@/lib/config/teach.config';

const log = createLogger('teach-tts');

const QWEN_ENDPOINT =
  'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
const TIMEOUT_MS = 30_000;
/** 单句上限（路由侧同值校验；按句切分后正常远低于此） */
export const TEACH_TTS_MAX_TEXT = 300;

// 串行闸：上游免费档 QPS 极低，突发预取会吃 428 惩罚性限流
let inFlight = 0;
const queue: Array<() => void> = [];

async function acquireSlot(): Promise<void> {
  if (inFlight >= 1) {
    await new Promise<void>((resolve) => queue.push(resolve));
  }
  inFlight += 1;
}

function releaseSlot(): void {
  inFlight -= 1;
  queue.shift()?.();
}

async function synthesizeQwen(
  config: TeachTtsProviderConfig,
  apiKey: string,
  text: string,
): Promise<Buffer | null> {
  try {
    const response = await fetch(QWEN_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        input: {
          text,
          voice: config.voice,
          language_type: 'Chinese',
          ...(config.instruct ? { instruct: config.instruct } : {}),
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      log.warn('qwen tts http 失败', { status: response.status });
      return null;
    }
    const data = (await response.json()) as {
      output?: { audio?: { url?: string } };
      code?: string;
      message?: string;
    };
    const url = data.output?.audio?.url;
    if (!url) {
      log.warn('qwen tts 无音频 url', { error: data.message ?? data.code });
      return null;
    }
    const audioResponse = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!audioResponse.ok) {
      log.warn('qwen tts 音频回源失败', { status: audioResponse.status });
      return null;
    }
    const audio = Buffer.from(await audioResponse.arrayBuffer());
    return audio.length > 0 ? audio : null;
  } catch (cause) {
    log.warn('qwen tts 请求异常', { error: cause instanceof Error ? cause.message : String(cause) });
    return null;
  }
}

/**
 * 合成一句讲课文本 → wav 音频。未配置 key / 失败 → null（前端跳过该句）。
 */
export async function synthesizeTeachSentence(text: string): Promise<Buffer | null> {
  const input = text.trim();
  if (!input || input.length > TEACH_TTS_MAX_TEXT) return null;
  const apiKey = (process.env.DASHSCOPE_API_KEY || '').trim();
  if (!apiKey) {
    log.warn('DASHSCOPE_API_KEY 未配置，讲课 TTS 不可用');
    return null;
  }
  const provider = resolveTeachTtsProvider();

  await acquireSlot();
  try {
    for (const waitMs of [0, 1000, 2000]) {
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
      let audio: Buffer | null = null;
      if (provider.id === 'qwen-instruct-flash') {
        audio = await synthesizeQwen(provider, apiKey, input);
      } else {
        // 注册了新 provider 但这里没有对应实现
        log.warn('teach tts provider 未实现', { provider: provider.id });
        return null;
      }
      if (audio) return audio;
    }
    return null;
  } finally {
    releaseSlot();
  }
}
