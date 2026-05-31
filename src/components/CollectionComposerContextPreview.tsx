'use client';

import { ChevronRight, Link2, X } from 'lucide-react';

interface CollectionComposerContextPreviewProps {
  quotedCount: number;
  quotedPrimaryTypeLabel?: string;
  quotedSummaryText?: string;
  onClearQuoted: () => void;
  linkPreviewLabel?: string;
  autoImportLink: boolean;
}

export function CollectionComposerContextPreview({
  quotedCount,
  quotedPrimaryTypeLabel,
  quotedSummaryText,
  onClearQuoted,
  linkPreviewLabel,
  autoImportLink,
}: CollectionComposerContextPreviewProps) {
  const hasQuotedContext = quotedCount > 0;
  const hasLinkPreview = Boolean(linkPreviewLabel);

  if (!hasQuotedContext && !hasLinkPreview) {
    return null;
  }

  return (
    <>
      {hasQuotedContext ? (
        <div className="mb-2 flex items-center gap-2 rounded-xl bg-[#FAF7F2] px-3 py-2.5 text-[12px]">
          <ChevronRight size={12} className="flex-shrink-0 text-[#8E8B82]" />
          <span className="min-w-0 flex-1 truncate text-[#5C5A55]">
            {quotedCount > 1
              ? `已引用 ${quotedCount} 条内容`
              : quotedPrimaryTypeLabel === '录音'
                ? '已引用一段录音'
                : `已引用${quotedPrimaryTypeLabel || '内容'}`}
            {quotedSummaryText ? `：${quotedSummaryText}` : ''}
          </span>
          <button
            type="button"
            onClick={onClearQuoted}
            className="flex-shrink-0 rounded-lg p-0.5 text-[#8E8B82] transition hover:text-[#5C5A55] hover:bg-[#E8E2D5]"
            aria-label="取消引用"
          >
            <X size={13} />
          </button>
        </div>
      ) : null}
      {hasLinkPreview ? (
        <div className="mb-2 flex items-center gap-2 rounded-xl border border-divider bg-canvas px-3 py-2.5 text-[12px]">
          <Link2 size={12} className="flex-shrink-0 text-ink-muted" />
          <span className="min-w-0 flex-1 truncate text-[#5C5A55]">
            {linkPreviewLabel} 链接{autoImportLink ? ' · 发送后自动解析' : ''}
          </span>
        </div>
      ) : null}
    </>
  );
}
