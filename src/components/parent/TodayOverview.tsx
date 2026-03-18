'use client';

import { cn } from '@/lib/utils';

interface TodayOverviewProps {
  totalClasses: number;
  totalConfusions: number;
  resolvedCount: number;
  onStatClick?: (type: 'classes' | 'confusions' | 'resolved') => void;
  className?: string;
}

export function TodayOverview({
  totalClasses,
  totalConfusions,
  resolvedCount,
  onStatClick,
  className,
}: TodayOverviewProps) {
  const unresolvedCount = totalConfusions - resolvedCount;
  
  return (
    <div className={cn('grid grid-cols-3 gap-3', className)}>
      {/* 上课节数 */}
      <button
        onClick={() => onStatClick?.('classes')}
        className={cn(
          'flex flex-col items-center p-4 rounded-2xl',
          'bg-[#D3E4F4]/30',
          'border border-blue-100/50',
          'transition-all duration-200',
          'hover:hover:scale-[1.02] active:scale-[0.98]'
        )}
      >
        <span className="text-3xl font-bold text-sky-600">
          {totalClasses}
        </span>
        <span className="text-xs text-sky-600/70 mt-1">节课</span>
      </button>
      
      {/* 困惑点数 */}
      <button
        onClick={() => onStatClick?.('confusions')}
        className={cn(
          'flex flex-col items-center p-4 rounded-2xl',
          'bg-[#FDF3C0]/30',
          'border border-[#E9E9E7]/50',
          'transition-all duration-200',
          'hover:hover:scale-[1.02] active:scale-[0.98]',
          unresolvedCount > 0 && 'ring-2 ring-[#E9E9E7] ring-offset-1'
        )}
      >
        <span className="text-3xl font-bold text-[#787774]">
          {totalConfusions}
        </span>
        <span className="text-xs text-[#787774]/70 mt-1">
          {unresolvedCount > 0 ? `${unresolvedCount} 待解决` : '个困惑'}
        </span>
      </button>
      
      {/* 已解决数 */}
      <button
        onClick={() => onStatClick?.('resolved')}
        className={cn(
          'flex flex-col items-center p-4 rounded-2xl',
          'bg-[#D1F4E0]/30',
          'border border-[#D1F4E0]/50',
          'transition-all duration-200',
          'hover:hover:scale-[1.02] active:scale-[0.98]'
        )}
      >
        <span className="text-3xl font-bold text-[#232322]">
          {resolvedCount}
        </span>
        <span className="text-xs text-[#232322]/70 mt-1">已解决</span>
      </button>
    </div>
  );
}
