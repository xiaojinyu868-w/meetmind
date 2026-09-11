'use client';

/**
 * draw-runtime-client —— 主线程这边的 <draw> 执行入口：一个共享 Worker + 请求队列 + 超时。
 *
 * 脚本死循环时 2s 超时 → terminate 并重建 worker，其他排队请求各自收到超时错误。
 * Worker 不可用（SSR / 老浏览器）→ 主线程直接跑（仍然没有 DOM 访问，只是少了隔离）。
 */

import type { RunOptions, RunResult } from '@/lib/teach-live-draw/runtime';
import type { DrawWorkerRequest, DrawWorkerResponse } from './draw-worker';

const TIMEOUT_MS = 2000;

interface Pending {
  resolve: (r: RunResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, Pending>();

function spawn(): Worker | null {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') return null;
  try {
    const w = new Worker(new URL('./draw-worker.ts', import.meta.url));
    w.onmessage = (event: MessageEvent<DrawWorkerResponse>) => {
      const p = pending.get(event.data.id);
      if (!p) return;
      clearTimeout(p.timer);
      pending.delete(event.data.id);
      p.resolve(event.data.result);
    };
    w.onerror = () => {
      failAll('worker error');
      restart();
    };
    return w;
  } catch {
    return null;
  }
}

function failAll(reason: string): void {
  for (const [id, p] of pending) {
    clearTimeout(p.timer);
    p.resolve({ ok: false, error: reason, chunk: 0 });
    pending.delete(id);
  }
}

function restart(): void {
  worker?.terminate();
  worker = spawn();
}

async function runOnMainThread(chunks: string[], options: RunOptions): Promise<RunResult> {
  const mod = await import('@/lib/teach-live-draw/runtime');
  try {
    return mod.runDraw(chunks, options);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), chunk: 0 };
  }
}

export function runDrawScript(chunks: string[], options: RunOptions = {}): Promise<RunResult> {
  if (!worker) worker = spawn();
  if (!worker) return runOnMainThread(chunks, options);
  const id = ++seq;
  const request: DrawWorkerRequest = { id, chunks, ...options };
  return new Promise<RunResult>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ ok: false, error: `脚本超过 ${TIMEOUT_MS}ms 未结束（可能死循环）`, chunk: 0 });
      // 卡死的 worker 救不回来：重建，让后面的图还能画
      failAll('worker restarted after timeout');
      restart();
    }, TIMEOUT_MS);
    pending.set(id, { resolve, timer });
    worker!.postMessage(request);
  });
}
