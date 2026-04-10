/**
 * useAppStateRestore
 *
 * 应用初始化 + 状态持久化 — 从 page.tsx 提取（Phase 5）
 *
 * 包含：
 *   saveAppState       — 将关键 workspace 状态写入 IndexedDB
 *   persist useEffect  — 依赖变化时自动保存
 *   init useEffect     — 应用启动时从 IndexedDB 恢复状态 / Guest fast-entry
 *
 * 遵循 (deps, refs) 模式。Store 写入通过 getState().actions。
 */

import { useCallback, useEffect } from 'react';
import { useUIStore } from '@/stores/ui-store';
import { usePlayerStore } from '@/stores/player-store';
import { useSessionStore } from '@/stores/session-store';
import { useCollectionStore } from '@/stores/collection-store';
import { useCaptureEditorStore } from '@/stores/capture-editor-store';
import { checkServices } from '@/lib/services/health-check';
import {
  APP_STATE_VERSION,
  getPersistedAppState,
  isPersistedAppStateFresh,
  setPersistedAppState,
  type PersistedAppState,
  type PersistedViewMode,
  type PersistedDataSource,
  type PersistedReviewTab,
  type PersistedVideoWorkspaceTab,
} from '@/lib/services/app-workspace-state';

// ── Deps interface ──

interface UseAppStateRestoreDeps {
  isGuestFastEntry: boolean;
  forceMobilePreview: boolean;
  /** Reactive state for save snapshot */
  appReady: boolean;
  viewMode: PersistedViewMode;
  sessionId: string;
  dataSource: PersistedDataSource;
  reviewTab: PersistedReviewTab;
  videoWorkspaceTab: PersistedVideoWorkspaceTab;
  showTranscriptBar: boolean;
  selectedAnchorId: string | undefined;
  persistedCurrentTime: number;
}

// ── Refs interface ──

interface UseAppStateRestoreRefs {
  hasRestoredState: React.MutableRefObject<boolean>;
}

// ── Hook ──

export function useAppStateRestore(
  deps: UseAppStateRestoreDeps,
  refs: UseAppStateRestoreRefs,
) {
  const {
    isGuestFastEntry,
    forceMobilePreview,
    appReady,
    viewMode,
    sessionId,
    dataSource,
    reviewTab,
    videoWorkspaceTab,
    showTranscriptBar,
    selectedAnchorId,
    persistedCurrentTime,
  } = deps;

  const { hasRestoredState } = refs;

  // ── saveAppState ──
  const saveAppState = useCallback(async () => {
    if (!hasRestoredState.current) return;

    const snapshot: PersistedAppState = {
      version: APP_STATE_VERSION,
      savedAt: Date.now(),
      viewMode,
      sessionId,
      dataSource,
      reviewTab,
      videoWorkspaceTab,
      selectedAnchorId,
      currentTime: persistedCurrentTime,
      showTranscriptBar,
    };

    try {
      await setPersistedAppState(snapshot);
    } catch (err) {
      console.error('Failed to save app state:', err);
    }
  }, [
    dataSource,
    persistedCurrentTime,
    reviewTab,
    selectedAnchorId,
    sessionId,
    showTranscriptBar,
    videoWorkspaceTab,
    viewMode,
  ]);

  // ── Persist key workspace state when dependencies change ──
  useEffect(() => {
    if (!appReady) return;
    void saveAppState();
  }, [appReady, saveAppState]);

  // ── Initialize app (restore state from IndexedDB or guest fast-entry) ──
  useEffect(() => {
    if (hasRestoredState.current) return;

    // Guest fast-entry: mark ready immediately, run init in background
    if (isGuestFastEntry) {
      hasRestoredState.current = true;
      requestAnimationFrame(() => {
        checkServices().then(useSessionStore.getState().actions.setServiceStatus).catch(() => {});
      });
      return;
    }

    const initializeApp = async () => {
     try {
      const uiActions = useUIStore.getState().actions;
      const playerActions = usePlayerStore.getState().actions;
      const sessionActions = useSessionStore.getState().actions;
      const captureEditorActions = useCaptureEditorStore.getState().actions;

      const baseProgress = 10;
      uiActions.setLoadingProgress(baseProgress);

      const [, rawSavedAppState] = await Promise.all([
        checkServices().then(sessionActions.setServiceStatus),
        getPersistedAppState(),
      ]);

      uiActions.setLoadingProgress(40);

      const normalizedSavedState = rawSavedAppState && typeof rawSavedAppState === 'object'
        ? rawSavedAppState
        : null;
      const hasFreshState = isPersistedAppStateFresh(normalizedSavedState);
      const savedAppState = hasFreshState ? normalizedSavedState : null;

      uiActions.setLoadingProgress(50);

      if (savedAppState?.sessionId) {
        sessionActions.setSessionId(savedAppState.sessionId);
      }

      uiActions.setViewMode('record');
      sessionActions.setSelectedAnchor(null);
      if (!savedAppState) {
        sessionActions.setDataSource('live');
        captureEditorActions.setVideoSource(null);
        captureEditorActions.setVideoInsightItems([]);
        captureEditorActions.setActiveVideoInsightId(null);
        uiActions.setVideoWorkspaceTab('chat');
        uiActions.setShowTranscriptBar(false);
      } else if (savedAppState.dataSource !== 'video') {
        captureEditorActions.setVideoSource(null);
        captureEditorActions.setVideoInsightItems([]);
        captureEditorActions.setActiveVideoInsightId(null);
        uiActions.setShowTranscriptBar(false);
        uiActions.setVideoWorkspaceTab(savedAppState.videoWorkspaceTab || 'chat');
      }
      if (typeof savedAppState?.currentTime === 'number' && Number.isFinite(savedAppState.currentTime)) {
        playerActions.setCurrentTime(Math.max(0, Math.floor(savedAppState.currentTime)));
      }
      uiActions.setLoadingProgress(85);

      uiActions.setLoadingProgress(100);
      uiActions.setAppReady(true);
      hasRestoredState.current = true;
     } catch (err) {
      console.error('[initializeApp] Fatal error during init:', err);
      const uiActions = useUIStore.getState().actions;
      uiActions.setLoadingProgress(100);
      uiActions.setAppReady(true);
      hasRestoredState.current = true;
      useCollectionStore.getState().actions.setSourceImportError('刚刚没完全打开，稍后再试一次。');
     }
    };

    initializeApp();
  }, [forceMobilePreview, isGuestFastEntry]); // eslint-disable-line react-hooks/exhaustive-deps
}
