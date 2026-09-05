/**
 * 插图回填 —— teach-codex 线 image 工具调用的课后生图回填。
 *
 * image 工具 execute 只落 prompt（板书先上占位框），生图是慢操作（几十秒级），
 * 不能阻塞 turn：每个 turn 结束 / 线程事件日志被读取（历史回放）时，扫描日志里
 * 尚无配图的 image tool-call，后台逐张生成（dashscope-image-service，与旧
 * teach-agent 线同 provider），落盘 public/uploads/teach/（hash 命名同旧线），
 * 完成后发 image-ready 事件（SSE 推送 + 事件日志追加）——历史回放因此能拿到 url。
 *
 * 哲学同旧线：生图失败不毁课，只记日志、画布留「插图生成中…」占位；
 * 本模块任何路径都不抛异常（触发点全部是 fire-and-forget）。
 *
 * 去重三层：已有 image-ready 事件 → 跳过；inflight 集合 → 同 callId 不并发；
 * 失败冷却（RETRY_AFTER_MS）→ 失败不立刻重试（历史页反复打开不刷爆生图接口）。
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createLogger } from '@/lib/logger';
import {
  generateDashscopeImage,
  isDashscopeImageEnabled,
} from '@/lib/services/dashscope-image-service';
import { publishTeachEvent, type TeachLogEvent } from './event-bus';
import * as store from './thread-store';

const log = createLogger('teach-image');

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads', 'teach');
/** 失败后多久才允许同一张图重试（事件日志无失败记录，冷却只在进程内） */
const RETRY_AFTER_MS = 10 * 60_000;

export interface TeachImageJob {
  /** image tool-call 的事件 id（回填定位键，也是落盘文件名的 hash 源） */
  id: string;
  prompt: string;
  caption?: string;
}

/** 从事件日志挑出缺配图的 image 调用（纯函数，可单测） */
export function collectMissingImageJobs(events: TeachLogEvent[]): TeachImageJob[] {
  const ready = new Set<string>();
  const failed = new Set<string>();
  for (const event of events) {
    if (event.type === 'image-ready') ready.add(event.id);
    if (event.type === 'tool-result') {
      const result = event.result as { ok?: boolean } | undefined;
      if (result?.ok === false) failed.add(event.id);
    }
  }
  const jobs: TeachImageJob[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    if (event.type !== 'tool-call' || event.name !== 'image') continue;
    if (ready.has(event.id) || failed.has(event.id) || seen.has(event.id)) continue;
    const prompt = typeof event.args.prompt === 'string' ? event.args.prompt.trim() : '';
    if (!prompt) continue;
    seen.add(event.id);
    jobs.push({
      id: event.id,
      prompt,
      ...(typeof event.args.caption === 'string' ? { caption: event.args.caption } : {}),
    });
  }
  return jobs;
}

interface BackfillState {
  /** 生成中的 callId（key = `${threadId}:${callId}`），防并发重复生成 */
  inflight: Set<string>;
  /** 最近失败时间（key 同上），冷却期内不再触发 */
  failedAt: Map<string, number>;
}

const globalForBackfill = globalThis as unknown as { __teachImageBackfill?: BackfillState };
const state: BackfillState = globalForBackfill.__teachImageBackfill ?? {
  inflight: new Set(),
  failedAt: new Map(),
};
globalForBackfill.__teachImageBackfill = state;

/**
 * 扫描线程事件日志，对缺配图的 image 调用后台生图回填。
 * 永不抛异常；调用方 fire-and-forget（`void scheduleTeachImageBackfill(...)`）。
 */
export async function scheduleTeachImageBackfill(
  threadId: string,
  events?: TeachLogEvent[],
): Promise<void> {
  let claimed: TeachImageJob[] = [];
  try {
    if (!isDashscopeImageEnabled()) return;
    const jobs = collectMissingImageJobs(events ?? (await store.readThreadEvents(threadId))).filter(
      (job) => {
        const key = `${threadId}:${job.id}`;
        if (state.inflight.has(key)) return false;
        const failedAt = state.failedAt.get(key);
        return !failedAt || Date.now() - failedAt >= RETRY_AFTER_MS;
      },
    );
    if (jobs.length === 0) return;
    // 先同步占位再进入任何 await：并发触发（turn 收尾 × 回放自愈）只生成一次
    for (const job of jobs) state.inflight.add(`${threadId}:${job.id}`);
    claimed = jobs;

    await mkdir(UPLOAD_DIR, { recursive: true });
    for (const job of jobs) {
      const key = `${threadId}:${job.id}`;
      try {
        const generated = await generateDashscopeImage({
          prompt: job.prompt,
          stylePreset: 'chalkboard',
          orientation: 'landscape',
        });
        const ext = generated.mimeType.includes('png') ? 'png' : 'jpg';
        const name = `${createHash('sha1').update(job.id).digest('hex').slice(0, 16)}.${ext}`;
        await writeFile(path.join(UPLOAD_DIR, name), Buffer.from(generated.base64, 'base64'));
        const url = `/uploads/teach/${name}`;
        publishTeachEvent(threadId, { type: 'image-ready', id: job.id, url });
        await store.appendThreadEvent(threadId, { type: 'image-ready', id: job.id, url });
        state.failedAt.delete(key);
        log.info('teach image backfilled', { threadId, toolCallId: job.id, url });
      } catch (cause) {
        state.failedAt.set(key, Date.now());
        log.warn('teach image generation failed', {
          threadId,
          toolCallId: job.id,
          error: cause instanceof Error ? cause.message : String(cause),
        });
      } finally {
        state.inflight.delete(key);
      }
    }
  } catch (cause) {
    // mkdir 等占位后的异常：释放占位，避免这张卡整节课都跳过
    for (const job of claimed) state.inflight.delete(`${threadId}:${job.id}`);
    log.warn('image backfill sweep failed', {
      threadId,
      error: cause instanceof Error ? cause.message : String(cause),
    });
  }
}
