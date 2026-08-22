'use client';

import { useCallback, useEffect, useMemo, useRef, type ClipboardEvent, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { useCollectionStore } from '@/stores/collection-store';
import { useUIStore } from '@/stores/ui-store';
import { useSessionStore } from '@/stores/session-store';
import { useCaptureEditorStore } from '@/stores/capture-editor-store';
import {
  detectReachFromText,
  type ContextReachDetection,
} from '@/lib/context-reach';
import { parseVideoLink } from '@/lib/utils/video-link';
import {
  resolveCollectionContextPrimaryId,
  getCollectionContextDisplayTitle,
  getCollectionContextTypeLabel,
} from '@/lib/capture/collection-context';
import {
  compactText,
  resolveSourceItemSourceKey,
  buildSourcePreviewText,
  buildSupportReferenceSnippet,
  formatRelativeCollectionTime,
} from '@/lib/utils/page-utils';
import type {
  SourceIngestItem,
  SourceIngestRole,
  SourceProvenance,
} from '@/types/page-types';
import { buildSourceProvenance } from '@/lib/capture/source-provenance';
import { COPY } from '@/lib/ui/copy';
import { useVoiceInput } from '@/hooks/useVoiceInput';
import type { RecorderHandle } from '@/components/Recorder';

// ─── Types ───────────────────────────────────────────────────────────────

export interface UseCollectionComposerDeps {
  /** Append a support source (from composer submit) */
  appendSupportSource: (params: {
    id?: string;
    sourceKey?: string;
    type: 'document' | 'text';
    title: string;
    segments: { id: string; text: string; startMs: number; endMs: number; confidence: number; isFinal?: boolean }[];
    provenance?: SourceProvenance;
  }) => { supportId: string; reference: string | null };
  /** Persist capture to workspace API */
  persistCaptureToWorkspace: (params: {
    sourceType: string;
    sourceKey: string;
    role: string;
    contentType: string;
    title: string;
    previewText?: string;
    normalizedText?: string;
    sourceUrl?: string;
    mediaUrl?: string;
    tutorContext?: string;
    occurredAt?: string;
    metadata?: Record<string, unknown>;
  }) => void;
  /** Import a composer link (from useSourceImport) */
  importComposerVideoLink: (url: string, composerText?: string) => Promise<void>;
  /** Handle file imports */
  handleImportFiles: (files: File[] | FileList, mode?: 'audio' | 'support' | 'all', options?: { sessionId?: string; capturedAtMs?: number }) => Promise<void>;
  /** Handle source file button click */
  handleSourceFileButtonClick: (mode?: 'audio' | 'support' | 'all') => void;
  /** Whether device is mobile */
  isMobile: boolean;
}

export interface UseCollectionComposerRefs {
  /** Collection composer textarea ref */
  collectionComposerRef: RefObject<HTMLTextAreaElement | null>;
  /** Collection scroll container ref */
  collectionScrollRef: RefObject<HTMLDivElement | null>;
  /** Scroll near bottom tracking */
  collectionScrollNearBottomRef: RefObject<boolean>;
  /** Feed items count tracker for auto-scroll */
  prevCollectionCountRef: RefObject<number>;
  /** Long press timer ref */
  collectionLongPressTimerRef: RefObject<number | null>;
  /** Long press triggered tracker */
  collectionLongPressTriggeredRef: RefObject<boolean>;
  /** Segments ref for composer submit */
  segmentsRef: RefObject<{ id: string; text: string; startMs: number; endMs: number; confidence: number; isFinal?: boolean }[]>;
  /** Recorder ref for openLiveRecorder */
  recorderRef: RefObject<RecorderHandle | null>;
}

// ─── Hook ────────────────────────────────────────────────────────────────

export function useCollectionComposer(
  deps: UseCollectionComposerDeps,
  refs: UseCollectionComposerRefs,
) {
  const {
    appendSupportSource,
    persistCaptureToWorkspace,
    importComposerVideoLink,
    handleImportFiles,
    handleSourceFileButtonClick,
    isMobile,
  } = deps;

  const {
    collectionComposerRef,
    collectionScrollRef,
    collectionScrollNearBottomRef,
    prevCollectionCountRef,
    collectionLongPressTimerRef,
    collectionLongPressTriggeredRef,
    segmentsRef,
    recorderRef,
  } = refs;

  // ── Store selectors ──────────────────────────────────────────────────
  const collectionActions = useCollectionStore((s) => s.actions);
  const viewMode = useUIStore((s) => s.viewMode);
  const sourceItems = useCollectionStore((s) => s.sourceItems);
  const collectionComposerText = useCollectionStore((s) => s.collectionComposerText);
  const isCollectionContextSelectionMode = useCollectionStore((s) => s.isCollectionContextSelectionMode);
  const selectedCollectionContextIds = useCollectionStore((s) => s.selectedCollectionContextIds);
  const selectedCollectionPrimaryId = useCollectionStore((s) => s.selectedCollectionPrimaryId);
  const quotedCollectionContextIds = useCollectionStore((s) => s.quotedCollectionContextIds);
  const quotedCollectionPrimaryId = useCollectionStore((s) => s.quotedCollectionPrimaryId);
  const activeCollectionMessageMenuId = useCollectionStore((s) => s.activeCollectionMessageMenuId);
  const confirmCollectionDeleteId = useCollectionStore((s) => s.confirmCollectionDeleteId);
  const showScrollToLatest = useCollectionStore((s) => s.showScrollToLatest);

  const setSourceItems = collectionActions.setSourceItems;
  const setCollectionComposerText = collectionActions.setCollectionComposerText;
  const setShowCollectionPulsePreview = collectionActions.setShowCollectionPulsePreview;
  const setShowScrollToLatest = collectionActions.setShowScrollToLatest;
  const setIsCollectionContextSelectionMode = collectionActions.setIsCollectionContextSelectionMode;
  const setSelectedCollectionContextIds = collectionActions.setSelectedCollectionContextIds;
  const setSelectedCollectionPrimaryId = collectionActions.setSelectedCollectionPrimaryId;
  const setQuotedCollectionContextIds = collectionActions.setQuotedCollectionContextIds;
  const setQuotedCollectionPrimaryId = collectionActions.setQuotedCollectionPrimaryId;
  const setConfirmSelectedCollectionDelete = collectionActions.setConfirmSelectedCollectionDelete;
  const setActiveCollectionMessageMenuId = collectionActions.setActiveCollectionMessageMenuId;
  const setConfirmCollectionDeleteId = collectionActions.setConfirmCollectionDeleteId;
  const setSourceImportError = collectionActions.setSourceImportError;

  const setViewMode = useUIStore((s) => s.actions).setViewMode;
  const setShowMobileRecorder = useUIStore((s) => s.actions).setShowMobileRecorder;
  const setMobileCollectionSheet = useUIStore((s) => s.actions).setMobileCollectionSheet;
  const showMobileRecorder = useUIStore((s) => s.showMobileRecorder);
  const isRecording = useSessionStore((s) => s.isRecording);
  const setDataSource = useSessionStore((s) => s.actions).setDataSource;
  const setRecorderAutoStartSignal = useCaptureEditorStore((s) => s.actions).setRecorderAutoStartSignal;

  // ── Derived: collectionFeedItems ───────────────────────────────────
  const collectionFeedItems = useMemo(
    () =>
      [...sourceItems].sort(
        (a, b) => new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime()
      ),
    [sourceItems]
  );

  // ── Derived: selectedCollectionContextItems ────────────────────────
  const selectedCollectionContextItems = useMemo(
    () => collectionFeedItems.filter((item) => selectedCollectionContextIds.includes(item.id)),
    [collectionFeedItems, selectedCollectionContextIds]
  );

  // ── Derived: quotedCollectionContextItems ──────────────────────────
  const quotedCollectionContextItems = useMemo(
    () => collectionFeedItems.filter((item) => quotedCollectionContextIds.includes(item.id)),
    [collectionFeedItems, quotedCollectionContextIds]
  );

  // ── Derived: selectedCollectionListIds ─────────────────────────────
  const selectedCollectionListIds = useMemo(
    () =>
      selectedCollectionContextIds.map((id) =>
        id.startsWith('workspace-') ? id : `local-active-${id}`
      ),
    [selectedCollectionContextIds]
  );

  // ── Composer reach detection ───────────────────────────────────────
  const composerReach = useMemo<ContextReachDetection>(
    () => detectReachFromText(collectionComposerText),
    [collectionComposerText]
  );

  const composerDetectedUrl = composerReach.url || null;
  const composerLinkPreview = useMemo(
    () => (composerDetectedUrl ? parseVideoLink(composerDetectedUrl) : null),
    [composerDetectedUrl]
  );

  const composerCanAutoImportLink = (composerReach.channel === 'video-link' || composerReach.channel === 'article-link') && composerReach.shouldAutoIngest;

  // ── Quoted context computed values ─────────────────────────────────
  const quotedCollectionPrimaryItem = useMemo(() => {
    if (quotedCollectionContextItems.length === 0) return null;
    const primaryId = resolveCollectionContextPrimaryId(quotedCollectionContextItems, quotedCollectionPrimaryId);
    return quotedCollectionContextItems.find((item) => item.id === primaryId) || quotedCollectionContextItems[0];
  }, [quotedCollectionContextItems, quotedCollectionPrimaryId]);

  const quotedCollectionSummaryText = useMemo(() => {
    if (quotedCollectionContextItems.length === 0) return '';
    if (quotedCollectionContextItems.length === 1 && quotedCollectionPrimaryItem) {
      return getCollectionContextDisplayTitle(quotedCollectionPrimaryItem, 42);
    }
    return quotedCollectionContextItems
      .slice(0, 2)
      .map((item) => getCollectionContextDisplayTitle(item, 20))
      .join(' · ');
  }, [quotedCollectionContextItems, quotedCollectionPrimaryItem]);

  const collectionComposerPlaceholder = useMemo(() => {
    if (quotedCollectionContextItems.length > 1) {
      return COPY.collection.composerPlaceholderQuotedMulti;
    }
    if (quotedCollectionPrimaryItem) {
      return COPY.collection.composerPlaceholderQuotedSingle(
        getCollectionContextTypeLabel(quotedCollectionPrimaryItem.type),
      );
    }
    return COPY.collection.composerPlaceholder;
  }, [quotedCollectionContextItems.length, quotedCollectionPrimaryItem]);

  // ── Active message menu item ───────────────────────────────────────
  const activeCollectionMessageMenuItem = useMemo(
    () => collectionFeedItems.find((item) => item.id === activeCollectionMessageMenuId) || null,
    [activeCollectionMessageMenuId, collectionFeedItems]
  );

  // ── Scroll ─────────────────────────────────────────────────────────
  const scrollCollectionToBottom = useCallback((smooth = true) => {
    const el = collectionScrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, [collectionScrollRef]);

  // Scroll detection effect — also re-registers when viewMode changes
  // because the scroll container is conditionally rendered (viewMode === 'record')
  useEffect(() => {
    if (viewMode !== 'record') return;
    const el = collectionScrollRef.current;
    if (!el) return;
    const handleScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      const nearBottom = distanceFromBottom < 120;
      (collectionScrollNearBottomRef as React.MutableRefObject<boolean>).current = nearBottom;
      setShowScrollToLatest(!nearBottom && collectionFeedItems.length > 0);
    };
    // Evaluate immediately on mount — covers the case where auto-scroll-to-bottom
    // failed and user sees the feed from the top (button should appear right away)
    handleScroll();
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [viewMode, collectionFeedItems.length, collectionScrollRef, collectionScrollNearBottomRef]);

  // Initial mount: scroll to bottom when items first load (like WeChat chat)
  // Also re-scroll when navigating back to 'record' viewMode
  const hasInitialScrolledRef = useRef(false);

  // Reset scroll flag when leaving record viewMode
  // so returning to record re-triggers scroll-to-bottom
  useEffect(() => {
    if (viewMode !== 'record') {
      hasInitialScrolledRef.current = false;
    }
  }, [viewMode]);

  useEffect(() => {
    if (viewMode !== 'record') return;
    if (hasInitialScrolledRef.current) return;
    if (collectionFeedItems.length === 0) return;

    // Strategy: Use MutationObserver to detect when DOM children are actually
    // rendered (not just when React state updates). This covers the race where
    // collectionFeedItems arrives before React commits the DOM tree.

    // Helper: wait for scrollRef to become available (may not be mounted yet
    // when viewMode just changed to 'record' — React commits DOM after state batch)
    let cancelled = false;
    let settled = false;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let observer: MutationObserver | null = null;
    let hardTimeout: ReturnType<typeof setTimeout> | null = null;

    const setup = () => {
      if (cancelled) return;
      const el = collectionScrollRef.current;
      if (!el) {
        // DOM not mounted yet — retry next frame
        requestAnimationFrame(setup);
        return;
      }

      hasInitialScrolledRef.current = true;

      const doScroll = () => {
        el.scrollTo({ top: el.scrollHeight, behavior: 'auto' });
      };

      // Immediately try once (covers fast renders)
      requestAnimationFrame(doScroll);

      // MutationObserver: re-scroll whenever child list changes (items rendering in)
      observer = new MutationObserver(() => {
        doScroll();
        // Reset settle timer — wait for DOM to "settle" (no more mutations for 300ms)
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = setTimeout(() => {
          settled = true;
          observer?.disconnect();
          // Final scroll after settling
          doScroll();
        }, 300);
      });

      observer.observe(el, { childList: true, subtree: true });

      // Hard timeout: give up after 3s regardless
      hardTimeout = setTimeout(() => {
        if (!settled) {
          observer?.disconnect();
          doScroll();
        }
      }, 3000);
    };

    setup();

    return () => {
      cancelled = true;
      observer?.disconnect();
      if (settleTimer) clearTimeout(settleTimer);
      if (hardTimeout) clearTimeout(hardTimeout);
    };
  }, [viewMode, collectionFeedItems.length, collectionScrollRef]);

  // Auto-scroll to bottom on new items
  useEffect(() => {
    if (collectionFeedItems.length > (prevCollectionCountRef as React.MutableRefObject<number>).current && (collectionScrollNearBottomRef as React.RefObject<boolean>).current) {
      requestAnimationFrame(() => scrollCollectionToBottom(true));
    }
    (prevCollectionCountRef as React.MutableRefObject<number>).current = collectionFeedItems.length;
  }, [collectionFeedItems.length, scrollCollectionToBottom, collectionScrollNearBottomRef, prevCollectionCountRef]);

  // ── Selection/quoted state sync effects ────────────────────────────
  // Selection cleanup when items are removed
  useEffect(() => {
    if (selectedCollectionContextIds.length === 0) {
      if (selectedCollectionPrimaryId) {
        setSelectedCollectionPrimaryId(null);
      }
      if (isCollectionContextSelectionMode && collectionFeedItems.length === 0) {
        setIsCollectionContextSelectionMode(false);
      }
      return;
    }

    const validIds = new Set(collectionFeedItems.map((item) => item.id));
    const nextIds = selectedCollectionContextIds.filter((id) => validIds.has(id));
    if (nextIds.length !== selectedCollectionContextIds.length) {
      setSelectedCollectionContextIds(nextIds);
      return;
    }

    const nextPrimaryId = resolveCollectionContextPrimaryId(selectedCollectionContextItems, selectedCollectionPrimaryId);
    if (nextPrimaryId !== selectedCollectionPrimaryId) {
      setSelectedCollectionPrimaryId(nextPrimaryId);
    }
  }, [
    collectionFeedItems,
    isCollectionContextSelectionMode,
    selectedCollectionContextIds,
    selectedCollectionContextItems,
    selectedCollectionPrimaryId,
  ]);

  // Reset confirm delete on selection change
  useEffect(() => {
    setConfirmSelectedCollectionDelete(false);
  }, [isCollectionContextSelectionMode, selectedCollectionContextIds.join('|')]);

  // Quoted context cleanup
  useEffect(() => {
    if (quotedCollectionContextIds.length === 0) {
      if (quotedCollectionPrimaryId) {
        setQuotedCollectionPrimaryId(null);
      }
      return;
    }

    const validIds = new Set(collectionFeedItems.map((item) => item.id));
    const nextIds = quotedCollectionContextIds.filter((id) => validIds.has(id));
    if (nextIds.length !== quotedCollectionContextIds.length) {
      setQuotedCollectionContextIds(nextIds);
      return;
    }

    const nextPrimaryId = resolveCollectionContextPrimaryId(quotedCollectionContextItems, quotedCollectionPrimaryId);
    if (nextPrimaryId !== quotedCollectionPrimaryId) {
      setQuotedCollectionPrimaryId(nextPrimaryId);
    }
  }, [collectionFeedItems, quotedCollectionContextIds, quotedCollectionContextItems, quotedCollectionPrimaryId]);

  // Menu item cleanup
  useEffect(() => {
    if (!activeCollectionMessageMenuId) return;
    if (collectionFeedItems.some((item) => item.id === activeCollectionMessageMenuId)) return;
    setActiveCollectionMessageMenuId(null);
  }, [activeCollectionMessageMenuId, collectionFeedItems]);

  // Menu delete confirm reset
  useEffect(() => {
    if (!confirmCollectionDeleteId) return;
    if (confirmCollectionDeleteId === activeCollectionMessageMenuId) return;
    setConfirmCollectionDeleteId(null);
  }, [activeCollectionMessageMenuId, confirmCollectionDeleteId]);

  // ── Composer interaction callbacks ─────────────────────────────────
  const nudgeComposer = useCallback((draft: string) => {
    setMobileCollectionSheet(null);
    setShowMobileRecorder(false);
    setCollectionComposerText(draft);
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        collectionComposerRef.current?.focus();
        collectionComposerRef.current?.setSelectionRange(draft.length, draft.length);
      });
    }
  }, [collectionComposerRef, setCollectionComposerText, setMobileCollectionSheet, setShowMobileRecorder]);

  const focusCollectionComposer = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.requestAnimationFrame(() => {
      const textarea = collectionComposerRef.current;
      if (!textarea) return;
      textarea.focus();
      const length = textarea.value.length;
      textarea.setSelectionRange(length, length);
      // 可见反馈：触发点在屏幕中部（空态入口卡/菜单），输入卡在底部——
      // 光聚焦太安静，给输入卡一圈 pine 脉冲把视线引过去。
      textarea.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      const bar = textarea.closest('[data-composer-bar]');
      if (bar) {
        // 强制重排，让连续触发也能重播动画
        bar.classList.remove('composer-attention');
        void (bar as HTMLElement).offsetWidth;
        bar.classList.add('composer-attention');
        bar.addEventListener('animationend', () => bar.classList.remove('composer-attention'), { once: true });
      }
    });
  }, [collectionComposerRef]);

  const appendToCollectionComposer = useCallback((incomingText: string) => {
    const normalized = incomingText.replace(/\s+/g, ' ').trim();
    if (!normalized) return;

    setCollectionComposerText((previous: string) => {
      const base = previous.trimEnd();
      if (!base) return normalized;
      const joiner = /[。！？.!?；;，,：:]$/.test(base) ? '' : ' ';
      return `${base}${joiner}${normalized}`;
    });

    focusCollectionComposer();
  }, [focusCollectionComposer, setCollectionComposerText]);

  // ── Voice input (dictation) ────────────────────────────────────────
  const {
    status: composerVoiceStatus,
    isRecording: isComposerVoiceRecording,
    interimText: composerVoiceInterimText,
    stopRecording: stopComposerVoiceInput,
    toggleRecording: toggleComposerVoiceInput,
  } = useVoiceInput({
    onTranscript: appendToCollectionComposer,
    onError: (message) => {
      setSourceImportError(message || '语音听写暂时没接住，请稍后再试。');
    },
  });

  // ── Composer dictation stop on view/recorder change ────────────────
  useEffect(() => {
    const viewMode = useUIStore.getState().viewMode;
    if ((viewMode !== 'record' || showMobileRecorder) && isComposerVoiceRecording) {
      void stopComposerVoiceInput();
    }
  }, [isComposerVoiceRecording, showMobileRecorder, stopComposerVoiceInput]);

  // ── Context selection callbacks ────────────────────────────────────
  const setQuotedCollectionContext = useCallback((items: SourceIngestItem[], primaryId?: string | null) => {
    setMobileCollectionSheet(null);
    setShowMobileRecorder(false);
    setQuotedCollectionContextIds(items.map((item) => item.id));
    setQuotedCollectionPrimaryId(resolveCollectionContextPrimaryId(items, primaryId));
    focusCollectionComposer();
  }, [focusCollectionComposer, setMobileCollectionSheet, setQuotedCollectionContextIds, setQuotedCollectionPrimaryId, setShowMobileRecorder]);

  const clearCollectionContextSelection = useCallback(() => {
    setSelectedCollectionContextIds([]);
    setSelectedCollectionPrimaryId(null);
    setIsCollectionContextSelectionMode(false);
    setConfirmSelectedCollectionDelete(false);
  }, [setConfirmSelectedCollectionDelete, setIsCollectionContextSelectionMode, setSelectedCollectionContextIds, setSelectedCollectionPrimaryId]);

  const clearQuotedCollectionContext = useCallback(() => {
    setQuotedCollectionContextIds([]);
    setQuotedCollectionPrimaryId(null);
  }, [setQuotedCollectionContextIds, setQuotedCollectionPrimaryId]);

  const toggleCollectionContextItem = useCallback((item: SourceIngestItem) => {
    setSelectedCollectionContextIds((prev: string[]) => {
      const exists = prev.includes(item.id);
      const nextIds = exists ? prev.filter((id: string) => id !== item.id) : [...prev, item.id];
      const selectedItems = collectionFeedItems
        .filter((current) => nextIds.includes(current.id))
        .concat(nextIds.includes(item.id) && !collectionFeedItems.some((current) => current.id === item.id) ? [item] : []);
      const nextPrimaryId = resolveCollectionContextPrimaryId(
        selectedItems,
        exists
          ? selectedCollectionPrimaryId === item.id
            ? null
            : selectedCollectionPrimaryId
          : item.id
      );
      setSelectedCollectionPrimaryId(nextPrimaryId);
      if (nextIds.length === 0) {
        setIsCollectionContextSelectionMode(false);
      } else if (!isCollectionContextSelectionMode) {
        setIsCollectionContextSelectionMode(true);
      }
      return nextIds;
    });
  }, [collectionFeedItems, isCollectionContextSelectionMode, selectedCollectionPrimaryId, setIsCollectionContextSelectionMode, setSelectedCollectionContextIds, setSelectedCollectionPrimaryId]);

  const quoteSelectedCollectionContextToComposer = useCallback(() => {
    if (selectedCollectionContextItems.length === 0) return;
    setQuotedCollectionContext(selectedCollectionContextItems, selectedCollectionPrimaryId);
    clearCollectionContextSelection();
  }, [clearCollectionContextSelection, selectedCollectionContextItems, selectedCollectionPrimaryId, setQuotedCollectionContext]);

  const quoteCollectionItemToComposer = useCallback((item: SourceIngestItem) => {
    clearCollectionContextSelection();
    setQuotedCollectionContext([item], item.id);
  }, [clearCollectionContextSelection, setQuotedCollectionContext]);

  // ── Menu callbacks ─────────────────────────────────────────────────
  const openCollectionMessageMenu = useCallback((itemId: string) => {
    setMobileCollectionSheet(null);
    setConfirmCollectionDeleteId(null);
    setActiveCollectionMessageMenuId(itemId);
  }, [setActiveCollectionMessageMenuId, setConfirmCollectionDeleteId, setMobileCollectionSheet]);

  const closeCollectionMessageMenu = useCallback(() => {
    setActiveCollectionMessageMenuId(null);
    setConfirmCollectionDeleteId(null);
  }, [setActiveCollectionMessageMenuId, setConfirmCollectionDeleteId]);

  const cancelCollectionMessageLongPress = useCallback(() => {
    if ((collectionLongPressTimerRef as React.MutableRefObject<number | null>).current) {
      clearTimeout((collectionLongPressTimerRef as React.MutableRefObject<number | null>).current!);
      (collectionLongPressTimerRef as React.MutableRefObject<number | null>).current = null;
    }
  }, [collectionLongPressTimerRef]);

  const beginCollectionMessageLongPress = useCallback((itemId: string) => {
    cancelCollectionMessageLongPress();
    (collectionLongPressTriggeredRef as React.MutableRefObject<boolean>).current = false;
    (collectionLongPressTimerRef as React.MutableRefObject<number | null>).current = window.setTimeout(() => {
      (collectionLongPressTriggeredRef as React.MutableRefObject<boolean>).current = true;
      openCollectionMessageMenu(itemId);
    }, 360);
  }, [cancelCollectionMessageLongPress, collectionLongPressTimerRef, collectionLongPressTriggeredRef, openCollectionMessageMenu]);

  // ── Dictation toggle ───────────────────────────────────────────────
  const toggleComposerDictation = useCallback(async () => {
    if (showMobileRecorder || isRecording) {
      setSourceImportError('先结束原声，再开始听写。');
      return;
    }

    setSourceImportError('');
    setMobileCollectionSheet(null);
    collectionComposerRef.current?.blur();
    await toggleComposerVoiceInput();
  }, [collectionComposerRef, isRecording, setMobileCollectionSheet, setSourceImportError, showMobileRecorder, toggleComposerVoiceInput]);

  // ── Open live recorder ─────────────────────────────────────────────
  const openLiveRecorder = useCallback(() => {
    if (isRecording) return;

    if (isComposerVoiceRecording) {
      void stopComposerVoiceInput();
    }

    setSourceImportError('');
    setMobileCollectionSheet(null);
    setRecorderAutoStartSignal(0);
    flushSync(() => {
      setDataSource('live');
      setShowMobileRecorder(true);
    });

    const startRecordingNow = () => {
      if (recorderRef.current) {
        void recorderRef.current.startRecording();
      } else {
        setRecorderAutoStartSignal(Date.now());
      }
    };

    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(startRecordingNow);
    } else {
      startRecordingNow();
    }
  }, [isComposerVoiceRecording, isRecording, recorderRef, setDataSource, setMobileCollectionSheet, setRecorderAutoStartSignal, setShowMobileRecorder, setSourceImportError, stopComposerVoiceInput]);

  // ── Composer submit ────────────────────────────────────────────────
  const handleCollectionComposerSubmit = useCallback(async () => {
    const text = collectionComposerText.trim();
    if (!text) return;

    const inlineUrl = composerDetectedUrl;
    const canAutoImportLink = Boolean(inlineUrl && composerCanAutoImportLink);
    const noteText = canAutoImportLink && inlineUrl
      ? text.replace(inlineUrl, '').replace(/\s+/g, ' ').trim()
      : text;
    const quotedItems = quotedCollectionContextItems;
    const quotedPId = resolveCollectionContextPrimaryId(quotedItems, quotedCollectionPrimaryId);
    const quotedPItem = quotedItems.find((item) => item.id === quotedPId) || quotedItems[0] || null;
    const quotedSourceKeys = quotedItems
      .map((item) => resolveSourceItemSourceKey(item))
      .filter((item): item is string => Boolean(item));

    if (noteText) {
      const segments = segmentsRef.current || [];
      const nextStartMs =
        segments.length > 0
          ? (segments[segments.length - 1]?.endMs || 0) + 1200
          : 0;

      const draftId = `quick-note-${Date.now()}`;
      const draftTitle = `随手记录 ${new Date().toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
      })}`;
      const noteProvenance = buildSourceProvenance({
        ingressChannel: 'composer',
        normalizedText: noteText,
        contentState: 'complete',
        completeness: 1,
      });
      const appended = appendSupportSource({
        id: draftId,
        sourceKey: `manual:${draftId}`,
        type: 'text',
        title: draftTitle,
        segments: [
          {
            id: `${draftId}-seg-1`,
            text: noteText,
            startMs: nextStartMs,
            endMs: nextStartMs + 2400,
            confidence: 1,
            isFinal: true,
          },
        ],
        provenance: noteProvenance,
      });

      void persistCaptureToWorkspace({
        sourceType: 'manual-note',
        sourceKey: `manual:${draftId}`,
        role: 'support',
        contentType: inlineUrl && !canAutoImportLink ? 'link' : 'text',
        title: draftTitle,
        previewText: compactText(noteText, 180),
        normalizedText: appended.reference || noteText,
        sourceUrl: inlineUrl && !canAutoImportLink ? inlineUrl : undefined,
        tutorContext: noteText,
        occurredAt: new Date().toISOString(),
        metadata: {
          from: 'collection-composer',
          quotedSourceItemIds: quotedItems.map((item) => item.id),
          quotedSourceKeys,
          quotedPrimaryId: quotedPId,
          quotedPrimaryTitle: quotedPItem?.title || null,
          provenance: noteProvenance,
        },
      });
    }

    setCollectionComposerText('');
    setSourceImportError('');
    clearQuotedCollectionContext();

    if (canAutoImportLink && inlineUrl) {
      void importComposerVideoLink(inlineUrl, collectionComposerText);
      return;
    }
  }, [
    appendSupportSource,
    clearQuotedCollectionContext,
    collectionComposerText,
    composerCanAutoImportLink,
    composerDetectedUrl,
    importComposerVideoLink,
    persistCaptureToWorkspace,
    quotedCollectionContextItems,
    quotedCollectionPrimaryId,
    segmentsRef,
    setCollectionComposerText,
    setSourceImportError,
  ]);

  // ── Composer paste ─────────────────────────────────────────────────
  const handleCollectionComposerPaste = useCallback((event: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(event.clipboardData?.items || []);
    if (items.length === 0) return;

    const pastedFiles = items
      .map((item) => (item.kind === 'file' ? item.getAsFile() : null))
      .filter((file): file is File => Boolean(file));

    if (pastedFiles.length === 0) return;

    event.preventDefault();
    setSourceImportError('');
    void handleImportFiles(pastedFiles, 'all');
  }, [handleImportFiles, setSourceImportError]);

  // ── Pulse action handler ───────────────────────────────────────────
  const handleCollectionPulseAction = useCallback((actionKey: string) => {
    switch (actionKey) {
      case 'continue-voice':
        openLiveRecorder();
        return;
      case 'capture-confusion':
        nudgeComposer(COPY.collection.confusionNudge);
        return;
      case 'add-material':
        handleSourceFileButtonClick('all');
        return;
      default:
        return;
    }
  }, [handleSourceFileButtonClick, nudgeComposer, openLiveRecorder]);

  return {
    // Computed values
    collectionFeedItems,
    selectedCollectionContextItems,
    quotedCollectionContextItems,
    selectedCollectionListIds,
    composerReach,
    composerDetectedUrl,
    composerLinkPreview,
    composerCanAutoImportLink,
    quotedCollectionPrimaryItem,
    quotedCollectionSummaryText,
    collectionComposerPlaceholder,
    activeCollectionMessageMenuItem,
    showScrollToLatest,

    // Scroll
    scrollCollectionToBottom,

    // Composer interaction
    nudgeComposer,
    focusCollectionComposer,
    appendToCollectionComposer,
    toggleComposerDictation,
    handleCollectionComposerSubmit,
    handleCollectionComposerPaste,
    handleCollectionPulseAction,
    openLiveRecorder,

    // Context selection / quoting
    setQuotedCollectionContext,
    clearCollectionContextSelection,
    clearQuotedCollectionContext,
    toggleCollectionContextItem,
    quoteSelectedCollectionContextToComposer,
    quoteCollectionItemToComposer,

    // Menu
    openCollectionMessageMenu,
    closeCollectionMessageMenu,
    cancelCollectionMessageLongPress,
    beginCollectionMessageLongPress,

    // Pass-through voice state
    composerVoiceStatus,
    isComposerVoiceRecording,
    composerVoiceInterimText,
  };
}
