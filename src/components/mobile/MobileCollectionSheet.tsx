'use client';

import type { CSSProperties, ReactNode } from 'react';
import { Boxes, ChevronRight, Sparkles, X } from 'lucide-react';
import { EchoCard, type EchoData } from '@/components/EchoCard';
import { WorkspaceCaptureList, type WorkspaceCaptureListItem } from '@/components/WorkspaceCaptureList';
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
}: MobileCollectionSheetProps) {
  if (!mobileCollectionSheet) {
    return null;
  }

  if (mobileCollectionSheet === 'more') {
    // ── 收集菜单面板内容（共用） ──
    const moreContent = (
      <>
        <div className="border-b border-[#E8E2D5] px-5 pb-4 pt-[max(env(safe-area-inset-top),20px)]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-2xl font-semibold tracking-[-0.02em] text-[#1C1B19]">收集</p>
              <p className="mt-1 text-[12px] text-[#5C5A55]">
                已收 {captureActivitySummary.totalCount} 条 · 活跃 {captureActivitySummary.activeDays} 天 · 笔记总结{' '}
                {workspaceEchoes.length} 条
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-10 w-10 items-center justify-center rounded-[16px] border border-[#E8E2D5] text-[#5C5A55] transition hover:bg-[#FAF7F2] hover:text-[#1C1B19]"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto p-3">
          <div className="rounded-[18px] bg-[#FAF7F2] px-4 py-3 text-left">
            <p className="text-sm font-semibold text-[#1C1B19]">
              {captureActivitySummary.streak > 0
                ? `已经连续 ${captureActivitySummary.streak} 天在收`
                : '先从今天收一点开始'}
            </p>
            <p className="mt-1 text-xs leading-5 text-[#5C5A55]">
              {captureActivitySummary.topKinds.length > 0
                ? `最近收得最多的是：${captureActivitySummary.topKinds.join(' · ')}`
                : '一句困惑、一张图、一份讲义或一段录音，都可以先发进来。'}
            </p>
          </div>

          <button
            type="button"
            onClick={() => onChangeSheet('history')}
            className="flex w-full items-center gap-3 rounded-[18px] bg-[#2D6A4F] px-4 py-3 text-left text-white transition hover:bg-[#1A3327]"
          >
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/18 text-white">
              <Boxes size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">全部收集</p>
              <p className="mt-0.5 text-[12px] leading-5 text-white/85">从以前收进来的课、图和材料里继续接着学。</p>
            </div>
            <ChevronRight size={16} className="text-white/80" />
          </button>

          <button
            type="button"
            onClick={() => onChangeSheet('echo')}
            className="flex w-full items-center gap-3 rounded-[18px] border border-[#E8E2D5] bg-[#FAF7F2]/80 px-4 py-3 text-left transition hover:border-[#DDDDD9] hover:bg-white"
          >
            <span className="relative inline-flex h-9 w-9 items-center justify-center rounded-full bg-white text-[#1C1B19]">
              <Sparkles size={16} />
              {showCollectionPulsePreview && hasCollectionPulse ? (
                <span className="absolute right-1.5 top-1.5 inline-flex h-2 w-2 rounded-full bg-[#1C1B19]" />
              ) : null}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-[#1C1B19]">笔记总结</p>
              <p className="mt-0.5 text-xs leading-5 text-[#5C5A55]">
                {workspaceEchoes.length > 0 ? '同桌整理了一些重点。' : '先继续收集，笔记总结会安静出现。'}
              </p>
            </div>
            <ChevronRight size={16} className="text-[#8E8B82]" />
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
          className={`${backdropPositionClass} z-20 bg-[#1C1B19]/18`}
        />
        {isMobile ? (
          /* ── 移动端：左侧抽屉 ── */
          <div
            className={`${collectionChromeContained ? 'absolute inset-y-0 left-0' : 'fixed inset-y-0 left-0'} z-30 w-[86vw] max-w-[360px]`}
          >
            <div className="flex h-full flex-col overflow-hidden rounded-r-[30px] border-r border-[#E8E2D5] bg-white">
              {moreContent}
            </div>
          </div>
        ) : (
          /* ── 桌面端：右侧上下文抽屉 ── */
          <div className={`${collectionChromeContained ? 'absolute inset-0' : 'fixed inset-0'} z-30 flex justify-end`}>
            <div className="flex h-full w-[min(520px,calc(100vw-188px))] min-w-[420px] flex-col overflow-hidden border-l border-[#E8E2D5] bg-white animate-in fade-in slide-in-from-right-6 duration-200">
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
        className={`${backdropPositionClass} z-20 bg-[#1C1B19]/18`}
      />
      {isMobile ? (
        /* ── 移动端：底部 sheet ── */
        <div
          className={`${collectionChromeContained ? 'absolute inset-x-0' : 'fixed inset-x-0'} z-30 ${dockPaddingClass}`}
          style={{ bottom: `${sheetBottomOffset}px` }}
        >
          <div
            className={`mx-auto flex w-full ${sheetWidthClass} flex-col overflow-hidden rounded-[30px] border border-[#E8E2D5] bg-white`}
            style={{ maxHeight: mobileSheetMaxHeight }}
          >
            <div className="flex items-center justify-between border-b border-[#E8E2D5] px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-[#1C1B19]">
                  {mobileCollectionSheet === 'echo'
                    ? '笔记总结'
                    : mobileCollectionSheet === 'history'
                      ? '历史收集'
                      : '收集菜单'}
                </p>
                {mobileCollectionSheet === 'echo' ? (
                  <p className="text-[12px] text-[#5C5A55]">安静整理出的重点。</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex h-10 w-10 items-center justify-center rounded-[16px] border border-[#E8E2D5] bg-white/92 text-[#5C5A55] transition hover:bg-white hover:text-[#1C1B19]"
              >
                <X size={16} />
              </button>
            </div>

            {mobileCollectionSheet === 'echo' ? (
              <div
                data-mobile-sheet-scrollable="echo"
                className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4"
                style={mobileSheetScrollableStyle}
              >
                {workspaceEchoes.length > 0 ? (
                  <>
                    {workspaceEchoes.map((echo) => (
                      <EchoCard
                        key={echo.id}
                        echo={{
                          id: echo.id,
                          kind: echo.kind,
                          title: echo.title,
                          body: echo.body,
                          highlights: echo.highlights,
                          takeaway: echo.takeaway,
                          sourceCaptureIds: echo.sourceCaptureIds,
                          createdAt: echo.createdAt,
                          updatedAt: echo.updatedAt,
                        }}
                        onShare={onShareEcho}
                      />
                    ))}
                    {enableManualEchoTrigger ? (
                      <div className="pt-2">
                        {renderManualEchoTriggerButton(
                          'text-[11px] font-medium text-[#8E8B82] transition hover:text-[#5C5A55] disabled:cursor-not-allowed disabled:opacity-60'
                        )}
                      </div>
                    ) : null}
                    {manualEchoFeedbackView}
                    {manualEchoDebugView}
                  </>
                ) : (
                  <div className="flex flex-col items-center py-12">
                    <span className="text-2xl text-[#8E8B82]/40">✦</span>
                    <p className="mt-3 text-[14px] leading-7 text-[#8E8B82]">
                      先继续收集，笔记总结会安静地出现。
                    </p>
                    {enableManualEchoTrigger ? (
                      <div className="mt-4">
                        {renderManualEchoTriggerButton(
                          'text-xs font-medium text-[#8E8B82] transition hover:text-[#5C5A55] disabled:cursor-not-allowed disabled:opacity-60'
                        )}
                      </div>
                    ) : null}
                    {manualEchoFeedbackView}
                    {manualEchoDebugView}
                  </div>
                )}
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
          <div className="flex h-full w-[min(640px,68vw)] min-w-[520px] flex-col overflow-hidden border-l border-[#E8E2D5] bg-white animate-in fade-in slide-in-from-right-6 duration-200">
            <div className="flex items-start justify-between gap-4 border-b border-[#E8E2D5] px-6 py-5">
              <div className="min-w-0">
                <p className="text-[15px] font-semibold tracking-[-0.01em] text-[#1C1B19]">
                  {mobileCollectionSheet === 'echo'
                    ? '笔记总结'
                    : mobileCollectionSheet === 'history'
                      ? '历史收集'
                      : '收集菜单'}
                </p>
                {mobileCollectionSheet === 'echo' ? (
                  <p className="mt-2 max-w-[420px] text-[13px] leading-6 text-[#5C5A55]">
                    这些不是弹窗通知，而是同桌从你收集过的内容里安静整理出的重点。
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-[#E8E2D5] text-[#5C5A55] transition hover:bg-[#FAF7F2] hover:text-[#1C1B19]"
              >
                <X size={15} />
              </button>
            </div>

            {mobileCollectionSheet === 'echo' ? (
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-[#FAF7F2] p-5">
                {workspaceEchoes.length > 0 ? (
                  <>
                    {workspaceEchoes.map((echo) => (
                      <EchoCard
                        key={echo.id}
                        echo={{
                          id: echo.id,
                          kind: echo.kind,
                          title: echo.title,
                          body: echo.body,
                          highlights: echo.highlights,
                          takeaway: echo.takeaway,
                          sourceCaptureIds: echo.sourceCaptureIds,
                          createdAt: echo.createdAt,
                          updatedAt: echo.updatedAt,
                        }}
                        onShare={onShareEcho}
                      />
                    ))}
                    {enableManualEchoTrigger ? (
                      <div className="pt-2">
                        {renderManualEchoTriggerButton(
                          'text-[11px] font-medium text-[#8E8B82] transition hover:text-[#5C5A55] disabled:cursor-not-allowed disabled:opacity-60'
                        )}
                      </div>
                    ) : null}
                    {manualEchoFeedbackView}
                    {manualEchoDebugView}
                  </>
                ) : (
                  <div className="flex min-h-full flex-col justify-center rounded-[24px] border border-[#E8E2D5] bg-white px-8 py-12 text-left">
                    <p className="max-w-[360px] text-[22px] font-semibold leading-tight tracking-[-0.03em] text-[#1C1B19]">
                      继续收集，重点会自己浮出来。
                    </p>
                    <p className="mt-3 max-w-[380px] text-[14px] leading-7 text-[#5C5A55]">
                      它不会打断你，也不会急着生成长报告。等上下文够了，这里会出现小而有根的笔记总结。
                    </p>
                    {enableManualEchoTrigger ? (
                      <div className="mt-5">
                        {renderManualEchoTriggerButton(
                          'text-xs font-medium text-[#8E8B82] transition hover:text-[#5C5A55] disabled:cursor-not-allowed disabled:opacity-60'
                        )}
                      </div>
                    ) : null}
                    {manualEchoFeedbackView}
                    {manualEchoDebugView}
                  </div>
                )}
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
