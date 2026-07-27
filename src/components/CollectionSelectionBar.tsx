'use client';

/**
 * CollectionSelectionBar — 多选操作栏
 *
 * 重构：移除 desktopShell / dockWidthClass，统一 CSS 响应式。
 * 设计系统：v7 设计宪法：95% 克制 + 5% 仪式时刻情绪化（shadow-soft / shadow-card / shadow-ai-glow）。
 */

import { FileText, History, MessageCircle, X } from 'lucide-react';
import { COPY } from '@/lib/ui/copy';

interface CollectionSelectionBarProps {
  selectedCount: number;
  confirmDelete: boolean;
  onAskTutor: () => void;
  onQuote: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onClear: () => void;
}

export function CollectionSelectionBar({
  selectedCount,
  confirmDelete,
  onAskTutor,
  onQuote,
  onArchive,
  onDelete,
  onClear,
}: CollectionSelectionBarProps) {
  return (
    <div className="relative z-20 flex-shrink-0 px-3 pb-2 pt-2 lg:px-6 lg:pb-2 lg:pt-3">
      <div className="mx-auto w-full max-w-3xl rounded-2xl border border-divider bg-card px-3.5 py-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center rounded-full bg-ink px-2.5 py-1 text-[12px] font-semibold text-white">
                {COPY.collection.selectionCount(selectedCount)}
              </span>
              <p className="text-[12px] font-medium text-ink">{COPY.collection.selectionHint}</p>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onAskTutor}
                className="inline-flex items-center gap-1.5 rounded-full bg-pine px-3.5 py-2.5 text-[11px] font-semibold text-white transition hover:bg-pine-deep"
              >
                <MessageCircle size={14} />
                <span>{COPY.collection.askClassmate}</span>
              </button>
              <button
                type="button"
                onClick={onQuote}
                className="inline-flex items-center gap-1.5 rounded-full border border-divider bg-card px-3.5 py-2.5 text-[11px] font-semibold text-ink transition hover:border-ink-muted/40 hover:bg-paper"
              >
                <FileText size={14} />
                <span>{COPY.collection.actionQuote}</span>
              </button>
              <button
                type="button"
                onClick={onArchive}
                className="inline-flex items-center gap-1.5 rounded-full border border-divider bg-pine-fog px-3 py-2.5 text-[11px] font-medium text-ink transition hover:bg-pine-mist"
              >
                <History size={14} />
                <span>{COPY.collection.actionArchive}</span>
              </button>
              <button
                type="button"
                onClick={onDelete}
                className={`rounded-full px-3 py-2.5 text-[11px] font-medium transition ${
                  confirmDelete
                    ? 'bg-vermilion text-white hover:bg-vermilion-deep'
                    : 'text-ink-muted hover:bg-vermilion-fog hover:text-vermilion-deep'
                }`}
              >
                {confirmDelete ? COPY.collection.actionConfirmDelete : COPY.collection.actionDelete}
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={onClear}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-divider bg-card text-ink-secondary transition hover:bg-paper hover:text-ink"
            aria-label={COPY.collection.exitSelection}
          >
            <X size={15} />
          </button>
        </div>
      </div>
      {confirmDelete ? (
        <p className="mx-auto mt-2 w-full max-w-3xl px-1 text-[11px] font-medium text-vermilion">
          {COPY.collection.selectionDeleteWarning}
        </p>
      ) : null}
    </div>
  );
}
