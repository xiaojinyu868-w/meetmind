'use client';

/**
 * CollectionComposerBar — 收集页输入栏 v3
 *
 * 布局：[+上传] [输入框] [发送|麦克风录课]
 * - 左侧 + 号：上传文件
 * - 中间：文本输入
 * - 右侧：有文字时显示发送，无文字时显示麦克风（开始录课）
 *
 * 设计系统：v7 设计宪法：95% 克制 + 5% 仪式时刻情绪化（shadow-soft / shadow-card / shadow-ai-glow）
 */

import type { ClipboardEvent, MutableRefObject } from 'react';
import { ArrowUp, Mic, Plus } from 'lucide-react';
import { compactText } from '@/lib/utils/page-utils';
import { COPY } from '@/lib/ui/copy';
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
  composerVoiceStatus: _composerVoiceStatus,
  isComposerVoiceRecording: _isComposerVoiceRecording,
  composerVoiceInterimText: _composerVoiceInterimText,
  sourceImportError,
  onSubmit,
  onToggleDictation: _onToggleDictation,
  disableDictation: _disableDictation,
  onUploadAll,
}: CollectionComposerBarProps) {
  const composerHasText = value.trim().length > 0;

  return (
    <div className="relative z-20 flex-shrink-0 bg-paper px-3 pb-3 pt-2 lg:px-5 lg:pb-4 lg:pt-2.5">
      <div className="mx-auto w-full max-w-3xl">
        <CollectionComposerContextPreview
          quotedCount={quotedCount}
          quotedPrimaryTypeLabel={quotedPrimaryTypeLabel}
          quotedSummaryText={quotedSummaryText}
          onClearQuoted={onClearQuoted}
          linkPreviewLabel={linkPreviewLabel}
          autoImportLink={autoImportLink}
        />

        {/* 输入卡片——ChatGPT 风格：上文本区 + 下按钮行 */}
        <div
          className="rounded-2xl border border-divider bg-card"
          onClick={() => composerRef.current?.focus()}
        >
          {/* 上：文本输入区，撑满卡片宽度 */}
          <div className="px-4 pt-3.5 pb-1">
            <textarea
              ref={composerRef}
              data-testid="collection-composer-input"
              value={value}
              onChange={(event) => onChangeValue(event.target.value)}
              onPaste={onPaste}
              onKeyDown={(event) => {
                // Enter 发送；Ctrl/Cmd+Enter 换行；IME 输入中不触发（中文输入法 Enter 是选词）
                if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
                if (event.ctrlKey || event.metaKey) {
                  // Ctrl/Cmd+Enter = 换行（浏览器默认不会在 textarea 里为 Ctrl+Enter 插入换行，这里手动插入）
                  event.preventDefault();
                  const textarea = event.currentTarget;
                  const start = textarea.selectionStart;
                  const end = textarea.selectionEnd;
                  const next = value.slice(0, start) + '\n' + value.slice(end);
                  onChangeValue(next);
                  // 光标移到换行后的位置
                  requestAnimationFrame(() => {
                    textarea.selectionStart = textarea.selectionEnd = start + 1;
                  });
                  return;
                }
                // 纯 Enter（含 Shift+Enter）= 发送
                event.preventDefault();
                if (value.trim().length > 0 && !sourceImporting) {
                  onSubmit();
                }
              }}
              placeholder={placeholder}
              rows={rows}
              className="max-h-36 min-h-[32px] w-full resize-none bg-transparent text-[15px] leading-[26px] text-ink caret-ink placeholder:text-ink-muted"
            />
            {sourceImporting ? (
              <p className="mt-1 text-[11px] text-ink-muted">
                {COPY.collection.filesReceived(activeSourceImportCount)}
              </p>
            ) : null}
            {!sourceImporting && sourceImportError ? (
              <p className="mt-1 text-[12px] text-danger-600">{compactText(sourceImportError, 40)}</p>
            ) : null}
          </div>

          {/* 下：按钮行 */}
          <div className="flex items-center justify-between px-3 pb-2.5 pt-1">
            {/* 左侧按钮组 */}
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                data-testid="collection-upload-button"
                onClick={(e) => { e.stopPropagation(); onUploadAll(); }}
                className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${
                  sourceImporting
                    ? 'text-pine bg-pine-mist'
                    : 'text-ink-muted hover:text-ink-secondary hover:bg-paper-warm'
                }`}
                aria-label={COPY.collection.uploadFiles}
              >
                <Plus size={20} strokeWidth={1.5} />
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onOpenLiveRecorder(); }}
                disabled={disableLiveRecorder}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted transition hover:text-pine hover:bg-pine-fog disabled:opacity-40"
                aria-label={COPY.collection.dictationLabel}
                title={COPY.collection.dictationTitle}
              >
                <Mic size={18} strokeWidth={1.5} />
              </button>
            </div>

            {/* 右侧发送 */}
            <button
              type="button"
              data-testid="collection-composer-submit"
              onClick={(e) => { e.stopPropagation(); onSubmit(); }}
              disabled={!composerHasText}
                className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${
                composerHasText
                  ? 'bg-pine text-white hover:bg-pine-deep'
                  : 'cursor-default bg-divider text-ink-muted'
              }`}
              aria-label={COPY.collection.sendToCollection}
            >
              <ArrowUp size={16} strokeWidth={2.5} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
