'use client';

import { useCallback, type MutableRefObject } from 'react';
import { useCollectionStore } from '@/stores/collection-store';
import { useEchoStore } from '@/stores/echo-store';
import { useAuth } from '@/lib/hooks/useAuth';
import {
  resolveSourceItemSourceKey,
  compactText,
  buildWorkspaceCaptureSourceItem,
  getSupportReferenceDisplayTitle,
  mergeSupportReferences,
  mergeWorkspaceCaptures,
  readJsonApiResponse,
} from '@/lib/utils/page-utils';
import type {
  SourceIngestItem,
  WorkspaceCaptureMessage,
  WorkspaceCaptureEditorMode,
} from '@/types/page-types';
import { toast } from 'sonner';

// ── External deps that come from caller ──

export interface WorkspaceCaptureActionsDeps {
  /** Currently playing audio message id (for cleanup on remove). */
  playingAudioMessageId: string | null;
  /** Stop any active audio message playback. */
  stopAudioMessagePlayback: () => void;
  /** Deferred capture status map (ref stays in page.tsx, hook just writes to it on 404). */
  pendingCaptureStatusBySourceKeyRef: MutableRefObject<Map<string, 'archive' | 'delete'>>;
}

// ── Return type ──

export interface WorkspaceCaptureActionsReturn {
  removeCollectionItemsFromFlow: (params: {
    itemId?: string | null;
    sourceKey?: string | null;
    workspaceCaptureId?: string | null;
  }) => void;
  archiveLocalCollectionItem: (item: SourceIngestItem) => void;
  restoreLocalCollectionItem: (item: SourceIngestItem) => void;
  deleteLocalCollectionItem: (item: SourceIngestItem) => void;
  removeWorkspaceCaptureFromState: (params: {
    captureId?: string | null;
    sourceKey?: string | null;
    itemId?: string | null;
    retiredEchoIds?: string[];
  }) => void;
  syncWorkspaceCaptureIntoState: (params: {
    capture: WorkspaceCaptureMessage;
    retiredEchoIds?: string[];
    ensureActiveSourceItem?: boolean;
  }) => void;
  updateWorkspaceCaptureStatus: (params: {
    action: 'archive' | 'restore' | 'delete';
    captureId?: string | null;
    sourceKey?: string | null;
    itemId?: string | null;
    silent?: boolean;
  }) => Promise<boolean>;
  openWorkspaceCaptureEditor: (capture: WorkspaceCaptureMessage, mode: WorkspaceCaptureEditorMode) => void;
  closeWorkspaceCaptureEditor: () => void;
  saveWorkspaceCaptureEdit: () => Promise<void>;
}

/**
 * Encapsulates all workspace capture CRUD actions that were previously
 * inline in page.tsx (~400 lines).
 *
 * Reads/writes Zustand stores directly; external deps injected via `deps`.
 */
