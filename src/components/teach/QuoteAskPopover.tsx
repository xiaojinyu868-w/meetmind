'use client';

/**
 * QuoteAskPopover — 画布划线后的「引用提问」浮钮。
 *
 * 交互复用 WordExplainer 的未展开态：选区 rect 附近浮一个深色小按钮，
 * 点击把引用文本交给 caller（进输入框引用块），并清掉选区。
 * data-word-explainer 属性和 useTextSelection 的 click-outside 豁免约定
 * 同源——点按钮本身不会把选区弹掉。
 */

import { COPY } from '@/lib/ui/copy';
import type { TextSelectionInfo } from '@/hooks/useTextSelection';

interface QuoteAskPopoverProps {
  selection: TextSelectionInfo;
  onQuote: (text: string) => void;
  onDismiss: () => void;
}

export function QuoteAskPopover({ selection, onQuote, onDismiss }: QuoteAskPopoverProps) {
  const viewportW = typeof window === 'undefined' ? 1200 : window.innerWidth;
  const bubbleW = 110;
  let left = selection.rect.left + selection.rect.width / 2 - bubbleW / 2;
  if (left < 8) left = 8;
  if (left + bubbleW > viewportW - 8) left = viewportW - 8 - bubbleW;
  let top = selection.rect.top - 40;
  if (top < 8) top = selection.rect.bottom + 8;

  return (
    <div data-word-explainer className="fixed z-[60] animate-fade-in" style={{ left, top }}>
      <button
        type="button"
        onClick={() => {
          onQuote(selection.text);
          window.getSelection()?.removeAllRanges();
          onDismiss();
        }}
        className="flex items-center gap-1.5 rounded-full bg-[#1C1B19] px-3 py-1.5 text-sm font-medium text-white shadow-soft transition-all hover:scale-105 active:scale-95"
      >
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h8M8 14h5m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        {COPY.apps.teach.quoteAsk}
      </button>
    </div>
  );
}
