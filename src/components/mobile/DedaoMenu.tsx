'use client';

import React, { useEffect } from 'react';
import { cn } from '@/lib/utils';

export interface DedaoMenuProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (page: 'highlights' | 'summary' | 'notes' | 'tasks' | 'ai-chat') => void;
  badges?: {
    highlights?: number;
    notes?: number;
    tasks?: number;
  };
}

export function DedaoMenu({
  isOpen,
  onClose,
  onNavigate,
  badges = {},
}: DedaoMenuProps) {
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

  // ESC 关闭
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const menuItems = [
    {
      id: 'ai-chat' as const,
      label: 'AI 助教',
      description: '有问题随时问',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
        </svg>
      ),
      highlight: true,
    },
    {
      id: 'highlights' as const,
      label: '精选片段',
      description: 'AI 提取的重点',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
        </svg>
      ),
      badge: badges.highlights,
    },
    {
      id: 'summary' as const,
      label: '课堂摘要',
      description: '一分钟了解全课',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
      ),
    },
    {
      id: 'notes' as const,
      label: '我的笔记',
      description: '查看和管理笔记',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
        </svg>
      ),
      badge: badges.notes,
    },
    {
      id: 'tasks' as const,
      label: '今日任务',
      description: 'AI 推荐的复习任务',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      badge: badges.tasks,
    },
  ];

  return (
    <>
      {/* 遮罩层 */}
      <div
        className={cn(
          'fixed inset-0 bg-black/30 z-40 transition-opacity duration-300',
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
        onClick={onClose}
      />

      {/* 菜单面板 */}
      <div
        className={cn(
          'fixed top-0 right-0 bottom-0 w-64 z-50',
          'bg-white shadow-xl',
          'transform transition-transform duration-300 ease-out',
          isOpen ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        {/* 头部 */}
        <div className="px-4 py-4 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-[var(--dedao-text)]">更多功能</h2>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100"
            >
              <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* 菜单列表 */}
        <div className="py-2">
          {menuItems.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                onNavigate(item.id);
                onClose();
              }}
              className={cn(
                'w-full px-4 py-3 flex items-center gap-3',
                'text-left hover:bg-[var(--dedao-bg-warm)]',
                'transition-colors duration-150',
                'highlight' in item && item.highlight && 'bg-gradient-to-r from-amber-50 to-orange-50'
              )}
            >
              <span className={cn(
                'highlight' in item && item.highlight 
                  ? 'text-amber-500' 
                  : 'text-[var(--dedao-gold)]'
              )}>{item.icon}</span>
              <div className="flex-1 min-w-0">
                <span className={cn(
                  'block text-sm font-medium',
                  'highlight' in item && item.highlight 
                    ? 'text-amber-700' 
                    : 'text-[var(--dedao-text)]'
                )}>
                  {item.label}
                </span>
                {'description' in item && item.description && (
                  <span className="block text-xs text-gray-400 mt-0.5 truncate">
                    {item.description}
                  </span>
                )}
              </div>
              {'badge' in item && item.badge && item.badge > 0 && (
                <span className="px-2 py-0.5 text-xs font-medium bg-[var(--dedao-gold-light)] text-[var(--dedao-brown)] rounded-full">
                  {item.badge}
                </span>
              )}
              <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

// 汉堡菜单按钮（得到风格）
export function DedaoMenuButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-8 h-8 flex items-center justify-center rounded-full',
        'hover:bg-[var(--dedao-bg-warm)]',
        'transition-colors duration-150'
      )}
    >
      <svg 
        className="w-5 h-5 text-[var(--dedao-text)]" 
        fill="none" 
        viewBox="0 0 24 24" 
        stroke="currentColor" 
        strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    </button>
  );
}
