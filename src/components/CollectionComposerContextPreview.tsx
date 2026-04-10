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
        <div className="mb-2 flex items-center gap-2 rounded-xl bg-[#F7F7F5] px-3 py-2.5 text-[12px]">
          <ChevronRight size={12} className="flex-shrink-0 text-[#A3A39E]" />
          <span className="min-w-0 flex-1 truncate text-[#787774]">
            {quotedCount > 1
              ? `已引用 ${quotedCount} 条内容`
              : quotedPrimaryTypeLabel === '原声'
                ? '已引用一段原声'
                : `已引用${quotedPrimaryTypeLabel || '内容'}`}
            {quotedSummaryText ? `：${quotedSummaryText}` : ''}
          </span>
          <button
            type="button"
            onClick={onClearQuoted}
            className="flex-shrink-0 rounded-lg p-0.5 text-[#A3A39E] transition hover:text-[#787774] hover:bg-[#E9E9E7]"
            aria-label="取消引用"
          >
            <X size={13} />
          </button>
        </div>
      ) : null}
      {hasLinkPreview ? (
        <div className="mb-2 flex items-center gap-2 rounded-xl bg-[#D3E4F4]/20 px-3 py-2.5 text-[12px]">
          <Link2 size={12} className="flex-shrink-0 text-[#5B8DBF]" />
          <span className="min-w-0 flex-1 truncate text-[#787774]">
            {linkPreviewLabel} 链接{autoImportLink ? ' · 发送后自动解析' : ''}
          </span>
        </div>
      ) : null}
    </>
  );
}
