import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { synthesizeBoardNarration } from '@/lib/services/board-tts-service';
import type { WordTiming } from '@/lib/services/board-tts-service';

/**
 * POST /api/board/tts —— 板书 narration 语音合成薄壳
 *
 * { text } → { audio: base64(wav), timings: WordTiming[] }；
 * 未配置 DASHSCOPE_API_KEY / 合成失败 → 503（前端走 speechSynthesis/timer fallback）。
 * 两级缓存（key = text+model+voice+instruction 哈希）：
 * 1. 进程内 LRU（64 条）——热路径零 IO；
 * 2. 磁盘缓存（data/board-tts-cache/，200 条 FIFO）——demo 重复播放、dev 重启
 *    都不再重新合成；免费档 428 惩罚窗口下，这是"第一耳朵必须是真人"的最后防线。
 */

const MAX_TEXT_LENGTH = 500;
const CACHE_CAPACITY = 64;
const DISK_CACHE_DIR = join(process.cwd(), 'data', 'board-tts-cache');
const DISK_CACHE_CAPACITY = 200;

interface TtsPayload {
  audio: string;
  timings: WordTiming[];
}

// 进程内 LRU：Map 迭代序即插入序，过期项删头即可
const cache = new Map<string, TtsPayload>();

function cacheGet(key: string): TtsPayload | null {
  const hit = cache.get(key);
  if (!hit) return null;
  cache.delete(key);
  cache.set(key, hit); // 触碰续热
  return hit;
}

function cacheSet(key: string, value: TtsPayload): void {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  while (cache.size > CACHE_CAPACITY) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function diskCacheGet(key: string): TtsPayload | null {
  try {
    const raw = readFileSync(join(DISK_CACHE_DIR, `${key}.json`), 'utf8');
    return JSON.parse(raw) as TtsPayload;
  } catch {
    return null;
  }
}

function diskCacheSet(key: string, value: TtsPayload): void {
  try {
    mkdirSync(DISK_CACHE_DIR, { recursive: true });
    writeFileSync(join(DISK_CACHE_DIR, `${key}.json`), JSON.stringify(value));
    // FIFO 清理：按 mtime 删最旧，避免无界增长（单条约 0.5MB）
    const files = readdirSync(DISK_CACHE_DIR).filter((f) => f.endsWith('.json'));
    if (files.length <= DISK_CACHE_CAPACITY) return;
    const byAge = files
      .map((f) => ({ f, mtime: statSync(join(DISK_CACHE_DIR, f)).mtimeMs }))
      .sort((a, b) => a.mtime - b.mtime);
    for (const { f } of byAge.slice(0, files.length - DISK_CACHE_CAPACITY)) {
      unlinkSync(join(DISK_CACHE_DIR, f));
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
    return NextResponse.json({ error: '请求体必须是 JSON' }, { status: 400 });
  }

  if (typeof text !== 'string' || text.trim().length === 0) {
    return NextResponse.json({ error: 'text 不能为空' }, { status: 400 });
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return NextResponse.json({ error: `text 超过 ${MAX_TEXT_LENGTH} 字上限` }, { status: 400 });
  }

  const cacheKey = createHash('sha256')
    .update(text)
    .update(process.env.DASHSCOPE_TTS_MODEL || '')
    .update(process.env.DASHSCOPE_TTS_VOICE || '')
    .update(process.env.DASHSCOPE_TTS_INSTRUCTION ?? '')
    .digest('hex');

  const cached = cacheGet(cacheKey);
  if (cached) return NextResponse.json(cached);

  const diskHit = diskCacheGet(cacheKey);
  if (diskHit) {
    cacheSet(cacheKey, diskHit);
    return NextResponse.json(diskHit);
  }

  const result = await synthesizeBoardNarration(text);
  if (!result) {
    return NextResponse.json({ error: 'TTS 不可用，请走本地朗读' }, { status: 503 });
  }

  const payload: TtsPayload = {
    audio: result.audio.toString('base64'),
    timings: result.timings,
  };
  cacheSet(cacheKey, payload);
  diskCacheSet(cacheKey, payload);
  return NextResponse.json(payload);
}
