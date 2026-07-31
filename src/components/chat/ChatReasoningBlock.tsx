/**
 * ChatReasoningBlock — 思维链的安静呈现。
 *
 * 设计原则（信任感来自"可见但克制"）：
 *   - 流式中自动展开：用户看到同学正在怎么想，等待不焦虑
 *   - 完成后默认收起：一条细线 + 「思考过程」，点开才看全文
 *   - 不喧宾夺主：小字、淡色、左侧一根 pine 细线，正文永远是主角
 */

'use client';

import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { COPY } from '@/lib/ui/copy';

export interface ChatReasoningBlockProps {
  reasoning: string;
  /** 流式中自动展开 */
  isStreaming?: boolean;
  className?: string;
}

export function ChatReasoningBlock({ reasoning, isStreaming, className }: ChatReasoningBlockProps) {
  const [open, setOpen] = React.useState(Boolean(isStreaming));
  React.useEffect(() => {
    if (isStreaming) setOpen(true);
  }, [isStreaming]);

  if (!reasoning.trim()) return null;

  return (
    <div className={cn('mb-2.5', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-[11px] font-medium text-ink-muted/80 transition-colors hover:text-ink-muted"
        aria-expanded={open}
      >
        <ChevronDown
          size={13}
          className={cn('transition-transform duration-200', open ? 'rotate-0' : '-rotate-90')}
        />
        {isStreaming ? COPY.globalAsk.reasoningStreaming : COPY.globalAsk.reasoningTitle}
      </button>
      {open ? (
        <div className="mt-1.5 border-l-2 border-pine/20 pl-3 text-[12.5px] leading-[1.75] text-ink-muted/90 whitespace-pre-wrap">
          {reasoning}
          {isStreaming ? <span className="ml-0.5 inline-block h-3 w-[2px] animate-pulse bg-pine/60 align-middle" /> : null}
        </div>
      ) : null}
    </div>
  );
}
