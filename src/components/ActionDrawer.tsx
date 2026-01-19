'use client';

/**
 * ActionDrawer 行动清单抽屉组件
 * 
 * 从右侧滑入的抽屉面板，显示完整的行动清单：
 * - 半透明遮罩背景
 * - 300ms ease-out 过渡动画
 * - ESC 键和点击遮罩关闭
 */

import { useEffect } from 'react';
import { cn } from '@/lib/utils';
import { ActionList } from './ActionList';
import type { ActionItem } from '@/lib/services/meetmind-service';

export interface ActionDrawerProps {
  /** 是否打开 */
  isOpen: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 行动项列表 */
  items: ActionItem[];
  /** 完成回调 */
  onComplete: (id: string) => void;
  /** 自定义类名 */
  className?: string;
}

export function ActionDrawer({
  isOpen,
  onClose,
  items,
  onComplete,
  className,
}: ActionDrawerProps) {
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
          'fixed inset-0 bg-black/20 backdrop-blur-sm z-40 transition-opacity duration-300',
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
        onClick={onClose}
      />

      {/* 抽屉面板 */}
      <div
        className={cn(
          'fixed top-0 right-0 bottom-0 w-80 z-50',
          'bg-white shadow-2xl',
          'transform transition-transform duration-300 ease-out',
          'flex flex-col',
          isOpen ? 'translate-x-0' : 'translate-x-full',
          className
        )}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gradient-to-r from-surface-soft to-white">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-mint to-mint-600 rounded-lg flex items-center justify-center shadow-sm">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-navy">今晚行动清单</h2>
              <p className="text-xs text-gray-500">
                {items.filter(i => i.completed).length}/{items.length} 已完成
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-navy hover:bg-lilac-100 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <ActionList
            items={items}
            onComplete={onComplete}
          />
        </div>

        {/* 底部提示 */}
        <div className="px-4 py-3 border-t border-gray-100 bg-surface-soft">
          <p className="text-xs text-gray-400 text-center">
            💡 按 ESC 或点击空白处关闭
          </p>
        </div>
      </div>
    </>
  );
}
