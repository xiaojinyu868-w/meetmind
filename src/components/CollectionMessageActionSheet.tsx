/**
 * CollectionMessageActionSheet — 收集消息操作底部菜单
 *
 * 用户长按/右键某条消息后弹出的底部操作面板。
 * 包含：去复习 / 编辑 / 打开原件 / 归档 / 删除 操作。
 *
 * 重构：移除 desktopShell，统一设计 token。
 */

'use client';

import { useMemo } from 'react';
import {
  BookOpen,
  CheckSquare2,
  MessageCircle,
  PencilLine,
  Quote,
  Link2,
  History,
  X,
} from 'lucide-react';
import type {
  WorkspaceCaptureMessage,
  WorkspaceCaptureEditorMode,
  SourceIngestItem,
} from '@/types/page-types';
import {
  compactMultilineText,
  resolveSourceItemSourceKey,
} from '@/lib/utils/page-utils';
import { getCollectionContextDisplayTitle, getCollectionContextTypeLabel } from '@/lib/capture/collection-context';
import { COPY } from '@/lib/ui/copy';

// ==================== 类型定义 ====================

export interface CollectionMessageActionSheetProps {
  /** 当前选中的消息 */
  item: SourceIngestItem;
  /** workspace captures 列表（用于查找对应 capture） */
  workspaceCaptures: WorkspaceCaptureMessage[];
  /** 已选中上下文的 ID 列表 */
  selectedCollectionContextIds: string[];
  /** 确认删除的消息 ID */
  confirmCollectionDeleteId: string | null;
  /** 是否可以使用持久化操作 */
  canUsePersistentCaptureActions: boolean;
  /** 遮罩定位类 */
  backdropPositionClass: string;
  /** 是否使用绝对定位容器 */
  collectionChromeContained: boolean;
  /** 是否为移动端（影响弹窗定位模式） */
  isMobile: boolean;

  // --- 回调 ---
  onClose: () => void;
  onOpenReview: (item: SourceIngestItem) => void;
  onAskTutor: (item: SourceIngestItem) => void;
  onQuote: (item: SourceIngestItem) => void;
  onToggleSelect: (item: SourceIngestItem) => void;
  onEditCapture: (capture: WorkspaceCaptureMessage, mode: WorkspaceCaptureEditorMode) => void;
  onOpenOriginal: (item: SourceIngestItem) => void;
  onUpdateCaptureStatus: (params: {
    action: 'archive' | 'delete';
    sourceKey?: string | null;
    itemId?: string | null;
  }) => Promise<boolean>;
  onRemoveFromFlow: (params: {
    itemId?: string | null;
    sourceKey?: string | null;
  }) => void;
  onSetConfirmDelete: (id: string | null) => void;
}

// ==================== 组件实现 ====================

