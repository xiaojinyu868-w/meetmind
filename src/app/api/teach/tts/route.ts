import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TeachConfig, resolveTeachTtsProvider } from '@/lib/config/teach.config';
import { synthesizeTeachSentence, TEACH_TTS_MAX_TEXT } from '@/lib/services/teach-tts-service';

/**
 * POST /api/teach/tts —— 讲课声音合成薄壳（按句调用）。
 *
 * { text } → wav 音频二进制流（Content-Type: audio/wav）；合成不可用 → 503
 * （前端跳过该句继续讲课，不降级机器人音）。
 * 两级缓存（key = text+provider+model+voice+instruct 哈希，对齐 /api/board/tts 模式）：
 * 进程内 LRU 64 条 + 磁盘 data/teach-tts-cache/ 200 条 FIFO。
 */

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
  try {
    const body = (await request.json()) as { text?: unknown };
    text = body.text;
  } catch {
    return Response.json({ error: '请求体必须是 JSON' }, { status: 400 });
  }
  if (typeof text !== 'string' || text.trim().length === 0) {
    return Response.json({ error: 'text 不能为空' }, { status: 400 });
  }
  if (text.length > TEACH_TTS_MAX_TEXT) {
    return Response.json({ error: `text 超过 ${TEACH_TTS_MAX_TEXT} 字上限` }, { status: 400 });
  }

  const provider = resolveTeachTtsProvider();
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
    return new Response(new Uint8Array(cached), {
      headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store', 'X-Teach-Tts-Cache': 'hit' },
    });
  }

  const audio = await synthesizeTeachSentence(text);
  if (!audio) {
    return Response.json({ error: 'TTS 不可用' }, { status: 503 });
  }
  cacheSet(cacheKey, audio);
  diskCacheSet(cacheKey, audio);
  return new Response(new Uint8Array(audio), {
    headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store', 'X-Teach-Tts-Cache': 'miss' },
  });
}
