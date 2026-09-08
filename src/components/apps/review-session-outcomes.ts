'use client';

/**
 * review-session-outcomes — 一节课复习会话内的应用结果（测验 / 闪卡 / 讲给同桌听）。
 *
 * 为什么单独存：应用之间要"知道彼此"——测验错的点该进闪卡的困惑上下文、路径卡要能说
 * "5 题对 3"——而这些结果此前只活在 DesktopVideoReviewLayout 的 useState 里，刷新即失，
 * 也传不进应用执行。这里用 localStorage（按 sessionId）+ 进程内订阅，任何组件都能读写，
 * 不用把 props 穿过 page.tsx。
 *
 * 边界：这是**会话层**记忆（这节课、这台设备），不是学习者的长期记忆——后者走
 * LearningEvent（useAppLearningActivity.recordAssessment）。两者互不替代。
 */

import { useSyncExternalStore } from 'react';
import type { LearningAssessmentDraft } from '@/types/learning-event';

export interface StoredAssessment extends LearningAssessmentDraft {
  at: number;
}

const STORAGE_PREFIX = 'mm-review-outcomes:';
const MAX_STORED = 24;
const EMPTY: StoredAssessment[] = [];

const listeners = new Set<() => void>();
const cache = new Map<string, StoredAssessment[]>();

function storageKey(sessionId: string): string {
  return `${STORAGE_PREFIX}${sessionId}`;
}

function readStorage(sessionId: string): StoredAssessment[] {
  if (typeof window === 'undefined') return EMPTY;
  try {
    const raw = window.localStorage.getItem(storageKey(sessionId));
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return EMPTY;
    return parsed.filter((item): item is StoredAssessment => (
      Boolean(item) && typeof (item as StoredAssessment).appKey === 'string' && Array.isArray((item as StoredAssessment).items)
    ));
  } catch {
    return EMPTY;
  }
}

function writeStorage(sessionId: string, value: StoredAssessment[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(sessionId), JSON.stringify(value));
  } catch { /* 配额或隐私模式：会话层记忆丢了不影响学习 */ }
}

export function getSessionOutcomes(sessionId: string): StoredAssessment[] {
  if (!sessionId) return EMPTY;
  const cached = cache.get(sessionId);
  if (cached) return cached;
  const loaded = readStorage(sessionId);
  cache.set(sessionId, loaded);
  return loaded;
}

/** 追加一次应用结果（同 appKey 保留历史，路径卡取最近一次）。 */
export function recordSessionAssessment(sessionId: string, draft: LearningAssessmentDraft): void {
  if (!sessionId || draft.items.length === 0) return;
  const next = [...getSessionOutcomes(sessionId), { ...draft, at: Date.now() }].slice(-MAX_STORED);
  cache.set(sessionId, next);
  writeStorage(sessionId, next);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 任何组件订阅同一节课的结果；服务端渲染与无 sessionId 时为空。 */
export function useSessionOutcomes(sessionId: string): StoredAssessment[] {
  return useSyncExternalStore(
    subscribe,
    () => getSessionOutcomes(sessionId),
    () => EMPTY,
  );
}