export function CollectionMessageActionSheet({
  item,
  workspaceCaptures,
  selectedCollectionContextIds,
  confirmCollectionDeleteId,
  canUsePersistentCaptureActions,
  backdropPositionClass,
  collectionChromeContained,
  isMobile,
  onClose,
  onOpenReview,
  onAskTutor,
  onQuote,
  onToggleSelect,
  onEditCapture,
  onOpenOriginal,
  onUpdateCaptureStatus,
  onRemoveFromFlow,
  onSetConfirmDelete,
}: CollectionMessageActionSheetProps) {
  // --- 派生数据 ---
  const sourceKey = useMemo(
    () => resolveSourceItemSourceKey(item),
    [item]
  );

  const workspaceCapture = useMemo(() => {
    const directId = item.id.startsWith('workspace-')
      ? item.id.slice('workspace-'.length)
      : null;

    return workspaceCaptures.find((entry) => {
      if (directId && entry.id === directId) return true;
      if (sourceKey && entry.sourceKey === sourceKey) return true;
      return false;
    }) || null;
  }, [item.id, sourceKey, workspaceCaptures]);

  const menuTitle = getCollectionContextDisplayTitle(item, 48);
  const menuPreview = compactMultilineText(
    item.fullText?.trim() || item.preview?.trim() || item.title || '',
    120
  );
  const menuTypeLabel = getCollectionContextTypeLabel(item.type);

  const isReviewable = Boolean(
    item.reviewable &&
    (item.sessionId || item.videoImported || item.mediaUrl) &&
    item.status !== 'failed'
  );
  const hasOriginal = Boolean(item.attachmentUrl || item.mediaUrl || item.previewUrl);
  const isConfirmingDelete = confirmCollectionDeleteId === item.id;

  const effectiveCanPersist = canUsePersistentCaptureActions && Boolean(sourceKey);

  // 桌面端始终用 fixed 定位，避免被 overflow-hidden 容器裁剪
  const effectiveBackdropClass = isMobile ? backdropPositionClass : 'fixed inset-0';
  const effectiveContained = isMobile ? collectionChromeContained : false;

  return (
    <>
      <button
        type="button"
        aria-label="关闭消息操作菜单"
        onClick={onClose}
        className={`${effectiveBackdropClass} z-[60] bg-[#1C1B19]/18`}
      />
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        className={
          isMobile
            ? `${effectiveContained ? 'absolute inset-x-0 bottom-0' : 'fixed inset-x-0 bottom-0'} z-[70] px-3 pb-[max(env(safe-area-inset-bottom),12px)]`
            : 'fixed inset-0 z-[70] flex items-center justify-center p-6'
        }
        onClick={isMobile ? undefined : onClose}
      >
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
        <div
          className={
            isMobile
              ? 'mx-auto w-full max-w-sm rounded-2xl border border-[#E8E2D5] bg-white p-4'
              : 'w-full max-w-md rounded-2xl border border-[#E8E2D5] bg-white p-5'
          }
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-[#D1F4E0]/30 px-2.5 py-1 text-[11px] font-semibold text-[#1C1B19]">
                  {menuTypeLabel}
                </span>
                {selectedCollectionContextIds.includes(item.id) ? (
                  <span className="rounded-full bg-[#E8E2D5] px-2.5 py-1 text-[11px] font-medium text-[#5C5A55]">已加入多选</span>
                ) : null}
              </div>
              <p className="mt-3 text-[15px] font-semibold leading-6 text-[#1C1B19]">{menuTitle}</p>
              {menuPreview && menuPreview !== menuTitle ? (
                <p className="mt-1 text-[13px] leading-6 text-[#5C5A55]">{menuPreview}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[#E8E2D5] bg-white text-[#5C5A55] transition hover:bg-[#FAFAF9] hover:text-[#1C1B19]"
            >
              <X size={15} />
            </button>
          </div>

          <div className="mt-4 divide-y divide-[#E8E2D5]">
            {isReviewable ? (
              <button
                type="button"
                onClick={() => { onClose(); void onOpenReview(item); }}
                className="flex w-full items-center gap-3 px-1 py-3 text-left text-[14px] text-[#1C1B19] transition active:bg-[#FAF7F2]"
              >
                <BookOpen size={18} strokeWidth={1.6} className="text-[#5C5A55]" />
                <span>去复习</span>
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => { onClose(); onQuote(item); }}
              className="flex w-full items-center gap-3 px-1 py-3 text-left text-[14px] text-[#1C1B19] transition active:bg-[#FAF7F2]"
            >
              <Quote size={18} strokeWidth={1.6} className="text-[#5C5A55]" />
              <span>引用</span>
            </button>
            <button
              type="button"
              onClick={() => { onClose(); onAskTutor(item); }}
              className="flex w-full items-center gap-3 px-1 py-3 text-left text-[14px] text-[#1C1B19] transition active:bg-[#FAF7F2]"
            >
              <MessageCircle size={18} strokeWidth={1.6} className="text-[#5C5A55]" />
              <span>{COPY.collection.askClassmate}</span>
            </button>
            <button
              type="button"
              onClick={() => { onClose(); onToggleSelect(item); }}
              className="flex w-full items-center gap-3 px-1 py-3 text-left text-[14px] text-[#1C1B19] transition active:bg-[#FAF7F2]"
            >
              <CheckSquare2 size={18} strokeWidth={1.6} className="text-[#5C5A55]" />
              <span>{selectedCollectionContextIds.includes(item.id) ? '取消选择' : '选择'}</span>
            </button>
            {workspaceCapture ? (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  const cap = workspaceCapture;
                  const mode: WorkspaceCaptureEditorMode = cap.contentType === 'text' ? 'text'
                    : (cap.contentType === 'audio' || cap.contentType === 'video') && (cap.normalizedText || cap.tutorContext || '').trim() ? 'transcript'
                    : 'meta';
                  onEditCapture(cap, mode);
                }}
                className="flex w-full items-center gap-3 px-1 py-3 text-left text-[14px] text-[#1C1B19] transition active:bg-[#FAF7F2]"
              >
                <PencilLine size={18} strokeWidth={1.6} className="text-[#5C5A55]" />
                <span>编辑</span>
              </button>
            ) : null}
            {hasOriginal ? (
              <button
                type="button"
                onClick={() => { onClose(); onOpenOriginal(item); }}
                className="flex w-full items-center gap-3 px-1 py-3 text-left text-[14px] text-[#1C1B19] transition active:bg-[#FAF7F2]"
              >
                <Link2 size={18} strokeWidth={1.6} className="text-[#5C5A55]" />
                <span>打开原件</span>
              </button>
            ) : null}
          </div>

          <div className="mt-4 border-t border-[#E8E2D5] pt-3">
            {effectiveCanPersist ? (
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => {
                    void onUpdateCaptureStatus({
                      action: 'archive',
                      sourceKey,
                      itemId: item.id,
                    }).finally(() => {
                      onClose();
                    });
                  }}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-[#5C5A55] transition hover:text-[#1C1B19]"
                >
                  <History size={15} />
                  <span>先收起</span>
                </button>
                {isConfirmingDelete ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onSetConfirmDelete(null)}
                      className="rounded-full bg-[#E8E2D5] px-3 py-2 text-[12px] font-medium text-[#5C5A55] transition hover:bg-[#DDDDD9] hover:text-[#1C1B19]"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void onUpdateCaptureStatus({
                          action: 'delete',
                          sourceKey,
                          itemId: item.id,
                        }).finally(() => {
                          onClose();
                        });
                      }}
                      className="rounded-full bg-vermilion px-3 py-2 text-[12px] font-semibold text-white transition hover:bg-vermilion-deep"
                    >
                      确认删除
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => onSetConfirmDelete(item.id)}
                    className="text-sm font-medium text-[#8E8B82] transition hover:text-vermilion-deep"
                  >
                    删除
                  </button>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  onRemoveFromFlow({
                    itemId: item.id,
                    sourceKey,
                  });
                  onClose();
                }}
                className="text-sm font-medium text-vermilion transition hover:text-vermilion-deep"
              >
                删除这条
              </button>
            )}
            {isConfirmingDelete ? (
              <p className="mt-2 text-[11px] font-medium text-vermilion">{COPY.collection.deleteMemoryWarning}</p>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
