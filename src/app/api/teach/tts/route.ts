import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TeachConfig, resolveTeachTtsProviderFor } from '@/lib/config/teach.config';
import { streamTeachSentence, synthesizeTeachSentence, TEACH_TTS_MAX_TEXT } from '@/lib/services/teach-tts-service';
import { pcmToWav, wavPcmPayload, TEACH_TTS_PCM_BITS, TEACH_TTS_PCM_CHANNELS, TEACH_TTS_PCM_SAMPLE_RATE } from '@/lib/services/teach-tts-stream';

/**
 * POST /api/teach/tts —— 讲课声音合成薄壳（按句调用）。
 *
 * { text, voice?, instruct? } → wav 音频二进制流（Content-Type: audio/wav）；合成不可用 → 503
 * （前端跳过该句继续讲课，不降级机器人音）。
 * voice 只认 TEACH_TTS_VOICE_ALLOWLIST（2026-09-10 起，讲给同桌听的三位评委各有声音），
 * 不在名单里回落默认音色；instruct 可按句覆盖语气（≤80 字）。
 * 两级缓存（key = text+provider+model+voice+instruct 哈希，对齐 /api/board/tts 模式）：
 * 进程内 LRU 64 条 + 磁盘 data/teach-tts-cache/ 200 条 FIFO。
 *
 * `stream: true`（2026-09-11，讲给同桌听）：边合成边发——响应是裸 PCM 分片（Content-Type: audio/pcm，
 * 采样率 / 声道 / 位深在 X-Teach-Tts-Sample-Rate / -Channels / -Bits 头里），首片实测 0.4s 到；
 * 缓存命中时把缓存 wav 抠成 PCM 同样以 audio/pcm 返回；上游流式不可用时静默退回 audio/wav 整块——
 * 客户端按 Content-Type 分流（speech-pipeline 的 PCM 流式句柄 / Blob 句柄），旧调用方不传 stream 行为不变。
 */

function pcmHeaders(sampleRate: number, channels: number, bits: number, cache: 'hit' | 'miss'): HeadersInit {
  return {
    'Content-Type': 'audio/pcm',
    'Cache-Control': 'no-store',
    'X-Accel-Buffering': 'no',
    'X-Teach-Tts-Cache': cache,
    'X-Teach-Tts-Sample-Rate': String(sampleRate),
    'X-Teach-Tts-Channels': String(channels),
    'X-Teach-Tts-Bits': String(bits),
  };
}

const CACHE_CAPACITY = 64;
const DISK_CACHE_CAPACITY = 200;

// 进程内 LRU：Map 迭代序即插入序，过期项删头即可
const cache = new Map<string, Buffer>();

function cacheGet(key: string): Buffer | null {
  const hit = cache.get(key);
  if (!hit) return null;
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

function cacheSet(key: string, value: Buffer): void {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  while (cache.size > CACHE_CAPACITY) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function diskPath(key: string): string {
  return join(process.cwd(), TeachConfig.ttsCacheDir, `${key}.wav`);
}

function diskCacheGet(key: string): Buffer | null {
  try {
    return readFileSync(diskPath(key));
  } catch {
    return null;
  }
}

function diskCacheSet(key: string, value: Buffer): void {
  try {
    const dir = join(process.cwd(), TeachConfig.ttsCacheDir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(diskPath(key), value);
    const files = readdirSync(dir).filter((f) => f.endsWith('.wav'));
    if (files.length <= DISK_CACHE_CAPACITY) return;
    const byAge = files
      .map((f) => ({ f, mtime: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => a.mtime - b.mtime);
    for (const { f } of byAge.slice(0, files.length - DISK_CACHE_CAPACITY)) {
      unlinkSync(join(dir, f));
    }
  } catch {
    // 磁盘缓存是锦上添花，写失败不影响主流程
  }
}

export async function POST(request: Request) {
  let text: unknown;
  let voice: string | undefined;
  let instruct: string | undefined;
  let stream = false;
  try {
    const body = (await request.json()) as { text?: unknown; voice?: unknown; instruct?: unknown; stream?: unknown };
    text = body.text;
    voice = typeof body.voice === 'string' ? body.voice : undefined;
    instruct = typeof body.instruct === 'string' ? body.instruct : undefined;
    stream = body.stream === true;
  } catch {
    return Response.json({ error: '请求体必须是 JSON' }, { status: 400 });
  }
  if (typeof text !== 'string' || text.trim().length === 0) {
    return Response.json({ error: 'text 不能为空' }, { status: 400 });
  }
  if (text.length > TEACH_TTS_MAX_TEXT) {
    return Response.json({ error: `text 超过 ${TEACH_TTS_MAX_TEXT} 字上限` }, { status: 400 });
  }

  const provider = resolveTeachTtsProviderFor({ voice, instruct });
  const cacheKey = createHash('sha256')
    .update(text)
    .update(provider.id)
    .update(provider.model)
    .update(provider.voice)
    .update(provider.instruct)
    .digest('hex');

  const cached = cacheGet(cacheKey) ?? diskCacheGet(cacheKey);
  if (cached) {
    cacheSet(cacheKey, cached);
    if (stream) {
      const payload = wavPcmPayload(new Uint8Array(cached));
      if (payload) {
        return new Response(new Uint8Array(payload.pcm), { headers: pcmHeaders(payload.sampleRate, payload.channels, payload.bits, 'hit') });
      }
    }
    return new Response(new Uint8Array(cached), {
      headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store', 'X-Teach-Tts-Cache': 'hit' },
    });
  }

  if (stream) {
    const streamed = await streamTeachSentence(text, provider);
    if (streamed) {
      void streamed.complete.then((pcm) => {
        if (!pcm || pcm.byteLength === 0) return;
        const wav = Buffer.from(pcmToWav(pcm));
        cacheSet(cacheKey, wav);
        diskCacheSet(cacheKey, wav);
      });
      return new Response(streamed.stream, {
        headers: pcmHeaders(TEACH_TTS_PCM_SAMPLE_RATE, TEACH_TTS_PCM_CHANNELS, TEACH_TTS_PCM_BITS, 'miss'),
      });
    }
    // 流式首片没拿到：退回整块合成（客户端按 audio/wav 走 Blob 句柄）
  }

  const audio = await synthesizeTeachSentence(text, provider);
  if (!audio) {
    return Response.json({ error: 'TTS 不可用' }, { status: 503 });
  }
  cacheSet(cacheKey, audio);
  diskCacheSet(cacheKey, audio);
  return new Response(new Uint8Array(audio), {
    headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store', 'X-Teach-Tts-Cache': 'miss' },
  });
}
