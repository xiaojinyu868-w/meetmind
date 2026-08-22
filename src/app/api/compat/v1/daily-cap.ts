// 清小搭通道每日成本闸 — 进程内计数器
//
// 适配层对公网开放（单 Bearer），这里做用量兜底：chat 请求数与音频转写次数
// 分桶计数，key 为 UTC 日期字符串，跨天自动换桶、懒清理旧桶。
// 闸值 env 可调：XIAODA_DAILY_CHAT_CAP（默认 500）、XIAODA_DAILY_AUDIO_CAP（默认 100）。
//
// 计数时机：chat 在鉴权通过后、业务执行前 +1；音频只在确实进入转写流程时 +1
// （transcribeInputAudio 入口），含音频的请求另在业务执行前做一次音频闸预检。
//
// 注意：PM2 单进程内存计数即可；多实例部署时必须换共享存储（如 Redis），
// 否则各实例各自计数、闸值失真。

import { createLogger } from '@/lib/logger';

const log = createLogger('xiaoda-compat');

interface DayBucket {
  chat: number;
  audio: number;
}

const buckets = new Map<string, DayBucket>();

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function todayBucket(): DayBucket {
  const key = todayKey();
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { chat: 0, audio: 0 };
    buckets.set(key, bucket);
    for (const k of buckets.keys()) {
      if (k !== key) buckets.delete(k);
    }
  }
  return bucket;
}

function capFromEnv(envName: string, fallback: number): number {
  const raw = Number(process.env[envName]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

export function dailyCapExceededResponse(): Response {
  return new Response(
    JSON.stringify({
      error: { type: 'daily_cap_exceeded', message: '今日体验名额已用完，明天再来' },
    }),
    { status: 429, headers: { 'content-type': 'application/json' } },
  );
}

/** chat 闸：鉴权通过后调用；未超闸则计数 +1 放行，超闸返回 429。 */
export function consumeChatQuota(): Response | null {
  const bucket = todayBucket();
  const cap = capFromEnv('XIAODA_DAILY_CHAT_CAP', 500);
  if (bucket.chat >= cap) {
    log.warn('daily chat cap exceeded', { count: bucket.chat, cap });
    return dailyCapExceededResponse();
  }
  bucket.chat += 1;
  return null;
}

/** 音频闸预检（不计数）：请求含 input_audio 时在业务执行前调用。 */
export function isAudioCapExceeded(): boolean {
  const bucket = todayBucket();
  const cap = capFromEnv('XIAODA_DAILY_AUDIO_CAP', 100);
  if (bucket.audio >= cap) {
    log.warn('daily audio cap exceeded', { count: bucket.audio, cap });
    return true;
  }
  return false;
}

/** 音频计数：确实进入转写流程时 +1（transcribeInputAudio 入口调用）。 */
export function recordAudioTranscribe(): void {
  todayBucket().audio += 1;
}
