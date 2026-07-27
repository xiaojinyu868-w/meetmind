'use client';

import type { CSSProperties, ReactNode } from 'react';
import { Boxes, ChevronRight, Sparkles, X } from 'lucide-react';
import { type EchoData } from '@/components/EchoCard';
import { CrossCourseFeedPanel } from '@/components/CrossCourseFeedPanel';
import { WorkspaceCaptureList, type WorkspaceCaptureListItem } from '@/components/WorkspaceCaptureList';
import { COPY } from '@/lib/ui/copy';
import type {
  MobileCollectionSheet as MobileCollectionSheetType,
  WorkspaceCaptureEditorMode,
  WorkspaceEchoMessage,
} from '@/types/page-types';

interface CaptureActivitySummary {
  totalCount: number;
  activeDays: number;
  streak: number;
  topKinds: string[];
}

interface MobileCollectionSheetProps {
  mobileCollectionSheet: MobileCollectionSheetType;
  /** 是否为移动端（影响弹窗定位模式） */
  isMobile: boolean;
  backdropPositionClass: string;
  collectionChromeContained: boolean;
  dockPaddingClass: string;
  sheetBottomOffset: number;
  sheetWidthClass: string;
  mobileSheetMaxHeight: string;
  mobileSheetScrollableStyle?: CSSProperties;
  captureActivitySummary: CaptureActivitySummary;
  workspaceEchoes: WorkspaceEchoMessage[];
  showCollectionPulsePreview: boolean;
  hasCollectionPulse: boolean;
  enableManualEchoTrigger: boolean;
  allCollectionItems: WorkspaceCaptureListItem[];
  selectedCaptureIds: string[];
  selectionMode: boolean;
  manualEchoFeedbackView: ReactNode;
  manualEchoDebugView: ReactNode;
  renderManualEchoTriggerButton: (className: string) => ReactNode;
  onClose: () => void;
  onChangeSheet: (sheet: MobileCollectionSheetType) => void;
  onShareEcho: (echoData: EchoData) => void;
  onOpenReview: (capture: WorkspaceCaptureListItem) => void;
  onQuoteCapture: (capture: WorkspaceCaptureListItem) => void;
  onAskTutorAboutCapture: (capture: WorkspaceCaptureListItem) => void;
  onToggleSelectCapture: (capture: WorkspaceCaptureListItem) => void;
  onArchiveCapture: (capture: WorkspaceCaptureListItem) => void;
  onRestoreCapture: (capture: WorkspaceCaptureListItem) => void;
  onDeleteCapture: (capture: WorkspaceCaptureListItem) => void;
  onEditCapture: (capture: WorkspaceCaptureListItem, mode: WorkspaceCaptureEditorMode) => void;
  onAISearch: () => void;
  onAddContext: () => void;
}