export function useWorkspaceCaptureActions(
  deps: WorkspaceCaptureActionsDeps
): WorkspaceCaptureActionsReturn {
  const { playingAudioMessageId, stopAudioMessagePlayback, pendingCaptureStatusBySourceKeyRef } = deps;

  // ── Auth ──
  const { isAuthenticated, accessToken, user } = useAuth();

  // ── Collection store actions ──
  const {
    setSourceItems,
    setSupportReferences,
    setSelectedCollectionContextIds,
    setQuotedCollectionContextIds,
    setExpandedAudioTranscriptId,
    setActiveCollectionMessageMenuId,
    setConfirmCollectionDeleteId,
    setArchivedLocalCollectionItems,
    setWorkspaceCaptureEditor,
    setWorkspaceCaptureEditorTitle,
    setWorkspaceCaptureEditorBody,
    setIsSavingWorkspaceCaptureEdit,
  } = useCollectionStore((s) => s.actions);

  // ── Echo store actions ──
  const { setWorkspaceCaptures, setWorkspaceEchoes } = useEchoStore((s) => s.actions);

  // ── Collection store state (read-only for save condition) ──
  const isSavingWorkspaceCaptureEdit = useCollectionStore((s) => s.isSavingWorkspaceCaptureEdit);
  const workspaceCaptureEditor = useCollectionStore((s) => s.workspaceCaptureEditor);
  const workspaceCaptureEditorTitle = useCollectionStore((s) => s.workspaceCaptureEditorTitle);
  const workspaceCaptureEditorBody = useCollectionStore((s) => s.workspaceCaptureEditorBody);

  // ────────────────────────────────────────────────────────────────────────────
  // removeCollectionItemsFromFlow
  // ────────────────────────────────────────────────────────────────────────────

  const removeCollectionItemsFromFlow = useCallback((params: {
    itemId?: string | null;
    sourceKey?: string | null;
    workspaceCaptureId?: string | null;
  }) => {
    const sourceItemsSnapshot = useCollectionStore.getState().sourceItems;
    const matchingIds = sourceItemsSnapshot
      .filter((item) => {
        if (params.itemId && item.id === params.itemId) return true;
        if (params.sourceKey && resolveSourceItemSourceKey(item) === params.sourceKey) return true;
        if (params.workspaceCaptureId && item.id === `workspace-${params.workspaceCaptureId}`) return true;
        return false;
      })
      .map((item) => item.id);

    const idsToRemove = new Set<string>(matchingIds);
    if (params.itemId) idsToRemove.add(params.itemId);
    if (params.workspaceCaptureId) idsToRemove.add(`workspace-${params.workspaceCaptureId}`);

    if (idsToRemove.size === 0 && !params.sourceKey) {
      return;
    }

    setSourceItems((prev) =>
      prev.filter((item) => {
        if (idsToRemove.has(item.id)) return false;
        if (params.sourceKey && resolveSourceItemSourceKey(item) === params.sourceKey) return false;
        return true;
      })
    );
    setSupportReferences((prev) => prev.filter((item) => !idsToRemove.has(item.id)));
    setSelectedCollectionContextIds((prev) => prev.filter((itemId) => !idsToRemove.has(itemId)));
    setQuotedCollectionContextIds((prev) => prev.filter((itemId) => !idsToRemove.has(itemId)));
    setExpandedAudioTranscriptId((prev) => (prev && idsToRemove.has(prev) ? null : prev));
    setActiveCollectionMessageMenuId((prev) => (prev && idsToRemove.has(prev) ? null : prev));
    setConfirmCollectionDeleteId((prev) => (prev && idsToRemove.has(prev) ? null : prev));
    if (playingAudioMessageId && idsToRemove.has(playingAudioMessageId)) {
      stopAudioMessagePlayback();
    }
  }, [
    playingAudioMessageId,
    stopAudioMessagePlayback,
    setSourceItems,
    setSupportReferences,
    setSelectedCollectionContextIds,
    setQuotedCollectionContextIds,
    setExpandedAudioTranscriptId,
    setActiveCollectionMessageMenuId,
    setConfirmCollectionDeleteId,
  ]);

  // ────────────────────────────────────────────────────────────────────────────
  // archiveLocalCollectionItem
  // ────────────────────────────────────────────────────────────────────────────

  const archiveLocalCollectionItem = useCallback((item: SourceIngestItem) => {
    setArchivedLocalCollectionItems((prev) => {
      const sourceKey = resolveSourceItemSourceKey(item);
      const next = prev.filter((entry) => {
        if (entry.id === item.id) return false;
        if (sourceKey && resolveSourceItemSourceKey(entry) === sourceKey) return false;
        return true;
      });
      return [...next, item];
    });

    removeCollectionItemsFromFlow({
      itemId: item.id,
      sourceKey: resolveSourceItemSourceKey(item),
    });
  }, [removeCollectionItemsFromFlow, setArchivedLocalCollectionItems]);

  // ────────────────────────────────────────────────────────────────────────────
  // restoreLocalCollectionItem
  // ────────────────────────────────────────────────────────────────────────────

  const restoreLocalCollectionItem = useCallback((item: SourceIngestItem) => {
    setArchivedLocalCollectionItems((prev) => prev.filter((entry) => entry.id !== item.id));
    setSourceItems((prev) => {
      const sourceKey = resolveSourceItemSourceKey(item);
      if (prev.some((entry) => entry.id === item.id || (sourceKey && resolveSourceItemSourceKey(entry) === sourceKey))) {
        return prev;
      }
      return [...prev, item];
    });

    const snippet = compactText((item.fullText || item.preview || '').trim(), 2800);
    if (item.role === 'support' && snippet) {
      setSupportReferences((prev) => mergeSupportReferences(prev, [{
        id: item.id,
        title: getSupportReferenceDisplayTitle(item),
        snippet,
      }]));
    }
  }, [setArchivedLocalCollectionItems, setSourceItems, setSupportReferences]);

  // ────────────────────────────────────────────────────────────────────────────
  // deleteLocalCollectionItem
  // ────────────────────────────────────────────────────────────────────────────

  const deleteLocalCollectionItem = useCallback((item: SourceIngestItem) => {
    setArchivedLocalCollectionItems((prev) => prev.filter((entry) => entry.id !== item.id));
    removeCollectionItemsFromFlow({
      itemId: item.id,
      sourceKey: resolveSourceItemSourceKey(item),
    });
  }, [removeCollectionItemsFromFlow, setArchivedLocalCollectionItems]);

  // ────────────────────────────────────────────────────────────────────────────
  // removeWorkspaceCaptureFromState
  // ────────────────────────────────────────────────────────────────────────────

  const removeWorkspaceCaptureFromState = useCallback((params: {
    captureId?: string | null;
    sourceKey?: string | null;
    itemId?: string | null;
    retiredEchoIds?: string[];
  }) => {
    setWorkspaceCaptures((prev) =>
      prev.filter((item) => {
        if (params.captureId && item.id === params.captureId) return false;
        if (params.sourceKey && item.sourceKey === params.sourceKey) return false;
        return true;
      })
    );
    if (params.retiredEchoIds && params.retiredEchoIds.length > 0) {
      const retiredEchoIdSet = new Set(params.retiredEchoIds);
      setWorkspaceEchoes((prev) => prev.filter((item) => !retiredEchoIdSet.has(item.id)));
    }
    removeCollectionItemsFromFlow({
      itemId: params.itemId,
      sourceKey: params.sourceKey,
      workspaceCaptureId: params.captureId,
    });
  }, [removeCollectionItemsFromFlow, setWorkspaceCaptures, setWorkspaceEchoes]);

  // ────────────────────────────────────────────────────────────────────────────
  // syncWorkspaceCaptureIntoState
  // ────────────────────────────────────────────────────────────────────────────

  const syncWorkspaceCaptureIntoState = useCallback((params: {
    capture: WorkspaceCaptureMessage;
    retiredEchoIds?: string[];
    ensureActiveSourceItem?: boolean;
  }) => {
    const capture = params.capture;
    setWorkspaceCaptures((prev) => mergeWorkspaceCaptures(prev, [capture]));

    if (params.retiredEchoIds && params.retiredEchoIds.length > 0) {
      const retiredEchoIdSet = new Set(params.retiredEchoIds);
      setWorkspaceEchoes((prev) => prev.filter((item) => !retiredEchoIdSet.has(item.id)));
    }

    if (capture.status === 'deleted') {
      removeWorkspaceCaptureFromState({
        captureId: capture.id,
        sourceKey: capture.sourceKey,
        itemId: `workspace-${capture.id}`,
        retiredEchoIds: params.retiredEchoIds,
      });
      return;
    }

    if (capture.status === 'archived') {
      removeCollectionItemsFromFlow({
        itemId: `workspace-${capture.id}`,
        sourceKey: capture.sourceKey,
        workspaceCaptureId: capture.id,
      });
      return;
    }

    const sourceItem = buildWorkspaceCaptureSourceItem(capture);
    setSourceItems((prev) => {
      const index = prev.findIndex(
        (item) => item.id === sourceItem.id || resolveSourceItemSourceKey(item) === capture.sourceKey
      );

      if (index >= 0) {
        const current = prev[index];
        const next = [...prev];
        next[index] = {
          ...current,
          ...sourceItem,
          id: current.id,
        };
        return next;
      }

      if (!params.ensureActiveSourceItem) {
        return prev;
      }

      return [...prev, sourceItem];
    });

    const snippet = compactText((capture.tutorContext || capture.normalizedText || '').trim(), 2800);
    setSupportReferences((prev) => {
      const nextId = sourceItem.id;
      const next = prev.filter((item) => item.id !== nextId);
      if (!snippet) {
        return next.length === prev.length ? prev : next;
      }
      return mergeSupportReferences(next, [
        {
          id: nextId,
          title: sourceItem.title,
          snippet,
        },
      ]);
    });
  }, [
    removeCollectionItemsFromFlow,
    removeWorkspaceCaptureFromState,
    setSourceItems,
    setSupportReferences,
    setWorkspaceCaptures,
    setWorkspaceEchoes,
  ]);

  // ────────────────────────────────────────────────────────────────────────────
  // updateWorkspaceCaptureStatus
  // ────────────────────────────────────────────────────────────────────────────

  const updateWorkspaceCaptureStatus = useCallback(async (params: {
    action: 'archive' | 'restore' | 'delete';
    captureId?: string | null;
    sourceKey?: string | null;
    itemId?: string | null;
    silent?: boolean;
  }) => {
    const captureId = params.captureId?.trim() || null;
    const sourceKey = params.sourceKey?.trim() || null;

    if (!captureId && !sourceKey) {
      removeCollectionItemsFromFlow({
        itemId: params.itemId,
      });
      return true;
    }

    if (!isAuthenticated || !accessToken || !user?.id) {
      if (params.action === 'delete') {
        removeWorkspaceCaptureFromState({
          captureId,
          sourceKey,
          itemId: params.itemId,
        });
      } else {
        removeCollectionItemsFromFlow({
          itemId: params.itemId,
          sourceKey,
          workspaceCaptureId: captureId,
        });
      }
      return true;
    }

    try {
      const response = await fetch('/api/workspace/captures', {
        method: params.action === 'delete' ? 'DELETE' : 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(
          params.action === 'delete'
            ? { captureId, sourceKey }
            : { captureId, sourceKey, action: params.action }
        ),
      });

      const payload = await readJsonApiResponse<{
        success: boolean;
        capture?: WorkspaceCaptureMessage;
        retiredEchoIds?: string[];
        error?: string;
      }>(
        response,
        params.action === 'delete'
          ? '彻底删除收集失败'
          : params.action === 'restore'
            ? '恢复收集失败'
            : '收起这条收集失败'
      );

      if (response.status === 404 && sourceKey && params.action !== 'restore') {
        // Capture not yet persisted — schedule deferred status update
        pendingCaptureStatusBySourceKeyRef.current.set(sourceKey, params.action);
        removeWorkspaceCaptureFromState({
          captureId,
          sourceKey,
          itemId: params.itemId,
        });
        if (!params.silent) {
          toast.success(params.action === 'delete' ? '这条收集会在写入完成后彻底删除' : '这条收集会在写入完成后先收起');
        }
        return true;
      }

      if (!response.ok || !payload.success) {
        throw new Error(
          payload.error ||
            (params.action === 'delete'
              ? '彻底删除收集失败'
              : params.action === 'restore'
                ? '恢复收集失败'
                : '收起这条收集失败')
        );
      }

      if (payload.capture) {
        if (params.action === 'delete') {
          removeWorkspaceCaptureFromState({
            captureId: payload.capture.id || captureId,
            sourceKey: payload.capture.sourceKey || sourceKey,
            itemId: params.itemId,
            retiredEchoIds: Array.isArray(payload.retiredEchoIds) ? payload.retiredEchoIds : [],
          });
        } else {
          syncWorkspaceCaptureIntoState({
            capture: payload.capture,
            retiredEchoIds: Array.isArray(payload.retiredEchoIds) ? payload.retiredEchoIds : [],
            ensureActiveSourceItem: params.action === 'restore',
          });
        }
      }

      if (!params.silent) {
        toast.success(
          params.action === 'delete'
            ? '这条收集已彻底删除'
            : params.action === 'restore'
              ? '这条收集已放回正在看'
              : '这条收集已先收起'
        );
      }
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!params.silent) {
        toast.error(message);
      }
      return false;
    }
  }, [
    accessToken,
    isAuthenticated,
    removeCollectionItemsFromFlow,
    removeWorkspaceCaptureFromState,
    syncWorkspaceCaptureIntoState,
    user?.id,
  ]);

  // ────────────────────────────────────────────────────────────────────────────
  // openWorkspaceCaptureEditor
  // ────────────────────────────────────────────────────────────────────────────

  const openWorkspaceCaptureEditor = useCallback((capture: WorkspaceCaptureMessage, mode: WorkspaceCaptureEditorMode) => {
    const normalizedText = (capture.normalizedText || capture.tutorContext || '').trim();
    const previewText = (capture.previewText || '').trim();
    const draftBody =
      mode === 'text'
        ? normalizedText || previewText || capture.title
        : mode === 'transcript'
          ? normalizedText
          : previewText && previewText !== capture.title
            ? previewText
            : '';

    setWorkspaceCaptureEditor({
      capture,
      mode,
    });
    setWorkspaceCaptureEditorTitle(capture.title || '');
    setWorkspaceCaptureEditorBody(draftBody);
    setActiveCollectionMessageMenuId(null);
    setConfirmCollectionDeleteId(null);
  }, [setWorkspaceCaptureEditor, setWorkspaceCaptureEditorTitle, setWorkspaceCaptureEditorBody, setActiveCollectionMessageMenuId, setConfirmCollectionDeleteId]);

  // ────────────────────────────────────────────────────────────────────────────
  // closeWorkspaceCaptureEditor
  // ────────────────────────────────────────────────────────────────────────────

  const closeWorkspaceCaptureEditor = useCallback(() => {
    if (isSavingWorkspaceCaptureEdit) return;
    setWorkspaceCaptureEditor(null);
    setWorkspaceCaptureEditorTitle('');
    setWorkspaceCaptureEditorBody('');
  }, [isSavingWorkspaceCaptureEdit, setWorkspaceCaptureEditor, setWorkspaceCaptureEditorTitle, setWorkspaceCaptureEditorBody]);

  // ────────────────────────────────────────────────────────────────────────────
  // saveWorkspaceCaptureEdit
  // ────────────────────────────────────────────────────────────────────────────

  const saveWorkspaceCaptureEdit = useCallback(async () => {
    if (!workspaceCaptureEditor || !isAuthenticated || !accessToken) {
      return;
    }

    const capture = workspaceCaptureEditor.capture;
    const trimmedTitle = workspaceCaptureEditorTitle.replace(/\s+/g, ' ').trim();
    const trimmedBody = workspaceCaptureEditorBody.replace(/\s+/g, ' ').trim();

    let apiPayload: {
      captureId: string;
      sourceKey: string;
      action: 'update';
      title?: string | null;
      previewText?: string | null;
      normalizedText?: string | null;
      tutorContext?: string | null;
    } | null = null;

    if (workspaceCaptureEditor.mode === 'text') {
      if (!trimmedBody) {
        toast.error('文字内容不能为空');
        return;
      }

      apiPayload = {
        captureId: capture.id,
        sourceKey: capture.sourceKey,
        action: 'update',
        title: compactText(trimmedBody, 80) || capture.title,
        previewText: trimmedBody,
        normalizedText: trimmedBody,
        tutorContext: trimmedBody,
      };
    } else if (workspaceCaptureEditor.mode === 'transcript') {
      if (!trimmedBody) {
        toast.error('转写文字不能为空');
        return;
      }

      apiPayload = {
        captureId: capture.id,
        sourceKey: capture.sourceKey,
        action: 'update',
        previewText: trimmedBody,
        normalizedText: trimmedBody,
        tutorContext: trimmedBody,
      };
    } else {
      if (!trimmedTitle) {
        toast.error('标题不能为空');
        return;
      }

      apiPayload = {
        captureId: capture.id,
        sourceKey: capture.sourceKey,
        action: 'update',
        title: trimmedTitle,
        previewText: trimmedBody || null,
      };
    }

    setIsSavingWorkspaceCaptureEdit(true);
    try {
      const response = await fetch('/api/workspace/captures', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(apiPayload),
      });

      const result = await readJsonApiResponse<{
        success: boolean;
        capture?: WorkspaceCaptureMessage;
        error?: string;
      }>(response, '更新收集失败');

      if (!response.ok || !result.success || !result.capture) {
        throw new Error(result.error || '更新收集失败');
      }

      syncWorkspaceCaptureIntoState({
        capture: result.capture,
      });
      toast.success(
        workspaceCaptureEditor.mode === 'transcript'
          ? '转写文字已更新'
          : workspaceCaptureEditor.mode === 'text'
            ? '文字已更新'
            : '标题和备注已更新'
      );
      setWorkspaceCaptureEditor(null);
      setWorkspaceCaptureEditorTitle('');
      setWorkspaceCaptureEditorBody('');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message);
    } finally {
      setIsSavingWorkspaceCaptureEdit(false);
    }
  }, [
    accessToken,
    isAuthenticated,
    syncWorkspaceCaptureIntoState,
    workspaceCaptureEditor,
    workspaceCaptureEditorBody,
    workspaceCaptureEditorTitle,
    setIsSavingWorkspaceCaptureEdit,
    setWorkspaceCaptureEditor,
    setWorkspaceCaptureEditorTitle,
    setWorkspaceCaptureEditorBody,
  ]);

  return {
    removeCollectionItemsFromFlow,
    archiveLocalCollectionItem,
    restoreLocalCollectionItem,
    deleteLocalCollectionItem,
    removeWorkspaceCaptureFromState,
    syncWorkspaceCaptureIntoState,
    updateWorkspaceCaptureStatus,
    openWorkspaceCaptureEditor,
    closeWorkspaceCaptureEditor,
    saveWorkspaceCaptureEdit,
  };
}
