'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { ConfusionMoment } from '@/lib/services/parent-service';

interface ConfusionTimelineProps {
  confusions: ConfusionMoment[];
  onPlayAudio?: (confusion: ConfusionMoment) => void;
  onMarkResolved?: (confusionId: string) => void;
  className?: string;
}

// 学科颜色映射
const subjectColors: Record<string, { bg: string; text: string; border: string }> = {
  '数学': { bg: 'bg-blue-50', text: 'text-blue-600', border: 'border-blue-200' },
  '英语': { bg: 'bg-purple-50', text: 'text-purple-600', border: 'border-purple-200' },
  '语文': { bg: 'bg-amber-50', text: 'text-amber-600', border: 'border-amber-200' },
  '物理': { bg: 'bg-cyan-50', text: 'text-cyan-600', border: 'border-cyan-200' },
  '化学': { bg: 'bg-pink-50', text: 'text-pink-600', border: 'border-pink-200' },
  '生物': { bg: 'bg-green-50', text: 'text-green-600', border: 'border-green-200' },
  '课程': { bg: 'bg-gray-50', text: 'text-gray-600', border: 'border-gray-200' },
};

function getSubjectColor(subject: string) {
  return subjectColors[subject] || subjectColors['课程'];
}

export function ConfusionTimeline({
  confusions,
  onPlayAudio,
  onMarkResolved,
  className,
}: ConfusionTimelineProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  
  // 分离未解决和已解决
  const unresolvedConfusions = confusions.filter(c => !c.resolved);
  const resolvedConfusions = confusions.filter(c => c.resolved);
  
  if (confusions.length === 0) {
    return null;
  }
  
  return (
    <div className={cn('space-y-3', className)}>
      {/* 未解决的困惑点（优先显示） */}
      {unresolvedConfusions.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-gray-500 px-1 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            待解决 ({unresolvedConfusions.length})
          </h3>
          {unresolvedConfusions.map((confusion) => (
            <ConfusionCard
              key={confusion.id}
              confusion={confusion}
              isExpanded={expandedId === confusion.id}
              onToggle={() => setExpandedId(expandedId === confusion.id ? null : confusion.id)}
              onPlayAudio={() => onPlayAudio?.(confusion)}
              onMarkResolved={() => onMarkResolved?.(confusion.id)}
            />
          ))}
        </div>
      )}
      
      {/* 已解决的困惑点 */}
      {resolvedConfusions.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-gray-400 px-1 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            已解决 ({resolvedConfusions.length})
          </h3>
          {resolvedConfusions.map((confusion) => (
            <ConfusionCard
              key={confusion.id}
              confusion={confusion}
              isExpanded={expandedId === confusion.id}
              onToggle={() => setExpandedId(expandedId === confusion.id ? null : confusion.id)}
              onPlayAudio={() => onPlayAudio?.(confusion)}
              isResolved
            />
          ))}
        </div>
      )}
    </div>
  );
}

// 单个困惑卡片
interface ConfusionCardProps {
  confusion: ConfusionMoment;
  isExpanded: boolean;
  isResolved?: boolean;
  onToggle: () => void;
  onPlayAudio: () => void;
  onMarkResolved?: () => void;
}

function ConfusionCard({
  confusion,
  isExpanded,
  isResolved = false,
  onToggle,
  onPlayAudio,
  onMarkResolved,
}: ConfusionCardProps) {
  const colors = getSubjectColor(confusion.subject);
  
  return (
    <div
      className={cn(
        'rounded-2xl border transition-all duration-200',
        isResolved
          ? 'bg-gray-50/50 border-gray-100 opacity-70'
          : `${colors.bg} ${colors.border}`,
        isExpanded && 'shadow-md'
      )}
    >
      {/* 卡片主体 - 点击展开 */}
      <button
        onClick={onToggle}
        className="w-full p-4 text-left"
      >
        <div className="flex items-start justify-between gap-3">
          {/* 左侧：时间 + 内容 */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              {/* 时间 */}
              <span className="text-xs font-mono text-gray-400">
                {confusion.timeDisplay}
              </span>
              {/* 学科标签 */}
              <span className={cn(
                'px-2 py-0.5 rounded-full text-xs font-medium',
                colors.bg, colors.text
              )}>
                {confusion.subject}
              </span>
              {/* 解决状态 */}
              {isResolved && (
                <span className="text-emerald-500">✓</span>
              )}
            </div>
            {/* 知识点 */}
            <p className={cn(
              'font-medium truncate',
              isResolved ? 'text-gray-500' : 'text-gray-800'
            )}>
              {confusion.knowledgePoint}
            </p>
          </div>
          
          {/* 右侧：展开箭头 */}
          <svg
            className={cn(
              'w-5 h-5 text-gray-400 transition-transform duration-200 flex-shrink-0',
              isExpanded && 'rotate-180'
            )}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>
      
      {/* 展开内容 */}
      {isExpanded && (
        <div className="px-4 pb-4 space-y-3 animate-fade-in">
          {/* 转录上下文 */}
          {confusion.transcriptContext && (
            <div className="p-3 bg-white/60 rounded-xl">
              <p className="text-sm text-gray-600 leading-relaxed">
                "{confusion.transcriptContext}"
              </p>
            </div>
          )}
          
          {/* 操作按钮 */}
          <div className="flex items-center gap-2">
            {/* 播放老师原话 */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onPlayAudio();
              }}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-xl',
                'bg-gradient-to-r from-amber-400 to-orange-400',
                'text-white text-sm font-medium',
                'hover:from-amber-500 hover:to-orange-500',
                'transition-all duration-200',
                'shadow-sm hover:shadow-md active:scale-[0.98]'
              )}
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
              听老师原话
            </button>
            
            {/* 标记已解决（仅未解决时显示） */}
            {!isResolved && onMarkResolved && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onMarkResolved();
                }}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-xl',
                  'bg-white border border-emerald-200',
                  'text-emerald-600 text-sm font-medium',
                  'hover:bg-emerald-50',
                  'transition-all duration-200',
                  'active:scale-[0.98]'
                )}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                已在家解决
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
