/**
 * ChatBubble —— 单条消息壳。
 *
 * 三个 slot：
 *   - avatar：左侧头像（assistant 用 Octo，user 通常不传）
 *   - children：消息体（一般是 ChatRenderer，也可以是任意内容）
 *   - actions：消息底部操作行（复制/重生成/反馈）—— 默认 hover 才显示
 *   - footer：底部追加内容（例如内联 IntentSummaryCard / InlineAppCard）
 *
 * 三种风格 variant：
 *   - 'paper'（默认）：v7 米白纸感、克制风（用于复习态、设置页）
 *   - 'glass'：半透明 + backdrop-blur（用于 IntentDialog 沉浸式背景上）
 *   - 'minimal'：无背景无边框（用于浮窗 WordExplainer / 移动端纯文字态）
 *
 * 用户消息 vs AI 消息：
 *   - 用户：右对齐 + 实心深色气泡
 *   - AI：左对齐 + paper/glass 半透明
 */

'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export type ChatBubbleRole = 'user' | 'assistant' | 'system';
export type ChatBubbleVariant = 'paper' | 'glass' | 'minimal';

export interface ChatBubbleProps {
  role: ChatBubbleRole;
  variant?: ChatBubbleVariant;
  /** assistant 的左侧头像 */
  avatar?: React.ReactNode;
  /** 消息底部操作行（hover 显示） */
  actions?: React.ReactNode;
  /** 底部 slot（永远显示，例如 SummaryCard） */
  footer?: React.ReactNode;
  /** 消息体 */
  children: React.ReactNode;
  /** assistant 消息可允许气泡占满（用于内联应用卡场景） */
  fullWidth?: boolean;
  /** M12：消息 ID —— 加到消息体 DOM 的 data-msg-id，让 copyMessageSmart 能取 innerHTML 复制富文本 */
  messageId?: string;
  className?: string;
}

const ROLE_ALIGN: Record<ChatBubbleRole, string> = {
  user: 'justify-end',
  assistant: 'justify-start',
  system: 'justify-center',
};

function bubbleClasses(role: ChatBubbleRole, variant: ChatBubbleVariant): string {
  if (role === 'user') {
    // 用户气泡：墨黑实心，右下角小圆角
    return cn(
      'rounded-2xl rounded-br-md',
      'px-4 py-2.5 text-[15px] leading-[1.7] whitespace-pre-wrap break-words',
      // glass：在沉浸式深色背景上，用 white/12 半透明 + 白字（不要 bg-ink，会糊在背景里）
      variant === 'glass'
        ? 'bg-white/12 border border-white/20 backdrop-blur-md text-white shadow-[0_2px_12px_rgba(0,0,0,0.35)]'
        : 'bg-ink text-white',
    );
  }
  // assistant
  if (variant === 'glass') {
    // bug 修复：原来 bg-white/82 + text-ink 在深色背景下气泡 + 文字都偏深，用户看不见。
    // 顶级 immersive 产品（Apple Intelligence / Linear AI）的做法是：assistant 用接近实白的卡片
    // 让深色文字稳定可读，"glass 感"靠 backdrop-blur + 极轻透明度 + 阴影实现，
    // 而不是把背景做透。
    return cn(
      'rounded-2xl rounded-bl-md',
      'bg-white/95 backdrop-blur-xl',
      'border border-white/40',
      'shadow-[0_4px_24px_rgba(0,0,0,0.25)]',
      'px-4 py-3 text-[15px] leading-[1.75] text-ink',
    );
  }
  if (variant === 'minimal') {
    return cn(
      'text-[14.5px] leading-[1.75] text-ink',
      'whitespace-pre-wrap break-words',
    );
  }
  // paper（默认）
  return cn(
    'rounded-2xl rounded-bl-md',
    'border border-divider bg-canvas',
    'px-4 py-2.5 text-[14.5px] leading-[1.75] text-ink',
    'break-words',
  );
}

export const ChatBubble = React.memo(function ChatBubble({
  role,
  variant = 'paper',
  avatar,
  actions,
  footer,
  children,
  fullWidth,
  messageId,
  className,
}: ChatBubbleProps) {
  const isUser = role === 'user';
  return (
    <div className={cn('group/chat-bubble flex w-full', ROLE_ALIGN[role], className)}>
      {/* 左侧 avatar（仅 assistant + 非 minimal 显示） */}
      {!isUser && avatar && variant !== 'minimal' ? (
        <div className="mr-2.5 mt-0.5 shrink-0">{avatar}</div>
      ) : null}
      <div
        className={cn(
          'flex flex-col',
          fullWidth ? 'w-full max-w-full' : 'max-w-[88%]',
          isUser ? 'items-end' : 'items-start',
        )}
      >
        <div className={bubbleClasses(role, variant)} data-msg-id={messageId}>{children}</div>
        {/* hover 时浮起来的操作行 */}
        {actions ? (
          <div
            className={cn(
              'mt-1 flex items-center gap-1 px-1',
              'opacity-0 transition-opacity duration-150 group-hover/chat-bubble:opacity-100',
              'focus-within:opacity-100',
            )}
            aria-hidden={false}
          >
            {actions}
          </div>
        ) : null}
        {footer ? <div className={cn('mt-2', fullWidth ? 'w-full' : 'min-w-[280px]')}>{footer}</div> : null}
      </div>
    </div>
  );
});

ChatBubble.displayName = 'ChatBubble';

// ─────────────────────────────────────────────────────────
// 通用消息操作按钮（消费者可自由组合）
// ─────────────────────────────────────────────────────────

export interface ChatBubbleActionButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
}

export function ChatBubbleActionButton({ icon, label, onClick, active }: ChatBubbleActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        'inline-flex h-7 items-center gap-1 rounded-full px-2 text-[11.5px]',
        'text-ink-muted transition-colors',
        'hover:bg-paper-warm hover:text-ink-secondary',
        active && 'bg-pine/10 text-pine',
      )}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
