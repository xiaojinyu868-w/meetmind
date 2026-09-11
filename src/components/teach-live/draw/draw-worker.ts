/**
 * draw-worker —— 在 Web Worker 里执行老师写的 <draw> 脚本（无 DOM；网络与存储入口在启动时拆掉）。
 *
 * 协议：主线程 postMessage({ id, chunks, params, transform, fromChunk, idPrefix })
 *      → 本 worker postMessage({ id, result: RunResult })
 * 超时由主线程管（脚本死循环 → 主线程 terminate 并重建 worker）。
 */

import { runDraw, type RunOptions, type RunResult } from '@/lib/teach-live-draw/runtime';

export interface DrawWorkerRequest extends RunOptions {
  id: number;
  chunks: string[];
}

export interface DrawWorkerResponse {
  id: number;
  result: RunResult;
}

// 老师的脚本只该算几何：把 worker 全局里能碰网络 / 存储 / 加载代码的口全部拆掉
const scope = self as unknown as Record<string, unknown>;
for (const key of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB', 'caches', 'navigator', 'BroadcastChannel', 'SharedWorker', 'Worker']) {
  try {
    Object.defineProperty(scope, key, { value: undefined, configurable: false, writable: false });
  } catch {
    try {
      scope[key] = undefined;
    } catch {
      // 只读全局：忽略
    }
  }
}

self.onmessage = (event: MessageEvent<DrawWorkerRequest>) => {
  const { id, chunks, ...options } = event.data;
  let result: RunResult;
  try {
    result = runDraw(chunks, options);
  } catch (err) {
    result = { ok: false, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err), chunk: 0 };
  }
  const response: DrawWorkerResponse = { id, result };
  (self as unknown as { postMessage(msg: DrawWorkerResponse): void }).postMessage(response);
};
