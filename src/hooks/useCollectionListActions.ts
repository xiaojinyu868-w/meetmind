/**
 * useCollectionListActions
 *
 * 收集列表操作适配层 — 从 page.tsx 提取（Phase 5）
 *
 * 将 WorkspaceCaptureListItem（列表展示层类型）桥接到 SourceIngestItem（业务逻辑层类型），
 * 提供 9 个操作函数供 MobileCollectionSheet / CollectionMessageActionSheet 等消费。
 *
 * 遵循 (deps, refs) 模式：
 *   deps — 响应式依赖（状态 + 回调）
 *   refs — Mutable refs（不触发 re-render）
 */

import { useCallback } from 'react';
import { useCollectionStore } from '@/stores/collection-store';
import { useEchoStore } from '@/stores/echo-store';
import { useUIStore } from '@/stores/ui-store';
import {
  compactText,
  compactMultilineText,
  buildWorkspaceCaptureSourceItem,
  inferWorkspaceCaptureSourceType,
  resolveSourceItemSourceKey,
  getSupportReferenceDisplayTitle,
  mergeSupportReferences,
} from '@/lib/utils/page-utils';
import type { SourceIngestItem, SourceIngestRole, WorkspaceCaptureMessage, WorkspaceCaptureEditorMode } from '@/types/page-types';
import type { WorkspaceCaptureListItem } from '@/components/WorkspaceCaptureList';

// ── Deps interface ──

interface UseCollectionListActionsDeps {
  /** 从收集流打开复习 */
  openReviewFromCollection: (item?: SourceIngestItem | null) => Promise<void>;
  /** 引用收集项到 composer */
  quoteCollectionItemToComposer: (item: SourceIngestItem) => void;
  /** 切换收集上下文项选中 */
  toggleCollectionContextItem: (item: SourceIngestItem) => void;
  /** 归档本地收集项 */
  archiveLocalCollectionItem: (item: SourceIngestItem) => void;
  /** 恢复本地收集项 */
  restoreLocalCollectionItem: (item: SourceIngestItem) => void;
  /** 删除本地收集项 */
  deleteLocalCollectionItem: (item: SourceIngestItem) => void;
  /** 更新工作区 capture 状态（归档/删除/恢复） */
  updateWorkspaceCaptureStatus: (params: {
    action: 'archive' | 'delete' | 'restore';
    captureId?: string | null;
    sourceKey?: string | null;
    itemId?: string | null;
    silent?: boolean;
  }) => Promise<boolean>;
  /** 打开 capture 编辑器 */
  openWorkspaceCaptureEditor: (capture: WorkspaceCaptureMessage, mode: WorkspaceCaptureEditorMode) => void;
  /** AI 家教：从收集项打开 */
  openTutorFromCollectionItem: (item: SourceIngestItem) => void;
}

// ── Refs interface ──

interface UseCollectionListActionsRefs {
  pendingCaptureStatusBySourceKeyRef: React.MutableRefObject<Map<string, 'archive' | 'delete'>>;
}

// ── Hook ──

