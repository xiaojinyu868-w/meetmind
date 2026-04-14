'use client';

/**
 * CollectionComposerBar — 收集页输入栏 v2
 *
 * 设计升级：
 * - 卡片化浮动输入栏，与内容区背景分离
 * - 输入框大圆角 + focus 边框过渡
 * - 操作按钮统一圆角 + 精致 hover 态
 * - 零渐变、零阴影、纯平涂
 */

import type { ClipboardEvent, MutableRefObject } from 'react';
import { AudioLines, ArrowUp, Mic, Plus } from 'lucide-react';
import { compactText } from '@/lib/utils/page-utils';
import { CollectionComposerContextPreview } from '@/components/CollectionComposerContextPreview';

interface CollectionComposerBarProps {
  quotedCount: number;
  quotedPrimaryTypeLabel: string;
  quotedSummaryText: string;
  onClearQuoted: () => void;
  linkPreviewLabel: string;
  autoImportLink: boolean;
  onOpenLiveRecorder: () => void;
  disableLiveRecorder: boolean;
  composerRef: MutableRefObject<HTMLTextAreaElement | null>;
  value: string;
  onChangeValue: (value: string) => void;
  onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  placeholder: string;
  rows: number;
  sourceImporting: boolean;
  activeSourceImportCount: number;
  composerVoiceStatus: string;
  isComposerVoiceRecording: boolean;
  composerVoiceInterimText: string;
  sourceImportError: string;
  onSubmit: () => void;
  onToggleDictation: () => void | Promise<void>;
  disableDictation: boolean;
  onUploadAll: () => void;
}

export function CollectionComposerBar({
  quotedCount,
  quotedPrimaryTypeLabel,
  quotedSummaryText,
  onClearQuoted,
  linkPreviewLabel,
  autoImportLink,
  onOpenLiveRecorder,
  disableLiveRecorder,
  composerRef,
  value,
  onChangeValue,
  onPaste,
  placeholder,
  rows,
  sourceImporting,
  activeSourceImportCount,
  composerVoiceStatus,
  isComposerVoiceRecording,
  composerVoiceInterimText,
  sourceImportError,
  onSubmit,
  onToggleDictation,
  disableDictation,
  onUploadAll,
}: CollectionComposerBarProps) {
  const composerHasText = value.trim().length > 0;
  const showComposerAssistState =
    sourceImporting || composerVoiceStatus === 'connecting' || isComposerVoiceRecording || autoImportLink;

  return (
    <div className="relative z-20 flex-shrink-0 bg-[#F7F7F5] px-3 pb-3 pt-2 lg:px-5 lg:pb-4 lg:pt-2.5">
      <div className="mx-auto w-full max-w-3xl">
        <CollectionComposerContextPreview
          quotedCount={quotedCount}
          quotedPrimaryTypeLabel={quotedPrimaryTypeLabel}
          quotedSummaryText={quotedSummaryText}
          onClearQuoted={onClearQuoted}
          linkPreviewLabel={linkPreviewLabel}
          autoImportLink={autoImportLink}
        />

        {/* 输入卡片 */}
        <div className="rounded-2xl bg-white ring-[0.5px] ring-[#232322]/[0.06] transition-all focus-within:ring-[#232322]/[0.12]">
          <div className="flex items-end gap-1 px-2 pb-2 pt-1.5">
            {/* 录制原声 */}
            <button
              type="button"
              onClick={onOpenLiveRecorder}
              disabled={isComposerVoiceRecording || composerVoiceStatus === 'connecting' || disableLiveRecorder}
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-[#FDF3C0]/70 text-[#8B6914] transition hover:bg-[#FDF3C0] disabled:opacity-40"
              aria-label="录制原声"
            >
              <AudioLines size={18} strokeWidth={1.5} />
            </button>

            {/* 输入框 */}
            <div className="min-w-0 flex-1 px-1 py-1">
              <textarea
                ref={composerRef}
                data-testid="collection-composer-input"
                value={value}
                onChange={(event) => onChangeValue(event.target.value)}
                onPaste={onPaste}
                placeholder={placeholder}
                rows={rows}
                className="max-h-28 min-h-[24px] w-full resize-none appearance-none border-0 bg-transparent px-0 py-0 text-[15px] leading-[24px] text-[#232322] outline-none ring-0 shadow-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 placeholder:text-[#A3A39E]"
              />
              {showComposerAssistState ? (
                <p className="mt-0.5 text-[11px] text-[#A3A39E]">
                  {sourceImporting
                    ? activeSourceImportCount > 1
                      ? `${activeSourceImportCount} 个文件已收下`
                      : '文件已收下'
                    : composerVoiceStatus === 'connecting'
                      ? '正在打开语音听写...'
                      : isComposerVoiceRecording
                        ? compactText(composerVoiceInterimText || '正在听你说...', 28)
                        : ''}
                </p>
              ) : null}
              {!sourceImporting && sourceImportError ? (
                <p className="mt-0.5 text-[11px] text-rose-500">{compactText(sourceImportError, 40)}</p>
              ) : null}
            </div>

            {/* 发送 / 听写 / 上传 */}
            {composerHasText ? (
              <button
                type="button"
                data-testid="collection-composer-submit"
                onClick={onSubmit}
                disabled={isComposerVoiceRecording || composerVoiceStatus === 'connecting'}
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-[#232322] text-white transition hover:bg-[#111111] disabled:opacity-40"
                aria-label="发送到收集流"
              >
                <ArrowUp size={17} strokeWidth={2.5} />
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    void onToggleDictation();
                  }}
                  disabled={disableDictation}
                  className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl transition ${
                    composerVoiceStatus === 'connecting' || isComposerVoiceRecording
                      ? 'text-[#232322] bg-[#FDF3C0]'
                      : 'text-[#A3A39E] hover:text-[#787774] hover:bg-[#F7F7F5]'
                  } disabled:text-[#E9E9E7]`}
                  aria-label={isComposerVoiceRecording || composerVoiceStatus === 'connecting' ? '停止语音听写' : '语音转文字'}
                >
                  <Mic size={20} strokeWidth={1.5} />
                </button>
                <button
                  type="button"
                  data-testid="collection-upload-button"
                  onClick={onUploadAll}
                  className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl transition ${
                    sourceImporting
                      ? 'text-[#232322] bg-[#D3E4F4]/60'
                      : 'text-[#A3A39E] hover:text-[#787774] hover:bg-[#F7F7F5]'
                  }`}
                  aria-label="上传文件"
                >
                  <Plus size={22} strokeWidth={1.5} />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
