/**
 * ChatThinkingStrip —— "AI 在场"等待态。
 *
 * 三态：
 *   - 'thinking'（默认）：用 v7 ThinkingStrip 流光横扫（pine 极淡渐变），适合等待首 token。
 *   - 'tool'：附加文案"翻看课堂转录…"等，用于工具调用阶段。
 *   - 'writing'：流式开始后切到这态（理论上消费者不会传，因为有字符就直接展示）。
 *
 * 视觉风格：
 *   - 'paper'：克制米白纸感（默认，复习态）
 *   - 'glass'：半透明 + 模糊（沉浸式 IntentDialog）
 */

'use client';

import * as React from 'react';
import { ThinkingStrip } from '@/components/ui/thinking-strip';
import { cn } from '@/lib/utils';

export type ChatThinkingState = 'thinking' | 'tool' | 'writing';

export interface ChatThinkingStripProps {
  state?: ChatThinkingState;
  /** 状态文字（"同学在想…" / "翻看课堂转录…"） */
  label?: React.ReactNode;
  variant?: 'paper' | 'glass';
  /** 左侧头像（OctoAvatar 等） */
  avatar?: React.ReactNode;
  className?: string;
}

export function ChatThinkingStripBubble({
  state = 'thinking',
  label,
  variant = 'paper',
  avatar,
  className,
}: ChatThinkingStripProps) {
  const wrapper =
    variant === 'glass'
      ? 'rounded-2xl rounded-bl-md bg-white/95 backdrop-blur-xl border border-white/40 shadow-[0_4px_24px_rgba(0,0,0,0.25)] px-4 py-3'
      : 'rounded-2xl rounded-bl-md border border-divider bg-canvas px-4 py-3';
  return (
    <div className={cn('flex w-full justify-start', className)}>
      {avatar ? <div className="mr-2.5 mt-0.5 shrink-0">{avatar}</div> : null}
      <div className={cn('flex max-w-[88%] items-start gap-2.5', wrapper)}>
        <ThinkingStrip>
          <span className="font-serif italic text-pine/85">
            {label ?? (state === 'tool' ? '翻看材料…' : '同学在想…')}
          </span>
        </ThinkingStrip>
      </div>
    </div>
  );
}
