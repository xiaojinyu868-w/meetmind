/**
 * useSeekController
 *
 * 播放跳转 + 时间归一化 — 从 page.tsx 提取（Phase 5）
 *
 * 包含：
 *   normalizeSeekTime  — 将 ms / clock-string 归一化为安全 ms 值
 *   handleVideoSeek    — 视频模式跳转（设置 seekNonce + playNonce）
 *   handleUnifiedSeek  — 统一跳转（video / waveform 自动分派）
 *
 * 遵循 (deps, refs) 模式。Store 写入通过 getState().actions。
 */

import { useCallback } from 'react';
import { usePlayerStore } from '@/stores/player-store';
import { useSessionStore } from '@/stores/session-store';
import type { TranscriptSegment, ImportedVideoSource } from '@/types';
import type { WaveformPlayerRef } from '@/components/WaveformPlayer';

// ── Deps interface ──

interface UseSeekControllerDeps {
  segments: TranscriptSegment[];
  videoSource: ImportedVideoSource | null;
}

// ── Refs interface ──

interface UseSeekControllerRefs {
  waveformRef: React.RefObject<WaveformPlayerRef | null>;
}

// ── Hook ──

export function useSeekController(
  deps: UseSeekControllerDeps,
  refs: UseSeekControllerRefs,
) {
  const { segments, videoSource } = deps;
  const { waveformRef } = refs;

  // ── normalizeSeekTime ──
  const normalizeSeekTime = useCallback((timeMs: number | string): number | null => {
    let numeric: number | null = null;

    if (typeof timeMs === 'string') {
      const trimmed = timeMs.trim();
      const clockMatch = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
      if (clockMatch) {
        const hourPart = clockMatch[3] ? Number(clockMatch[1]) : 0;
        const minutePart = clockMatch[3] ? Number(clockMatch[2]) : Number(clockMatch[1]);
        const secondPart = clockMatch[3] ? Number(clockMatch[3]) : Number(clockMatch[2]);
        if ([hourPart, minutePart, secondPart].every((value) => Number.isFinite(value) && value >= 0)) {
          numeric = ((hourPart * 60 + minutePart) * 60 + secondPart) * 1000;
        }
      } else {
        const parsed = Number(trimmed);
        if (Number.isFinite(parsed)) {
          numeric = parsed;
        }
      }
    } else {
      const parsed = Number(timeMs);
      if (Number.isFinite(parsed)) {
        numeric = parsed;
      }
    }

    if (numeric === null) return null;

    const totalMs = segments.length > 0 ? segments[segments.length - 1].endMs : 0;
    let next = numeric;

    if (next > 0 && next < 1000 && totalMs >= 30000) {
      next *= 1000;
    }

    next = Math.max(0, Math.floor(next));

    if (totalMs > 0) {
      next = Math.min(next, totalMs);
    }

    return next;
  }, [segments]);

  // ── handleVideoSeek ──
  const handleVideoSeek = useCallback((timeMs: number, autoPlay: boolean = false) => {
    const safeTime = normalizeSeekTime(timeMs);
    if (safeTime === null) {
      console.warn('[VideoSeek] Invalid seek time:', timeMs);
      return;
    }
    usePlayerStore.getState().actions.setCurrentTime(safeTime);
    useSessionStore.getState().actions.incrementVideoSeekNonce();
    if (autoPlay) {
      useSessionStore.getState().actions.incrementVideoPlayNonce();
      usePlayerStore.getState().actions.setIsPlaying(true);
    }
  }, [normalizeSeekTime]);

  // ── handleUnifiedSeek ──
  const handleUnifiedSeek = useCallback((timeMs: number, autoPlay: boolean = false) => {
    const safeTime = normalizeSeekTime(timeMs);
    if (safeTime === null) {
      console.warn('[UnifiedSeek] Invalid seek time:', timeMs);
      return;
    }
    if (videoSource) {
      handleVideoSeek(safeTime, autoPlay);
      return;
    }
    usePlayerStore.getState().actions.setCurrentTime(safeTime);
    waveformRef.current?.seekTo(safeTime);
    if (autoPlay) {
      waveformRef.current?.play();
      usePlayerStore.getState().actions.setIsPlaying(true);
    }
  }, [handleVideoSeek, normalizeSeekTime, videoSource]);

  return {
    normalizeSeekTime,
    handleVideoSeek,
    handleUnifiedSeek,
  };
}
