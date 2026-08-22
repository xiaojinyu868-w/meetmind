/**
 * teach-store — v32 课程会话的 localStorage 持久化（mock 阶段模拟
 * GET /api/teach/threads 历史；后端就绪后由服务端替代，本文件退役）。
 *
 * 存两份：线程元信息列表（ChatGPT 式左侧列表）+ 每线程快照
 * （对话记录 + 画布终态 + mock 续播游标）。快照在 turn-complete /
 * 发消息时落盘；恢复时画布 instant 直出终态，可继续提问。
 */

import type { BoardPage } from '@/lib/ai-native/plugins/board-script';
import type { TeachChatMessage } from './teach-events';

export interface TeachThreadMeta {
  id: string;
  title: string;
  createdAt: number;
}

export interface TeachThreadSnapshot {
  messages: TeachChatMessage[];
  pages: BoardPage[];
  pageIndex: number;
  /** mock 续播游标（flattenScript 单元下标） */
  cursor: number;
  pendingCheckpoint: boolean;
  done: boolean;
}

const LIST_KEY = 'teach:v1:threads';
const SNAP_PREFIX = 'teach:v1:thread:';

function canStore(): boolean {
  try {
    return typeof window !== 'undefined' && Boolean(window.localStorage);
  } catch {
    return false;
  }
}

export function listTeachThreads(): TeachThreadMeta[] {
  if (!canStore()) return [];
  try {
    const raw = window.localStorage.getItem(LIST_KEY);
    const list = raw ? (JSON.parse(raw) as TeachThreadMeta[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveTeachThreadMeta(meta: TeachThreadMeta): void {
  if (!canStore()) return;
  const list = listTeachThreads().filter((item) => item.id !== meta.id);
  list.unshift(meta);
  // 上限 20 课：demo 阶段够了，避免 localStorage 膨胀
  const trimmed = list.slice(0, 20);
  try {
    window.localStorage.setItem(LIST_KEY, JSON.stringify(trimmed));
  } catch {
    // 写不进去（隐私模式/满）不影响演示
  }
}

export function removeTeachThread(id: string): void {
  if (!canStore()) return;
  const list = listTeachThreads().filter((item) => item.id !== id);
  try {
    window.localStorage.setItem(LIST_KEY, JSON.stringify(list));
    window.localStorage.removeItem(`${SNAP_PREFIX}${id}`);
  } catch {
    // 同上
  }
}

export function saveTeachSnapshot(id: string, snapshot: TeachThreadSnapshot): void {
  if (!canStore()) return;
  try {
    window.localStorage.setItem(`${SNAP_PREFIX}${id}`, JSON.stringify(snapshot));
  } catch {
    // 同上
  }
}

export function loadTeachSnapshot(id: string): TeachThreadSnapshot | null {
  if (!canStore()) return null;
  try {
    const raw = window.localStorage.getItem(`${SNAP_PREFIX}${id}`);
    if (!raw) return null;
    const data = JSON.parse(raw) as TeachThreadSnapshot;
    if (!Array.isArray(data.messages) || !Array.isArray(data.pages)) return null;
    return data;
  } catch {
    return null;
  }
}
