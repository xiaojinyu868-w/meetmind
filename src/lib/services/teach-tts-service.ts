/**
 * teach-tts-service — 讲课声音合成（按句调用）。
 *
 * 默认 provider：百炼 qwen3-tts-instruct-flash（音色 Cherry + 教学语气指令，
 * 选型实测见 out/tts-spike/REPORT.md；复用 DASHSCOPE_API_KEY，零新增凭证）。
 * 同一个 multimodal-generation 端点两种用法：
 * - 非流式（synthesizeTeachSentence）：整句合成完返回 24h 有效音频 URL、回源下载成 wav。
 *   单句 40~80 字实测总耗时 ~1-3s，前端"播第 i 句时预取第 i+1 句"盖住这个延迟。
 * - 流式（streamTeachSentence，2026-09-11）：`X-DashScope-SSE: enable` + `parameters.stream=true`，
 *   base64 PCM（24kHz/16bit/mono）分片到达，首片实测 0.4s——「讲给同桌听」评委开口靠它从 2.4s 压到 0.5s 内出声。
 *   首片到之前失败返回 null，调用方退回非流式；整段收齐后 `complete` 给出完整 PCM 供缓存。
 *
 * provider 抽象：配置在 teach.config.ts（TEACH_TTS_PROVIDER 一行切换）；
 * 新 provider（备选 MiniMax speech-2.8，百炼渠道）在这里加 case + 注册表一行。
 *
 * 上游限流：串行闸 1 路 + 1s/2s 退避（对齐 board-tts-service 的 428 教训）；流式请求占闸到上游流结束。
 * 失败返回 null（前端跳过该句，不打断讲课流）。
 */

import { createLogger } from '@/lib/logger';
import { resolveTeachTtsProvider } from '@/lib/config/teach.config';
import type { TeachTtsProviderConfig } from '@/lib/config/teach.config';
import { parseTtsSseChunk } from '@/lib/services/teach-tts-stream';

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

export interface TeachTtsStream {
  /** 裸 PCM 片流（24kHz / 16bit / 单声道），首片已经在里面 */
  stream: ReadableStream<Uint8Array>;
  /** 整段收齐后的完整 PCM（供缓存）；上游中途出错 / 被中止 → null */
  complete: Promise<Uint8Array | null>;
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * 流式合成一句：首片到手才返回（之前任何失败都是 null，调用方退回非流式）；之后的片按到达顺序进 stream。
 * 串行闸从发请求占到上游流结束（与非流式同一把闸，上游 QPS 极低）。
 */
export async function streamTeachSentence(text: string, providerOverride?: TeachTtsProviderConfig): Promise<TeachTtsStream | null> {
  const input = text.trim();
  if (!input || input.length > TEACH_TTS_MAX_TEXT) return null;
  const apiKey = (process.env.DASHSCOPE_API_KEY || '').trim();
  if (!apiKey) {
    log.warn('DASHSCOPE_API_KEY 未配置，讲课 TTS 不可用');
    return null;
  }
  const provider = providerOverride ?? resolveTeachTtsProvider();
  if (provider.id !== 'qwen-instruct-flash') {
    log.warn('teach tts provider 不支持流式', { provider: provider.id });
    return null;
  }

  await acquireSlot();
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    releaseSlot();
  };

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    const response = await fetch(QWEN_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-DashScope-SSE': 'enable',
      },
      body: JSON.stringify({
        model: provider.model,
        input: {
          text: input,
          voice: provider.voice,
          language_type: 'Chinese',
          ...(provider.instruct ? { instruct: provider.instruct } : {}),
        },
        parameters: { stream: true },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok || !response.body) {
      log.warn('qwen tts 流式 http 失败', { status: response.status });
      release();
      return null;
    }
    reader = response.body.getReader();
  } catch (cause) {
    log.warn('qwen tts 流式请求异常', { error: cause instanceof Error ? cause.message : String(cause) });
    release();
    return null;
  }

  const decoder = new TextDecoder();
  let carry = '';
  const collected: Uint8Array[] = [];
  let clean = true;

  // 首片：拿到才算流式成功
  const first: Uint8Array[] = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      const parsed = parseTtsSseChunk(carry, decoder.decode(value ?? new Uint8Array(), { stream: !done }));
      carry = parsed.rest;
      if (parsed.error) {
        log.warn('qwen tts 流式上游报错', { error: parsed.error });
        reader.cancel().catch(() => undefined);
        release();
        return null;
      }
      first.push(...parsed.chunks);
      if (first.length > 0 || done) break;
    }
  } catch (cause) {
    log.warn('qwen tts 流式首片异常', { error: cause instanceof Error ? cause.message : String(cause) });
    release();
    return null;
  }
  if (first.length === 0) {
    log.warn('qwen tts 流式无音频产出');
    release();
    return null;
  }
  collected.push(...first);

  let resolveComplete: (pcm: Uint8Array | null) => void = () => undefined;
  const complete = new Promise<Uint8Array | null>((resolve) => {
    resolveComplete = resolve;
  });

  // 上游按自己的节奏读完（合成多久占闸多久，与客户端是否在读无关——预取的下一句可能几秒后才开始播）；
  // 响应流从队列里拿。客户端断开就取消上游，把闸早点让出来。
  const queue: Uint8Array[] = [...first];
  let upstreamDone = false;
  let cancelled = false;
  let waiter: (() => void) | null = null;
  const wake = () => {
    waiter?.();
    waiter = null;
  };
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (cancelled) break;
        const parsed = parseTtsSseChunk(carry, decoder.decode(value ?? new Uint8Array(), { stream: !done }));
        carry = parsed.rest;
        if (parsed.error) {
          clean = false;
          log.warn('qwen tts 流式中途报错', { error: parsed.error });
        }
        for (const chunk of parsed.chunks) {
          collected.push(chunk);
          queue.push(chunk);
        }
        wake();
        if (done) break;
      }
    } catch (cause) {
      clean = false;
      if (!cancelled) log.warn('qwen tts 流式读取异常', { error: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      upstreamDone = true;
      release();
      resolveComplete(clean && !cancelled ? concatChunks(collected) : null);
      wake();
    }
  })();

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      while (queue.length === 0 && !upstreamDone) {
        await new Promise<void>((resolve) => {
          waiter = resolve;
        });
      }
      const chunk = queue.shift();
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
    cancel() {
      cancelled = true;
      reader.cancel().catch(() => undefined);
    },
  });

  return { stream, complete };
}

/**
 * 合成一句讲课文本 → wav 音频。未配置 key / 失败 → null（前端跳过该句）。
 * provider 可由调用方传入（按句覆盖音色 / 语气，见 teach.config resolveTeachTtsProviderFor）；不传用默认。
 */
export async function synthesizeTeachSentence(text: string, providerOverride?: TeachTtsProviderConfig): Promise<Buffer | null> {
  const input = text.trim();
  if (!input || input.length > TEACH_TTS_MAX_TEXT) return null;
  const apiKey = (process.env.DASHSCOPE_API_KEY || '').trim();
  if (!apiKey) {
    log.warn('DASHSCOPE_API_KEY 未配置，讲课 TTS 不可用');
    return null;
  }
  const provider = providerOverride ?? resolveTeachTtsProvider();

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
