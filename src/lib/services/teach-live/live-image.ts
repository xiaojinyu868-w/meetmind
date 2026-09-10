/**
 * live-image —— <image prompt="…"/> 块的异步生图（慢操作，永不阻塞讲课）。
 *
 * 块一闭合就开始生成（比 teach-codex 线「turn 收尾再回填」早半分钟）；完成后发
 * image-ready（SSE + 事件日志）。历史回放时再扫一遍缺图的块自愈。
 * 失败不毁课：占位卡留在板上，10 分钟冷却后允许重试。与 teach-codex/image-backfill
 * 同一套纪律，落盘目录独立（public/uploads/teach-live/）。
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createLogger } from '@/lib/logger';
import { generateDashscopeImage, isDashscopeImageEnabled } from '@/lib/services/dashscope-image-service';
import { publishTeachEvent, type TeachLogEvent } from '../teach-codex/event-bus';
import * as store from '../teach-codex/thread-store';

const log = createLogger('teach-live-image');
const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads', 'teach-live');
const RETRY_AFTER_MS = 10 * 60_000;

interface ImageState {
  inflight: Set<string>;
  failedAt: Map<string, number>;
}
const globalForImages = globalThis as unknown as { __teachLiveImages?: ImageState };
const state: ImageState = globalForImages.__teachLiveImages ?? { inflight: new Set(), failedAt: new Map() };
globalForImages.__teachLiveImages = state;

export function isLiveImageEnabled(): boolean {
  return isDashscopeImageEnabled();
}

/** 生成一张图并广播 image-ready；任何路径不抛异常（调用方 fire-and-forget） */
export async function generateLiveImage(threadId: string, blockId: string, prompt: string): Promise<void> {
  const key = `${threadId}:${blockId}`;
  if (!isDashscopeImageEnabled() || !prompt.trim()) return;
  if (state.inflight.has(key)) return;
  const failedAt = state.failedAt.get(key);
  if (failedAt && Date.now() - failedAt < RETRY_AFTER_MS) return;
  state.inflight.add(key);
  const startedAt = Date.now();
  try {
    await mkdir(UPLOAD_DIR, { recursive: true });
    const generated = await generateDashscopeImage({
      prompt: prompt.trim(),
      stylePreset: '课堂插图：真实感或半写实，主体清晰居中，光线柔和，画面里不要出现任何文字与水印',
      orientation: 'landscape',
      detailLevel: 'standard',
    });
    const ext = generated.mimeType.includes('png') ? 'png' : 'jpg';
    const name = `${createHash('sha1').update(key).digest('hex').slice(0, 16)}.${ext}`;
    await writeFile(path.join(UPLOAD_DIR, name), Buffer.from(generated.base64, 'base64'));
    const url = `/uploads/teach-live/${name}`;
    publishTeachEvent(threadId, { type: 'image-ready', id: blockId, url });
    await store.appendThreadEvent(threadId, { type: 'image-ready', id: blockId, url });
    state.failedAt.delete(key);
    log.info('live image ready', { threadId, blockId, url, ms: Date.now() - startedAt });
  } catch (cause) {
    state.failedAt.set(key, Date.now());
    log.warn('live image generation failed', {
      threadId,
      blockId,
      error: cause instanceof Error ? cause.message : String(cause),
    });
  } finally {
    state.inflight.delete(key);
  }
}

/** 历史回放自愈：找出缺图的 image 块（纯函数） */
export function collectMissingLiveImages(events: TeachLogEvent[]): Array<{ id: string; prompt: string }> {
  const ready = new Set<string>();
  for (const ev of events) if (ev.type === 'image-ready') ready.add(ev.id);
  const jobs: Array<{ id: string; prompt: string }> = [];
  const bodies = new Map<string, { prompt: string; body: string }>();
  for (const ev of events) {
    if (ev.type === 'block-open' && ev.kind === 'image') bodies.set(ev.id, { prompt: ev.attrs.prompt ?? '', body: '' });
    else if (ev.type === 'block-delta' && bodies.has(ev.id)) bodies.get(ev.id)!.body += ev.text;
  }
  for (const [id, { prompt, body }] of bodies) {
    if (ready.has(id)) continue;
    const text = (prompt || body).trim();
    if (text) jobs.push({ id, prompt: text });
  }
  return jobs;
}

export function scheduleMissingLiveImages(threadId: string, events: TeachLogEvent[]): void {
  for (const job of collectMissingLiveImages(events)) void generateLiveImage(threadId, job.id, job.prompt);
}
