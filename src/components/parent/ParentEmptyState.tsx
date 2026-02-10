'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

interface ParentEmptyStateProps {
  type: 'no-data' | 'no-confusions' | 'all-resolved';
  studentName?: string;
  className?: string;
}

export function ParentEmptyState({
  type,
  studentName,
  className,
}: ParentEmptyStateProps) {
  const t = useTranslations('parent.emptyState');
  const name = studentName || '孩子';
  
  const config = {
    'no-data': {
      emoji: t('noData.emoji'),
      title: t('noData.title'),
      description: t('noData.description', { studentName: name }),
      bgClass: 'from-gray-50 to-slate-50',
    },
    'no-confusions': {
      emoji: t('noConfusion.emoji'),
      title: t('noConfusion.title'),
      description: t('noConfusion.description', { studentName: name }),
      bgClass: 'from-emerald-50 to-green-50',
    },
    'all-resolved': {
      emoji: t('allResolved.emoji'),
      title: t('allResolved.title'),
      description: t('allResolved.description', { studentName: name }),
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
          <span>{t('noData.hint')}</span>
        </div>
      )}
    </div>
  );
}