export function MobileCollectionSheet({
  mobileCollectionSheet,
  isMobile,
  backdropPositionClass,
  collectionChromeContained,
  dockPaddingClass,
  sheetBottomOffset,
  sheetWidthClass,
  mobileSheetMaxHeight,
  mobileSheetScrollableStyle,
  captureActivitySummary,
  workspaceEchoes,
  showCollectionPulsePreview,
  hasCollectionPulse,
  enableManualEchoTrigger,
  allCollectionItems,
  selectedCaptureIds,
  selectionMode,
  manualEchoFeedbackView,
  manualEchoDebugView,
  renderManualEchoTriggerButton,
  onClose,
  onChangeSheet,
  onShareEcho,
  onOpenReview,
  onQuoteCapture,
  onAskTutorAboutCapture,
  onToggleSelectCapture,
  onArchiveCapture,
  onRestoreCapture,
  onDeleteCapture,
  onEditCapture,
  onAISearch,
  onAddContext,
}: MobileCollectionSheetProps) {
  if (!mobileCollectionSheet) {
    return null;
  }

  if (mobileCollectionSheet === 'more') {
    // ── 收集菜单面板内容（共用） ──
    const moreContent = (
      <>
        <div className="border-b border-divider px-5 pb-4 pt-[max(env(safe-area-inset-top),20px)]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-2xl font-semibold tracking-[-0.02em] text-ink">{COPY.navigation.collection}</p>
              <p className="mt-1 text-[12px] text-ink-secondary">
                {COPY.collection.menuSummary(captureActivitySummary.totalCount, captureActivitySummary.activeDays)}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭收集菜单"
              className="flex h-10 w-10 items-center justify-center rounded-[16px] border border-divider text-ink-secondary transition hover:bg-paper hover:text-ink"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto p-3">
          <div className="rounded-[18px] bg-paper px-4 py-3 text-left">
            <p className="text-sm font-semibold text-ink">
              {captureActivitySummary.streak > 0
                ? COPY.collection.menuStreakActive(captureActivitySummary.streak)
                : COPY.collection.menuStreakIdle}
            </p>
            <p className="mt-1 text-xs leading-5 text-ink-secondary">
              {captureActivitySummary.topKinds.length > 0
                ? COPY.collection.menuTopKinds(captureActivitySummary.topKinds.join(' · '))
                : COPY.collection.menuIdleHint}
            </p>
          </div>

          <button
            type="button"
            onClick={() => onChangeSheet('history')}
            className="flex w-full items-center gap-3 rounded-[18px] bg-pine px-4 py-3 text-left text-white transition hover:bg-pine-deep"
          >
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/18 text-white">
              <Boxes size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{COPY.navigation.allCollections}</p>
              <p className="mt-0.5 text-[12px] leading-5 text-white/85">{COPY.collection.menuAllCollectionsDesc}</p>
            </div>
            <ChevronRight size={16} className="text-white/80" />
          </button>

          <button
            type="button"
            onClick={() => onChangeSheet('echo')}
            className="flex w-full items-center gap-3 rounded-[18px] border border-divider bg-paper/80 px-4 py-3 text-left transition hover:border-ink-muted/40 hover:bg-white"
          >
            <span className="relative inline-flex h-9 w-9 items-center justify-center rounded-full bg-white text-ink">
              <Sparkles size={16} />
              {showCollectionPulsePreview && hasCollectionPulse ? (
                <span className="absolute right-1.5 top-1.5 inline-flex h-2 w-2 rounded-full bg-vermilion" />
              ) : null}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink">{COPY.feed.relatedInfoLabel}</p>
              <p className="mt-0.5 text-xs leading-5 text-ink-secondary">
                {workspaceEchoes.length > 0 ? COPY.collection.menuEchoActiveHint : COPY.collection.menuEchoIdleHint}
              </p>
            </div>
            <ChevronRight size={16} className="text-ink-muted" />
          </button>
        </div>
      </>
    );

    return (
      <>
        <button
          type="button"
          aria-label="关闭收集菜单"
          onClick={onClose}
          className={`${backdropPositionClass} z-20 bg-ink/18`}
        />
        {isMobile ? (
          /* ── 移动端：左侧抽屉 ── */
          <div
            className={`${collectionChromeContained ? 'absolute inset-y-0 left-0' : 'fixed inset-y-0 left-0'} z-30 w-[86vw] max-w-[360px]`}
          >
            <div className="flex h-full flex-col overflow-hidden rounded-r-[30px] border-r border-divider bg-card">
              {moreContent}
            </div>
          </div>
        ) : (
          /* ── 桌面端：右侧上下文抽屉 ── */
          <div className={`${collectionChromeContained ? 'absolute inset-0' : 'fixed inset-0'} z-30 flex justify-end`}>
            <div role="dialog" aria-modal="true" aria-label={COPY.feed.drawerTitle} className="flex h-full w-[min(520px,calc(100vw-188px))] min-w-[420px] flex-col overflow-hidden border-l border-divider bg-card animate-in fade-in slide-in-from-right-6 duration-200">
              {moreContent}
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        aria-label="关闭收集附加层"
        onClick={onClose}
        className={`${backdropPositionClass} z-20 bg-ink/18`}
      />
      {isMobile ? (
        /* ── 移动端：底部 sheet ── */
        <div
          className={`${collectionChromeContained ? 'absolute inset-x-0' : 'fixed inset-x-0'} z-30 ${dockPaddingClass}`}
          style={{ bottom: `${sheetBottomOffset}px` }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={mobileCollectionSheet === 'echo' ? COPY.feed.drawerTitle : COPY.navigation.collection}
            className={`mx-auto flex w-full ${sheetWidthClass} flex-col overflow-hidden rounded-[30px] border border-divider bg-card`}
            style={{ maxHeight: mobileSheetMaxHeight }}
          >
            <div className="flex items-center justify-between border-b border-divider px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-ink">
                  {mobileCollectionSheet === 'echo'
                    ? COPY.feed.drawerTitle
                    : mobileCollectionSheet === 'history'
                      ? COPY.collection.historyTitle
                      : COPY.collection.menuTitle}
                </p>
                {mobileCollectionSheet === 'echo' ? (
                  <p className="text-[12px] text-ink-secondary">{COPY.feed.drawerSubtitle}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="关闭收集附加层"
                className="flex h-10 w-10 items-center justify-center rounded-[16px] border border-divider bg-card/95 text-ink-secondary transition hover:bg-card hover:text-ink"
              >
                <X size={16} />
              </button>
            </div>

            {mobileCollectionSheet === 'echo' ? (
              <div
                data-mobile-sheet-scrollable="echo"
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4"
                style={mobileSheetScrollableStyle}
              >
                <CrossCourseFeedPanel
                  onAddContext={onAddContext}
                  onOpenCapture={(rawId) => {
                    const li = allCollectionItems.find(
                      (c) => c.id === `workspace-${rawId}` || c.id === rawId || c.sourceKey === rawId,
                    );
                    if (li) onOpenReview(li);
                  }}
                  onAskTutor={() => {
                    // 跨课程信息流的「问同学」暂复用最近一条收集的 tutor 入口；
                    // 真正的「以任意文本启动 tutor」走 page 层，这里先保守接线。
                    const li = allCollectionItems[0];
                    if (li) onAskTutorAboutCapture(li);
                  }}
                  onShareEcho={onShareEcho}
                  enableManualEchoTrigger={enableManualEchoTrigger}
                  renderManualEchoTriggerButton={renderManualEchoTriggerButton}
                  manualEchoFeedbackView={manualEchoFeedbackView}
                  manualEchoDebugView={manualEchoDebugView}
                />
              </div>
            ) : null}

            {mobileCollectionSheet === 'history' ? (
              <div className="min-h-0 flex-1 overflow-hidden rounded-b-[30px]">
                <WorkspaceCaptureList
                  captures={allCollectionItems}
                  onClose={onClose}
                  onOpenReview={onOpenReview}
                  onQuoteCapture={onQuoteCapture}
                  onAskTutorAboutCapture={onAskTutorAboutCapture}
                  onToggleSelectCapture={onToggleSelectCapture}
                  onArchiveCapture={onArchiveCapture}
                  onRestoreCapture={onRestoreCapture}
                  onDeleteCapture={onDeleteCapture}
                  onEditCapture={onEditCapture}
                  onAISearch={onAISearch}
                  selectedCaptureIds={selectedCaptureIds}
                  selectionMode={selectionMode}
                  maxHeight="100%"
                  showHeader={false}
                />
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        /* ── 桌面端：右侧上下文抽屉 ── */
        <div className={`${collectionChromeContained ? 'absolute inset-0' : 'fixed inset-0'} z-30 flex justify-end`}>
          <div role="dialog" aria-modal="true" aria-label={mobileCollectionSheet === 'echo' ? COPY.feed.drawerTitle : COPY.navigation.collection} className="flex h-full w-[min(640px,68vw)] min-w-[520px] flex-col overflow-hidden border-l border-divider bg-card animate-in fade-in slide-in-from-right-6 duration-200">
            <div className="flex items-start justify-between gap-4 border-b border-divider px-6 py-5">
              <div className="min-w-0">
                <p className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
                  {mobileCollectionSheet === 'echo'
                    ? COPY.feed.drawerTitle
                    : mobileCollectionSheet === 'history'
                      ? COPY.collection.historyTitle
                      : COPY.collection.menuTitle}
                </p>
                {mobileCollectionSheet === 'echo' ? (
                  <p className="mt-2 max-w-[420px] text-[13px] leading-6 text-ink-secondary">
                    {COPY.feed.drawerSubtitle}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="关闭收集附加层"
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-divider text-ink-secondary transition hover:bg-paper hover:text-ink"
              >
                <X size={15} />
              </button>
            </div>

            {mobileCollectionSheet === 'echo' ? (
              <div className="min-h-0 flex-1 overflow-y-auto bg-paper p-5">
                <CrossCourseFeedPanel
                  onAddContext={onAddContext}
                  onOpenCapture={(rawId) => {
                    const li = allCollectionItems.find(
                      (c) => c.id === `workspace-${rawId}` || c.id === rawId || c.sourceKey === rawId,
                    );
                    if (li) onOpenReview(li);
                  }}
                  onAskTutor={() => {
                    // 跨课程信息流的「问同学」暂复用最近一条收集的 tutor 入口；
                    // 真正的「以任意文本启动 tutor」走 page 层，这里先保守接线。
                    const li = allCollectionItems[0];
                    if (li) onAskTutorAboutCapture(li);
                  }}
                  onShareEcho={onShareEcho}
                  enableManualEchoTrigger={enableManualEchoTrigger}
                  renderManualEchoTriggerButton={renderManualEchoTriggerButton}
                  manualEchoFeedbackView={manualEchoFeedbackView}
                  manualEchoDebugView={manualEchoDebugView}
                />
              </div>
            ) : null}

            {mobileCollectionSheet === 'history' ? (
              <div className="min-h-0 flex-1 overflow-hidden">
                <WorkspaceCaptureList
                  captures={allCollectionItems}
                  onClose={onClose}
                  onOpenReview={onOpenReview}
                  onQuoteCapture={onQuoteCapture}
                  onAskTutorAboutCapture={onAskTutorAboutCapture}
                  onToggleSelectCapture={onToggleSelectCapture}
                  onArchiveCapture={onArchiveCapture}
                  onRestoreCapture={onRestoreCapture}
                  onDeleteCapture={onDeleteCapture}
                  onEditCapture={onEditCapture}
                  onAISearch={onAISearch}
                  selectedCaptureIds={selectedCaptureIds}
                  selectionMode={selectionMode}
                  maxHeight="100%"
                  showHeader={false}
                />
              </div>
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}
