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

import { useCallback, useEffect, useRef } from 'react';
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
  /**
   * R9-3 修：从 /settings 等页面 router.back() 回到 /app 时恢复 review 视图。
   *
   * 之前的注释说不能恢复 review 因为 hook 没法访问 restoreReviewSession——
   * 现在通过这个 callback 由 page.tsx 注入 restoreReviewSession 引用。
   *
   * 用户痛点：在课后学习页 → 进设置 → 返回 → 永远回到课堂态（review state 丢失）。
   * 真因：useAppStateRestore 在 mount 时强制 setViewMode('classroom')。
   *
   * 这个 callback 接受 saved sessionId + 完整 saved state，调用方负责：
   *   (1) 调用 restoreReviewSession(sessionId, options)
   *   (2) 恢复 video / audio / segments 数据
   *   (3) 内部 setViewMode('review')
   * 返回 true 表示恢复成功（会跳过默认 setViewMode('classroom')）。
   */
  onRestoreReviewSession?: (
    sessionId: string,
    saved: { reviewTab?: PersistedReviewTab; videoWorkspaceTab?: PersistedVideoWorkspaceTab; currentTime?: number; showTranscriptBar?: boolean }
  ) => Promise<boolean>;
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
    onRestoreReviewSession,
  } = deps;

  const { hasRestoredState } = refs;

  // R9-3：把最新 onRestoreReviewSession 存到 ref，让 init useEffect 内闭包永远拿到最新引用。
  // useEffect 只跑一次（mount 时），但此时 page.tsx 传入的 callback 可能还引用了 stale state。
  const onRestoreReviewSessionRef = useRef(onRestoreReviewSession);
  onRestoreReviewSessionRef.current = onRestoreReviewSession;

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

      // ── Phase 1：设置基础 UI 状态 + 立即 dismiss splash ──
      // review session 恢复（Phase 2）放到后台异步执行，不阻塞 UI 渲染。
      // 用户立刻看到 app（默认 classroom 态），review 数据加载完后自动切换。
      if (!savedAppState || savedAppState.viewMode !== 'review') {
        uiActions.setViewMode('classroom');
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
      }
      // savedAppState.viewMode === 'review' 时，viewMode 保持 store 默认 'classroom'，
      // Phase 2 的 restoreCallback 会切到 'review'；失败则保持 'classroom'。

      // Phase 1 done — dismiss splash, app is visible and interactive
      uiActions.setLoadingProgress(100);
      uiActions.setAppReady(true);
      hasRestoredState.current = true;

      // ── Phase 2（后台）：恢复 review session ──
      // 非阻塞——用户已经看到 app 了。review 数据加载完后自动切到 review 态；
      // 如果恢复失败，fallback 到 classroom。
      const restoreCallback = onRestoreReviewSessionRef.current;
      if (savedAppState?.viewMode === 'review' && savedAppState.sessionId && restoreCallback) {
        restoreCallback(savedAppState.sessionId, {
          reviewTab: savedAppState.reviewTab,
          videoWorkspaceTab: savedAppState.videoWorkspaceTab,
          currentTime: savedAppState.currentTime,
          showTranscriptBar: savedAppState.showTranscriptBar,
        }).then((reviewRestored) => {
          if (!reviewRestored) {
            useUIStore.getState().actions.setViewMode('classroom');
          }
          useSessionStore.getState().actions.setSelectedAnchor(null);
        }).catch((err) => {
          console.error('[initializeApp] background restoreReviewSession failed:', err);
          useUIStore.getState().actions.setViewMode('classroom');
        });
      }
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
