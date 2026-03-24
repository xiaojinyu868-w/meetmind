/**
 * Custom hook for Workshop floating window management.
 *
 * Handles CRUD, z-index ordering, localStorage persistence, and
 * the MAX_ACTIVE_WORKSHOP_WINDOWS limit.
 *
 * Extracted from page.tsx to keep the God File under control.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { type FloatingWorkshopWindowState, getDefaultDisplayMode } from '@/components/apps/windows/WorkshopWindowManager';
import { isWorkshopAppKey, type WorkshopAppKey } from '@/lib/ai-native/app-catalog';
import {
  getWorkshopWindowStorageKey,
  normalizeWorkshopWindows,
} from '@/lib/utils/page-utils';

interface UseWorkshopWindowsParams {
  mounted: boolean;
  sessionId: string;
}

interface UseWorkshopWindowsReturn {
  workshopWindows: FloatingWorkshopWindowState[];
  openWorkshopWindow: (appKey: WorkshopAppKey) => void;
  closeWorkshopWindow: (appKey: WorkshopAppKey) => void;
  toggleWorkshopWindowMinimize: (appKey: WorkshopAppKey) => void;
  focusWorkshopWindow: (appKey: WorkshopAppKey) => void;
}

export function useWorkshopWindows({
  mounted,
  sessionId,
}: UseWorkshopWindowsParams): UseWorkshopWindowsReturn {
  const [workshopWindows, setWorkshopWindows] = useState<FloatingWorkshopWindowState[]>([]);
  const workshopWindowZRef = useRef(20);

  // ── Load from localStorage ──
  useEffect(() => {
    if (!mounted || !sessionId || typeof window === 'undefined') return;
    const raw = window.localStorage.getItem(getWorkshopWindowStorageKey(sessionId));
    if (!raw) {
      setWorkshopWindows([]);
      workshopWindowZRef.current = 20;
      return;
    }
    try {
      const parsed = JSON.parse(raw) as Array<{ appKey?: string; minimized?: boolean; zIndex?: number; displayMode?: string }>;
      if (!Array.isArray(parsed)) {
        setWorkshopWindows([]);
        workshopWindowZRef.current = 20;
        return;
      }
      const next = parsed
        .filter((item) => typeof item.appKey === 'string' && isWorkshopAppKey(item.appKey))
        .map((item, index) => ({
          appKey: item.appKey as WorkshopAppKey,
          minimized: Boolean(item.minimized),
          zIndex: typeof item.zIndex === 'number' && Number.isFinite(item.zIndex) ? item.zIndex : 20 + index,
          displayMode: (item.displayMode === 'panel' || item.displayMode === 'fullscreen') ? item.displayMode : getDefaultDisplayMode(item.appKey as WorkshopAppKey),
        }));
      setWorkshopWindows(normalizeWorkshopWindows(next));
      const maxZ = next.reduce((max, item) => Math.max(max, item.zIndex), 20);
      workshopWindowZRef.current = maxZ;
    } catch {
      setWorkshopWindows([]);
      workshopWindowZRef.current = 20;
    }
  }, [mounted, sessionId]);

  // ── Persist to localStorage ──
  useEffect(() => {
    if (!mounted || !sessionId || typeof window === 'undefined') return;
    const payload = workshopWindows.map((windowState) => ({
      appKey: windowState.appKey,
      minimized: windowState.minimized,
      zIndex: windowState.zIndex,
      displayMode: windowState.displayMode,
    }));
    window.localStorage.setItem(getWorkshopWindowStorageKey(sessionId), JSON.stringify(payload));
  }, [mounted, sessionId, workshopWindows]);

  // ── Window operations ──

  const focusWorkshopWindow = useCallback((appKey: WorkshopAppKey) => {
    setWorkshopWindows((prev) => {
      const current = prev.find((item) => item.appKey === appKey);
      if (!current) return prev;
      const nextZ = workshopWindowZRef.current + 1;
      workshopWindowZRef.current = nextZ;
      return prev.map((item) => (item.appKey === appKey ? { ...item, zIndex: nextZ } : item));
    });
  }, []);

  const openWorkshopWindow = useCallback((appKey: WorkshopAppKey) => {
    setWorkshopWindows((prev) => {
      const existing = prev.find((item) => item.appKey === appKey);
      const nextZ = workshopWindowZRef.current + 1;
      workshopWindowZRef.current = nextZ;

      if (existing) {
        return prev.map((item) =>
          item.appKey === appKey ? { ...item, minimized: false, zIndex: nextZ } : item
        );
      }

      const next = [...prev, { appKey, minimized: false, zIndex: nextZ, displayMode: getDefaultDisplayMode(appKey) }];
      return normalizeWorkshopWindows(next);
    });
  }, []);

  const closeWorkshopWindow = useCallback((appKey: WorkshopAppKey) => {
    setWorkshopWindows((prev) => prev.filter((item) => item.appKey !== appKey));
  }, []);

  const toggleWorkshopWindowMinimize = useCallback((appKey: WorkshopAppKey) => {
    setWorkshopWindows((prev) => {
      const current = prev.find((item) => item.appKey === appKey);
      if (!current) return prev;
      const nextZ = workshopWindowZRef.current + 1;
      workshopWindowZRef.current = nextZ;
      const next = prev.map((item) =>
        item.appKey === appKey ? { ...item, minimized: !item.minimized, zIndex: nextZ } : item
      );
      return normalizeWorkshopWindows(next);
    });
  }, []);

  return {
    workshopWindows,
    openWorkshopWindow,
    closeWorkshopWindow,
    toggleWorkshopWindowMinimize,
    focusWorkshopWindow,
  };
}
