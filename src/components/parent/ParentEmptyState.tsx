'use client';

import { cn } from '@/lib/utils';

interface ParentEmptyStateProps {
  type: 'no-data' | 'no-confusions' | 'all-resolved';
  studentName?: string;
  className?: string;
}

export function ParentEmptyState({
  type,
  studentName = '孩子',
  className,
}: ParentEmptyStateProps) {
  const config = {
    'no-data': {
      emoji: '📚',
      title: '今天还没有学习记录',
      description: `等${studentName}上课后，学习情况会自动同步到这里`,
      bgClass: 'from-gray-50 to-slate-50',
    },
    'no-confusions': {
      emoji: '🎉',
      title: '太棒了！',
      description: `${studentName}今天上课没有标记困惑点，状态很好`,
      bgClass: 'from-emerald-50 to-green-50',
    },
    'all-resolved': {
      emoji: '✨',
      title: '所有困惑都解决了！',
      description: `给${studentName}点个赞，继续加油`,
      bgClass: 'from-amber-50 to-yellow-50',
    },
  };
  
  const { emoji, title, description, bgClass } = config[type];
  
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center py-16 px-8',
        'rounded-3xl',
        `bg-gradient-to-br ${bgClass}`,
        'text-center',
        className
      )}
    >
      {/* 表情 */}
      <div className="text-6xl mb-4 animate-bounce-slow">
        {emoji}
      </div>
      
      {/* 标题 */}
      <h3 className="text-xl font-semibold text-gray-800 mb-2">
        {title}
      </h3>
      
      {/* 描述 */}
      <p className="text-sm text-gray-500 max-w-xs">
        {description}
      </p>
      
      {/* 额外提示 */}
      {type === 'no-data' && (
        <div className="mt-6 flex items-center gap-2 text-xs text-gray-400">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>数据每节课后自动更新</span>
        </div>
      )}
    </div>
  );
}
