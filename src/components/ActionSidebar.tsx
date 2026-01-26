'use client';

/**
 * ActionSidebar 侧边图标条组件
 * 
 * 右侧紧凑的图标条，显示：
 * - 行动清单入口（带 badge）
 * - 历史对话入口
 * - 录音历史入口
 * 设计参考移动端菜单，保持一致性
 */

import { cn } from '@/lib/utils';

export interface ActionSidebarProps {
  /** 未完成任务数 */
  actionCount: number;
  /** 总任务数 */
  totalCount?: number;
  /** 抽屉是否打开 */
  isDrawerOpen: boolean;
  /** 切换抽屉 */
  onToggleDrawer: () => void;
  /** 显示对话历史 */
  onShowHistory?: () => void;
  /** 对话历史是否激活 */
  isHistoryActive?: boolean;
  /** 显示录音历史 */
  onShowSessionHistory?: () => void;
  /** 录音历史是否激活 */
  isSessionHistoryActive?: boolean;
  /** 自定义类名 */
  className?: string;
}

export function ActionSidebar({
  actionCount,
  isDrawerOpen,
  onToggleDrawer,
  onShowHistory,
  isHistoryActive = false,
  onShowSessionHistory,
  isSessionHistoryActive = false,
  className,
}: ActionSidebarProps) {
  return (
    <div
      className={cn(
        'w-12 flex-shrink-0 bg-white/90 backdrop-blur-sm border-l border-gray-100',
        'flex flex-col items-center py-3 gap-2',
        className
      )}
    >
      {/* 行动清单按钮 */}
      <button
        onClick={onToggleDrawer}
        className={cn(
          'relative w-9 h-9 flex items-center justify-center rounded-lg transition-all',
          isDrawerOpen
            ? 'bg-amber-100 text-amber-600'
            : 'text-gray-500 hover:bg-amber-50 hover:text-amber-600'
        )}
        title="今日任务"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        
        {/* Badge */}
        {actionCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 flex items-center justify-center bg-coral text-white text-[10px] font-medium rounded-full">
            {actionCount > 9 ? '9+' : actionCount}
          </span>
        )}
      </button>

      {/* 录音历史按钮 */}
      {onShowSessionHistory && (
        <button
          onClick={onShowSessionHistory}
          className={cn(
            'w-9 h-9 flex items-center justify-center rounded-lg transition-all',
            isSessionHistoryActive
              ? 'bg-amber-100 text-amber-600'
              : 'text-gray-500 hover:bg-amber-50 hover:text-amber-600'
          )}
          title="录音历史"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
        </button>
      )}

      {/* 对话历史按钮 */}
      {onShowHistory && (
        <button
          onClick={onShowHistory}
          className={cn(
            'w-9 h-9 flex items-center justify-center rounded-lg transition-all',
            isHistoryActive
              ? 'bg-amber-100 text-amber-600'
              : 'text-gray-500 hover:bg-amber-50 hover:text-amber-600'
          )}
          title="对话历史"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>
      )}
    </div>
  );
}
