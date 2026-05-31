/**
 * 基础常量、文本工具、键生成器、Workshop 窗口辅助。
 * 这是 page 工具函数的最底层——其它子模块都依赖此文件。
 */

import type { FloatingWorkshopWindowState } from '@/components/apps/windows/WorkshopWindowManager';

// ── Constants ─────────────────────────────────────────────────────

export const ACTION_PROGRESS_KEY_PREFIX = 'action_progress:';
export const WORKSHOP_WINDOW_STATE_PREFIX = 'app_workspace_open_windows:';
export const MAX_ACTIVE_WORKSHOP_WINDOWS = 2;

export const VIDEO_INSIGHT_COLORS = ['#2D4F3E', '#B5483C', '#6B9080', '#D17969', '#1A3327', '#8E3328'];
export const ENABLE_ECHO_MANUAL_TRIGGER =
  process.env.NODE_ENV !== 'production' ||
  String(process.env.NEXT_PUBLIC_ENABLE_ECHO_MANUAL_TRIGGER || '').toLowerCase() === 'true';

// ── Text helpers ──────────────────────────────────────────────────

export function compactText(value: string, maxLength: number): string {
  const normalized = (value || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}...`;
}

export function compactMultilineText(value: string, maxLength: number): string {
  const normalized = (value || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}...`;
}

// ── Key builders ──────────────────────────────────────────────────

export function getActionProgressKey(sessionId: string): string {
  return `${ACTION_PROGRESS_KEY_PREFIX}${sessionId}`;
}

export function getWorkshopWindowStorageKey(sessionId: string): string {
  return `${WORKSHOP_WINDOW_STATE_PREFIX}${sessionId}`;
}

// ── Workshop window helpers ───────────────────────────────────────

export function normalizeWorkshopWindows(windows: FloatingWorkshopWindowState[]): FloatingWorkshopWindowState[] {
  if (windows.length <= MAX_ACTIVE_WORKSHOP_WINDOWS) return windows;

  const active = windows.filter((windowState) => !windowState.minimized);
  if (active.length <= MAX_ACTIVE_WORKSHOP_WINDOWS) return windows;

  const activeToMinimize = active
    .sort((a, b) => a.zIndex - b.zIndex)
    .slice(0, active.length - MAX_ACTIVE_WORKSHOP_WINDOWS)
    .map((windowState) => windowState.appKey);

  if (activeToMinimize.length === 0) return windows;

  const minimizeSet = new Set(activeToMinimize);
  return windows.map((windowState) =>
    minimizeSet.has(windowState.appKey) ? { ...windowState, minimized: true } : windowState
  );
}
