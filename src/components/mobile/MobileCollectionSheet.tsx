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
        <div className="border-b border-[#E9E9E7] px-5 pb-4 pt-[max(env(safe-area-inset-top),20px)]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-2xl font-semibold tracking-[-0.02em] text-[#232322]">收集</p>
              <p className="mt-1 text-xs text-[#787774]">
                已收 {captureActivitySummary.totalCount} 条 · 活跃 {captureActivitySummary.activeDays} 天 · 回声{' '}
                {workspaceEchoes.length} 条
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-10 w-10 items-center justify-center rounded-[16px] border border-[#E9E9E7] text-[#787774] transition hover:bg-[#F7F7F5] hover:text-[#232322]"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto p-3">
          <div className="rounded-[18px] bg-[#F7F7F5] px-4 py-3 text-left">
            <p className="text-sm font-semibold text-[#232322]">
              {captureActivitySummary.streak > 0
                ? `已经连续 ${captureActivitySummary.streak} 天在收`
                : '先从今天收一点开始'}
            </p>
            <p className="mt-1 text-xs leading-5 text-[#787774]">
              {captureActivitySummary.topKinds.length > 0
                ? `最近收得最多的是：${captureActivitySummary.topKinds.join(' · ')}`
                : '一句困惑、一张图、一份讲义或一段原声，都可以先发进来。'}
            </p>
          </div>

          <button
            type="button"
            onClick={() => onChangeSheet('history')}
            className="flex w-full items-center gap-3 rounded-[18px] bg-[#07c160] px-4 py-3 text-left text-white transition hover:bg-[#06b458]"
          >
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/18 text-white">
              <Boxes size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">全部收集</p>
              <p className="mt-0.5 text-xs leading-5 text-white/85">从以前收进来的课、图和材料里继续接着学。</p>
            </div>
            <ChevronRight size={16} className="text-white/80" />
          </button>

          <button
            type="button"
            onClick={() => onChangeSheet('echo')}
            className="flex w-full items-center gap-3 rounded-[18px] border border-[#E9E9E7] bg-[#F7F7F5]/80 px-4 py-3 text-left transition hover:border-[#DDDDD9] hover:bg-white"
          >
            <span className="relative inline-flex h-9 w-9 items-center justify-center rounded-full bg-white text-[#232322]">
              <Sparkles size={16} />
              {showCollectionPulsePreview && hasCollectionPulse ? (
                <span className="absolute right-1.5 top-1.5 inline-flex h-2 w-2 rounded-full bg-[#232322]" />
              ) : null}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-[#232322]">回声</p>
              <p className="mt-0.5 text-xs leading-5 text-[#787774]">
                {workspaceEchoes.length > 0 ? '同桌有话想跟你说。' : '先继续收集，回声会安静出现。'}
              </p>
            </div>
            <ChevronRight size={16} className="text-[#A3A39E]" />
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
          className={`${backdropPositionClass} z-20 bg-[#232322]/18`}
        />
        {isMobile ? (
          /* ── 移动端：左侧抽屉 ── */
          <div
            className={`${collectionChromeContained ? 'absolute inset-y-0 left-0' : 'fixed inset-y-0 left-0'} z-30 w-[86vw] max-w-[360px]`}
          >
            <div className="flex h-full flex-col overflow-hidden rounded-r-[30px] border-r border-[#E9E9E7] bg-white">
              {moreContent}
            </div>
          </div>
        ) : (
          /* ── 桌面端：居中弹窗 ── */
          <div
            className={`${collectionChromeContained ? 'absolute inset-0' : 'fixed inset-0'} z-30 flex items-center justify-center p-6`}
          >
            <div className="flex w-full max-w-md flex-col overflow-hidden rounded-2xl border border-[#E9E9E7] bg-white" style={{ maxHeight: 'min(70vh, 520px)' }}>
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
        className={`${backdropPositionClass} z-20 bg-[#232322]/18`}
      />
      {isMobile ? (
        /* ── 移动端：底部 sheet ── */
        <div
          className={`${collectionChromeContained ? 'absolute inset-x-0' : 'fixed inset-x-0'} z-30 ${dockPaddingClass}`}
          style={{ bottom: `${sheetBottomOffset}px` }}
        >
          <div
            className={`mx-auto flex w-full ${sheetWidthClass} flex-col overflow-hidden rounded-[30px] border border-[#E9E9E7] bg-white`}
            style={{ maxHeight: mobileSheetMaxHeight }}
          >
            <div className="flex items-center justify-between border-b border-[#E9E9E7] px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-[#232322]">
                  {mobileCollectionSheet === 'echo'
                    ? '回声'
                    : mobileCollectionSheet === 'history'
                      ? '历史收集'
                      : '收集菜单'}
                </p>
                {mobileCollectionSheet === 'echo' ? (
                  <p className="text-xs text-[#787774]">安静地长出来的东西。</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex h-10 w-10 items-center justify-center rounded-[16px] border border-[#E9E9E7] bg-white/92 text-[#787774] transition hover:bg-white hover:text-[#232322]"
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
                          'text-[11px] font-medium text-[#A3A39E] transition hover:text-[#787774] disabled:cursor-not-allowed disabled:opacity-60'
                        )}
                      </div>
                    ) : null}
                    {manualEchoFeedbackView}
                    {manualEchoDebugView}
                  </>
                ) : (
                  <div className="flex flex-col items-center py-12">
                    <span className="text-2xl text-[#A3A39E]/40">✦</span>
                    <p className="mt-3 text-[14px] leading-7 text-[#A3A39E]">
                      先继续收集，回声会安静地出现。
                    </p>
                    {enableManualEchoTrigger ? (
                      <div className="mt-4">
                        {renderManualEchoTriggerButton(
                          'text-xs font-medium text-[#A3A39E] transition hover:text-[#787774] disabled:cursor-not-allowed disabled:opacity-60'
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
        /* ── 桌面端：居中弹窗 ── */
        <div
          className={`${collectionChromeContained ? 'absolute inset-0' : 'fixed inset-0'} z-30 flex items-center justify-center p-6`}
        >
          <div
            className="flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[#E9E9E7] bg-white"
            style={{ maxHeight: 'min(80vh, 680px)' }}
          >
            <div className="flex items-center justify-between border-b border-[#E9E9E7] px-5 py-4">
              <div>
                <p className="text-[15px] font-semibold text-[#232322]">
                  {mobileCollectionSheet === 'echo'
                    ? '回声'
                    : mobileCollectionSheet === 'history'
                      ? '历史收集'
                      : '收集菜单'}
                </p>
                {mobileCollectionSheet === 'echo' ? (
                  <p className="mt-0.5 text-[13px] text-[#787774]">安静地长出来的东西。</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#E9E9E7] text-[#787774] transition hover:bg-[#F7F7F5] hover:text-[#232322]"
              >
                <X size={15} />
              </button>
            </div>

            {mobileCollectionSheet === 'echo' ? (
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
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
                          'text-[11px] font-medium text-[#A3A39E] transition hover:text-[#787774] disabled:cursor-not-allowed disabled:opacity-60'
                        )}
                      </div>
                    ) : null}
                    {manualEchoFeedbackView}
                    {manualEchoDebugView}
                  </>
                ) : (
                  <div className="flex flex-col items-center py-16">
                    <span className="text-2xl text-[#A3A39E]/40">✦</span>
                    <p className="mt-3 text-[14px] leading-7 text-[#A3A39E]">
                      先继续收集，回声会安静地出现。
                    </p>
                    {enableManualEchoTrigger ? (
                      <div className="mt-4">
                        {renderManualEchoTriggerButton(
                          'text-xs font-medium text-[#A3A39E] transition hover:text-[#787774] disabled:cursor-not-allowed disabled:opacity-60'
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