export function useCollectionListActions(
  deps: UseCollectionListActionsDeps,
  refs: UseCollectionListActionsRefs,
) {
  const {
    openReviewFromCollection,
    quoteCollectionItemToComposer,
    toggleCollectionContextItem,
    archiveLocalCollectionItem,
    restoreLocalCollectionItem,
    deleteLocalCollectionItem,
    updateWorkspaceCaptureStatus,
    openWorkspaceCaptureEditor,
    openTutorFromCollectionItem,
  } = deps;

  const { pendingCaptureStatusBySourceKeyRef } = refs;

  // ── ensureWorkspaceCaptureSourceItem ──
  // 确保 workspace capture 在 sourceItems + supportReferences 中有对应条目
  const ensureWorkspaceCaptureSourceItem = useCallback((capture: WorkspaceCaptureMessage): SourceIngestItem => {
    const sourceItem = buildWorkspaceCaptureSourceItem(capture);

    useCollectionStore.getState().actions.setSourceItems((prev) => {
      if (prev.some((item) => item.id === sourceItem.id)) {
        return prev;
      }

      if (sourceItem.sourceKey && prev.some((item) => resolveSourceItemSourceKey(item) === sourceItem.sourceKey)) {
        return prev;
      }

      return [...prev, sourceItem];
    });

    const snippet = compactText((capture.tutorContext || capture.normalizedText || '').trim(), 2800);
    if (snippet) {
      useCollectionStore.getState().actions.setSupportReferences((prev) =>
        mergeSupportReferences(prev, [
          {
            id: sourceItem.id,
            title: getSupportReferenceDisplayTitle(sourceItem),
            snippet,
          },
        ])
      );
    }

    return sourceItem;
  }, []);

  // ── resolveCollectionListSourceItem ──
  // WorkspaceCaptureListItem → SourceIngestItem 的完整解析
  const resolveCollectionListSourceItem = useCallback((capture: WorkspaceCaptureListItem): SourceIngestItem => {
    const workspaceCaptures = useEchoStore.getState().workspaceCaptures;
    const sourceItems = useCollectionStore.getState().sourceItems;
    const archivedLocalCollectionItems = useCollectionStore.getState().archivedLocalCollectionItems;

    const workspaceCapture =
      capture.kind === 'workspace'
        ? workspaceCaptures.find((item) => item.id === capture.id || item.sourceKey === capture.sourceKey) || null
        : null;

    if (workspaceCapture) {
      return ensureWorkspaceCaptureSourceItem(workspaceCapture);
    }

    const sourceItemId = capture.sourceItemId || capture.id;
    const sourceKey = capture.sourceKey || null;
    const existing =
      sourceItems.find((item) => item.id === sourceItemId || (sourceKey && resolveSourceItemSourceKey(item) === sourceKey)) ||
      archivedLocalCollectionItems.find((item) => item.id === sourceItemId || (sourceKey && resolveSourceItemSourceKey(item) === sourceKey));

    if (existing) {
      return existing;
    }

    const type = inferWorkspaceCaptureSourceType({
      contentType: capture.contentType,
      sourceType: capture.sourceType,
      metadata: capture.metadata,
    } as WorkspaceCaptureMessage);

    return {
      id: sourceItemId,
      sourceKey: capture.sourceKey,
      type,
      role: capture.role === 'primary' ? 'primary' : 'support',
      title: capture.title,
      preview: capture.previewText,
      previewUrl: type === 'image' ? capture.mediaUrl || undefined : undefined,
      mediaUrl: (type === 'audio' || type === 'video') ? capture.mediaUrl || undefined : undefined,
      attachmentUrl: capture.sourceUrl || undefined,
      fullText: compactMultilineText(capture.normalizedText || capture.tutorContext || capture.previewText || capture.title, 3200),
      segmentCount: capture.normalizedText || capture.tutorContext ? 1 : 0,
      addedAt: capture.occurredAt || capture.createdAt,
      origin: 'user',
      sessionId: typeof capture.metadata?.sessionId === 'string' ? capture.metadata.sessionId : undefined,
      durationMs: typeof capture.metadata?.duration === 'number' ? capture.metadata.duration : undefined,
      reviewable: type === 'audio' || type === 'video',
    };
  }, [ensureWorkspaceCaptureSourceItem]);

  // ── quoteCollectionListItemToComposer ──
  const quoteCollectionListItemToComposer = useCallback((capture: WorkspaceCaptureListItem) => {
    const sourceItem = resolveCollectionListSourceItem(capture);
    quoteCollectionItemToComposer(sourceItem);
    useUIStore.getState().actions.setMobileCollectionSheet(null);
  }, [quoteCollectionItemToComposer, resolveCollectionListSourceItem]);

  // ── openReviewFromCollectionListItem ──
  const openReviewFromCollectionListItem = useCallback(async (capture: WorkspaceCaptureListItem) => {
    const sourceItem = resolveCollectionListSourceItem(capture);
    await openReviewFromCollection(sourceItem);
    useUIStore.getState().actions.setMobileCollectionSheet(null);
  }, [openReviewFromCollection, resolveCollectionListSourceItem]);

  // ── toggleCollectionListItemSelection ──
  const toggleCollectionListItemSelection = useCallback((capture: WorkspaceCaptureListItem) => {
    const sourceItem = resolveCollectionListSourceItem(capture);
    toggleCollectionContextItem(sourceItem);
  }, [resolveCollectionListSourceItem, toggleCollectionContextItem]);

  // ── archiveCollectionListItem ──
  const archiveCollectionListItem = useCallback(async (capture: WorkspaceCaptureListItem) => {
    if (capture.kind === 'workspace') {
      await updateWorkspaceCaptureStatus({
        action: 'archive',
        captureId: capture.id,
        sourceKey: capture.sourceKey,
        itemId: capture.sourceItemId || `workspace-${capture.id}`,
      });
      return;
    }

    if (capture.sourceKey) {
      pendingCaptureStatusBySourceKeyRef.current.set(capture.sourceKey, 'archive');
    }
    archiveLocalCollectionItem(resolveCollectionListSourceItem(capture));
  }, [archiveLocalCollectionItem, resolveCollectionListSourceItem, updateWorkspaceCaptureStatus]);

  // ── restoreCollectionListItem ──
  const restoreCollectionListItem = useCallback(async (capture: WorkspaceCaptureListItem) => {
    if (capture.kind === 'workspace') {
      await updateWorkspaceCaptureStatus({
        action: 'restore',
        captureId: capture.id,
        sourceKey: capture.sourceKey,
        itemId: capture.sourceItemId || `workspace-${capture.id}`,
      });
      return;
    }

    if (capture.sourceKey) {
      pendingCaptureStatusBySourceKeyRef.current.delete(capture.sourceKey);
    }
    restoreLocalCollectionItem(resolveCollectionListSourceItem(capture));
  }, [resolveCollectionListSourceItem, restoreLocalCollectionItem, updateWorkspaceCaptureStatus]);

  // ── deleteCollectionListItem ──
  const deleteCollectionListItem = useCallback(async (capture: WorkspaceCaptureListItem) => {
    if (capture.kind === 'workspace') {
      await updateWorkspaceCaptureStatus({
        action: 'delete',
        captureId: capture.id,
        sourceKey: capture.sourceKey,
        itemId: capture.sourceItemId || `workspace-${capture.id}`,
      });
      return;
    }

    if (capture.sourceKey) {
      pendingCaptureStatusBySourceKeyRef.current.set(capture.sourceKey, 'delete');
    }
    deleteLocalCollectionItem(resolveCollectionListSourceItem(capture));
  }, [deleteLocalCollectionItem, resolveCollectionListSourceItem, updateWorkspaceCaptureStatus]);

  // ── editWorkspaceCaptureFromList ──
  const editWorkspaceCaptureFromList = useCallback((capture: WorkspaceCaptureMessage, mode: WorkspaceCaptureEditorMode) => {
    openWorkspaceCaptureEditor(capture, mode);
  }, [openWorkspaceCaptureEditor]);

  // ── openTutorFromCollectionListItem ──
  const openTutorFromCollectionListItem = useCallback((capture: WorkspaceCaptureListItem) => {
    const sourceItem = resolveCollectionListSourceItem(capture);
    void openTutorFromCollectionItem(sourceItem);
    useUIStore.getState().actions.setMobileCollectionSheet(null);
  }, [openTutorFromCollectionItem, resolveCollectionListSourceItem]);

  return {
    ensureWorkspaceCaptureSourceItem,
    resolveCollectionListSourceItem,
    quoteCollectionListItemToComposer,
    openReviewFromCollectionListItem,
    toggleCollectionListItemSelection,
    archiveCollectionListItem,
    restoreCollectionListItem,
    deleteCollectionListItem,
    editWorkspaceCaptureFromList,
    openTutorFromCollectionListItem,
  };
}
