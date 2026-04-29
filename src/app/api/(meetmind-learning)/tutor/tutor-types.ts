/**
 * Tutor 模块共享类型与缓存
 */

import type { Citation } from '@/types/dify';

// ── 摘要缓存（带 TTL 和大小限制，避免内存泄漏） ──

export const SUMMARY_CACHE_MAX_SIZE = 200;
export const SUMMARY_CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2小时

export interface SummaryCacheEntry {
  overview: string;
  takeaways: string;
  keyDifficulties: string[];
  createdAt: number;
}

const summaryCache = new Map<string, SummaryCacheEntry>();

export function getSummaryCache(sessionId: string) {
  const entry = summaryCache.get(sessionId);
  if (!entry) return undefined;
  if (Date.now() - entry.createdAt > SUMMARY_CACHE_TTL_MS) {
    summaryCache.delete(sessionId);
    return undefined;
  }
  return { overview: entry.overview, takeaways: entry.takeaways, keyDifficulties: entry.keyDifficulties };
}

export function setSummaryCache(sessionId: string, data: { overview: string; takeaways: string; keyDifficulties: string[] }) {
  // 超过上限时淘汰最旧的条目
  if (summaryCache.size >= SUMMARY_CACHE_MAX_SIZE) {
    const firstKey = summaryCache.keys().next().value;
    if (firstKey) summaryCache.delete(firstKey);
  }
  summaryCache.set(sessionId, { ...data, createdAt: Date.now() });
}

export function getSummaryCacheEntry(sessionId: string): SummaryCacheEntry | undefined {
  return summaryCache.get(sessionId);
}

// ── Support Reference ──

export interface SupportReference {
  index: number;
  title: string;
  snippet: string;
}

// ── 重导出 Citation 以便其他 tutor 子模块使用 ──

export type { Citation };
