/**
 * ChatMessageList —— 消息流容器。
 *
 * 职责：
 *   - 维护滚动容器 + 自动跟随（useAutoFollowScroll）
 *   - 渲染 emptyState（无消息时）
 *   - 渲染 jump-to-latest 浮起按钮
 *   - 提供 max-w 居中的"内容栏"
 *
 * 不做的事：
 *   - 不知道 messages 是什么形态（caller 用 children 渲染）
 *   - 不做虚拟滚动（V2 加，先做 React.memo + smoothStream）
 *
 * 两个 variant：
 *   - 'paper'：默认（白底）
 *   - 'glass'：透明（沉浸式背景从外部透过来）
 */

'use client';

import * as React from 'react';
import { ArrowDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAutoFollowScroll } from './hooks/useAutoFollowScroll';

export interface ChatMessageListProps {
  /** 监听变化触发自动滚动；通常传 messages.length 或最新消息 id+text 长度 */
  watchKey: unknown;
  /** 空状态（messages 为 0 时渲染） */
  emptyState?: React.ReactNode;
  /** 是否显示空状态（caller 决定，默认根据 watchKey === 0 自动判断不可靠 → 显式） */
  showEmpty?: boolean;
  /** 内容栏最大宽度（默认 max-w-2xl） */
  contentMaxWidth?: string;
  variant?: 'paper' | 'glass';
  /** 内容（用 caller 自己 map messages 渲染） */
  children: React.ReactNode;
  /** 父容器额外类名 */
  className?: string;
  /** 内容栏额外类名（max-w 居中那层） */
  innerClassName?: string;
  /** 是否禁用自动跟随（设置页那种静态预览场景） */
  disableAutoFollow?: boolean;
}

export function ChatMessageList({
  watchKey,
  emptyState,
  showEmpty,
  contentMaxWidth = 'max-w-2xl',
  variant = 'paper',
  children,
  className,
  innerClassName,
  disableAutoFollow,
}: ChatMessageListProps) {
  const { scrollRef, shouldShowJumpToLatest, followNow } = useAutoFollowScroll({
    watchKey: disableAutoFollow ? 0 : watchKey,
  });

  return (
    <div
      ref={scrollRef}
      className={cn(
        'relative flex-1 overflow-y-auto',
        variant === 'paper' && 'bg-card',
        variant === 'glass' && 'bg-transparent',
        className,
      )}
      role="log"
      aria-live="polite"
      aria-relevant="additions text"
    >
      <div
        className={cn(
          'mx-auto flex w-full flex-col gap-5 px-4 py-6 sm:px-6',
          contentMaxWidth,
          innerClassName,
        )}
      >
        {showEmpty ? emptyState : children}
      </div>

      {/* "回到最新"浮起按钮 */}
      {!disableAutoFollow && shouldShowJumpToLatest ? (
        <button
          type="button"
          onClick={followNow}
          className={cn(
            'sticky bottom-4 left-1/2 z-10 -translate-x-1/2',
            'inline-flex h-9 items-center gap-1.5 rounded-full px-4',
            'text-[12.5px] font-medium shadow-card transition-all',
            variant === 'glass'
              ? 'bg-white/85 text-ink backdrop-blur-md hover:bg-white'
              : 'bg-ink text-white hover:bg-pine',
          )}
          aria-label="回到最新消息"
        >
          <ArrowDown size={13} strokeWidth={2} />
          回到最新
        </button>
      ) : null}
    </div>
  );
}
