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
        <div className="mb-1.5 flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-[12px]">
          <ChevronRight size={12} className="flex-shrink-0 text-slate-400" />
          <span className="min-w-0 flex-1 truncate text-slate-500">
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
            className="flex-shrink-0 text-slate-300 hover:text-slate-500"
            aria-label="取消引用"
          >
            <X size={14} />
          </button>
        </div>
      ) : null}
      {hasLinkPreview ? (
        <div className="mb-1.5 flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-[12px]">
          <Link2 size={12} className="flex-shrink-0 text-indigo-400" />
          <span className="min-w-0 flex-1 truncate text-slate-500">
            {linkPreviewLabel} 链接{autoImportLink ? ' · 发送后自动解析' : ''}
          </span>
        </div>
      ) : null}
    </>
  );
}
