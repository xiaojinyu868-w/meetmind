'use client';

import type { ClipboardEvent, MutableRefObject } from 'react';
import { AudioLines, ArrowUp, Mic, Plus } from 'lucide-react';
import { compactText } from '@/lib/utils/page-utils';
import { CollectionComposerContextPreview } from '@/components/CollectionComposerContextPreview';

interface CollectionComposerBarProps {
  desktopShell: boolean;
  dockWidthClass: string;
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
  desktopShell,
  dockWidthClass,
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
    <div
      className={`relative z-20 flex-shrink-0 bg-[#F7F7F7] ${desktopShell ? 'px-4 pb-5 pt-2' : 'px-2 pb-[max(env(safe-area-inset-bottom),6px)] pt-1.5'}`}
      style={{ borderTop: '0.5px solid #E0E0E0' }}
    >
      <div className={`mx-auto w-full ${dockWidthClass}`}>
        <CollectionComposerContextPreview
          quotedCount={quotedCount}
          quotedPrimaryTypeLabel={quotedPrimaryTypeLabel}
          quotedSummaryText={quotedSummaryText}
          onClearQuoted={onClearQuoted}
          linkPreviewLabel={linkPreviewLabel}
          autoImportLink={autoImportLink}
        />
        <div className="flex items-end gap-1">
          <button
            type="button"
            onClick={onOpenLiveRecorder}
            disabled={isComposerVoiceRecording || composerVoiceStatus === 'connecting' || disableLiveRecorder}
            className="flex h-[36px] w-[36px] flex-shrink-0 items-center justify-center text-slate-500 transition hover:text-slate-700 disabled:text-slate-300"
            aria-label="录制原声"
          >
            <AudioLines size={24} strokeWidth={1.5} />
          </button>
          <div className="min-w-0 flex-1 rounded-lg bg-white px-3 py-[7px]">
            <textarea
              ref={composerRef}
              data-testid="collection-composer-input"
              value={value}
              onChange={(event) => onChangeValue(event.target.value)}
              onPaste={onPaste}
              placeholder={placeholder}
              rows={rows}
              className="max-h-28 min-h-[22px] w-full resize-none appearance-none border-0 bg-transparent px-0 py-0 text-[15px] leading-[22px] text-slate-900 outline-none ring-0 shadow-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 placeholder:text-slate-400"
            />
            {showComposerAssistState ? (
              <p className="mt-1 text-[11px] text-slate-400">
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
              <p className="mt-1 text-[11px] text-rose-400">{compactText(sourceImportError, 40)}</p>
            ) : null}
          </div>
          {composerHasText ? (
            <button
              type="button"
              data-testid="collection-composer-submit"
              onClick={onSubmit}
              disabled={isComposerVoiceRecording || composerVoiceStatus === 'connecting'}
              className="flex h-[36px] w-[36px] flex-shrink-0 items-center justify-center rounded-lg bg-indigo-500 text-white transition hover:bg-indigo-600 disabled:opacity-40"
              aria-label="发送到收集流"
            >
              <ArrowUp size={18} strokeWidth={2.5} />
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  void onToggleDictation();
                }}
                disabled={disableDictation}
                className={`flex h-[36px] w-[36px] flex-shrink-0 items-center justify-center transition ${
                  composerVoiceStatus === 'connecting' || isComposerVoiceRecording
                    ? 'text-indigo-500'
                    : 'text-slate-500 hover:text-slate-700'
                } disabled:text-slate-300`}
                aria-label={isComposerVoiceRecording || composerVoiceStatus === 'connecting' ? '停止语音听写' : '语音转文字'}
              >
                <Mic size={24} strokeWidth={1.5} />
              </button>
              <button
                type="button"
                data-testid="collection-upload-button"
                onClick={onUploadAll}
                className={`flex h-[36px] w-[36px] flex-shrink-0 items-center justify-center transition ${
                  sourceImporting
                    ? 'text-indigo-500'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
                aria-label="上传文件"
              >
                <Plus size={26} strokeWidth={1.5} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
