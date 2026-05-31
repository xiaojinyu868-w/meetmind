'use client';

/**
 * ActionDrawer 行动清单抽屉组件
 * 
 * 从右侧滑入的抽屉面板，显示完整的行动清单：
 * - 半透明遮罩背景
 * - 300ms ease-out 过渡动画（尊重 prefers-reduced-motion）
 * - ESC 键和点击遮罩关闭
 * - 可访问性：role="dialog"、aria-modal、aria-labelledby
 */

import { useEffect, useId } from 'react';
import { cn } from '@/lib/utils';
import { ActionList } from './ActionList';
import type { ActionItem } from '@/types';

export interface ActionDrawerProps {
  /** 是否打开 */
  isOpen: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 行动项列表 */
  items: ActionItem[];
  /** 完成回调 */
  onComplete: (id: string) => void;
  /** 开始下一个任务 */
  onStartNext?: () => void;
  /** 自定义类名 */
  className?: string;
}

export function ActionDrawer({
  isOpen,
  onClose,
  items,
  onComplete,
  onStartNext,
  className,
}: ActionDrawerProps) {
  const titleId = useId();
  
  // ESC 键关闭
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // 禁止背景滚动
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  return (
    <>
      {/* 遮罩层 */}
      <div
        className={cn(
          'fixed inset-0 bg-black/20 z-40',
          // 动画：尊重 prefers-reduced-motion
          'transition-opacity duration-300 motion-reduce:transition-none',
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* 抽屉面板 */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="action-drawer"
        className={cn(
          'fixed top-0 right-0 bottom-0 w-80 z-50',
          'bg-white shadow-2xl',
          // 动画：尊重 prefers-reduced-motion
          'transform transition-transform duration-300 ease-out motion-reduce:transition-none',
          'flex flex-col',
          isOpen ? 'translate-x-0' : 'translate-x-full',
          className
        )}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-divider-light bg-white">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-mint rounded-lg flex items-center justify-center shadow-sm">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h2 id={titleId} className="text-sm font-semibold text-navy">今晚行动清单</h2>
              <p className="text-xs text-ink-muted">
                {items.filter(i => i.completed).length}/{items.length} 已完成
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="关闭行动清单"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-ink-muted hover:text-navy hover:bg-lilac-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint focus-visible:ring-offset-2"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <ActionList
            items={items}
            onComplete={onComplete}
            onStartNext={onStartNext}
          />
        </div>

        {/* 底部提示 */}
        <div className="px-4 py-3 border-t border-divider-light bg-surface-soft">
          <p className="text-xs text-ink-muted text-center">
            💡 按 ESC 或点击空白处关闭
          </p>
        </div>
      </div>
    </>
  );
}
