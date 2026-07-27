'use client';

import { ChevronRight, Link2, X } from 'lucide-react';
import { COPY } from '@/lib/ui/copy';

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
        <div className="mb-2 flex items-center gap-2 rounded-xl bg-paper px-3 py-2.5 text-[12px]">
          <ChevronRight size={12} className="flex-shrink-0 text-ink-muted" />
          <span className="min-w-0 flex-1 truncate text-ink-secondary">
            {quotedCount > 1
              ? COPY.collection.quotedMulti(quotedCount)
              : quotedPrimaryTypeLabel === '录音'
                ? COPY.collection.quotedAudio
                : COPY.collection.quotedSingle(quotedPrimaryTypeLabel || '')}
            {quotedSummaryText ? `：${quotedSummaryText}` : ''}
          </span>
          <button
            type="button"
            onClick={onClearQuoted}
            className="flex-shrink-0 rounded-lg p-0.5 text-ink-muted transition hover:text-ink-secondary hover:bg-paper-deep"
            aria-label={COPY.collection.clearQuote}
          >
            <X size={13} />
          </button>
        </div>
      ) : null}
      {hasLinkPreview ? (
        <div className="mb-2 flex items-center gap-2 rounded-xl border border-divider bg-paper px-3 py-2.5 text-[12px]">
          <Link2 size={12} className="flex-shrink-0 text-ink-muted" />
          <span className="min-w-0 flex-1 truncate text-ink-secondary">
            {linkPreviewLabel} 链接{autoImportLink ? ` · ${COPY.collection.quotedAutoImport}` : ''}
          </span>
        </div>
      ) : null}
    </>
  );
}
