'use client';

import { cn } from '@/lib/utils';

interface AISummaryCardProps {
  summary: string;
  isLoading?: boolean;
  className?: string;
}

export function AISummaryCard({
  summary,
  isLoading = false,
  className,
}: AISummaryCardProps) {
  return (
    <div
      className={cn(
        'p-4 rounded-2xl',
        'bg-gradient-to-r from-amber-50 via-orange-50 to-yellow-50',
        'border border-amber-100/50',
        className
      )}
    >
      <div className="flex items-start gap-3">
        {/* AI 图标 */}
        <div className={cn(
          'w-8 h-8 rounded-xl flex-shrink-0',
          'bg-gradient-to-br from-amber-400 to-orange-500',
          'flex items-center justify-center',
          'shadow-sm'
        )}>
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
        </div>
        
        {/* 总结内容 */}
        <div className="flex-1 min-w-0">
          <p className="text-xs text-amber-600/70 mb-1 font-medium">
            AI 总结
          </p>
          {isLoading ? (
            <div className="flex items-center gap-2">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
              <span className="text-sm text-gray-400">正在分析...</span>
            </div>
          ) : (
            <p className="text-sm text-gray-700 leading-relaxed">
              {summary}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
