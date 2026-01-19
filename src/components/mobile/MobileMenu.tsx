'use client';

import React from 'react';
import { cn } from '@/lib/utils';

export interface MobileMenuProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (page: 'highlights' | 'summary' | 'notes' | 'tasks') => void;
  badges?: {
    highlights?: number;
    notes?: number;
    tasks?: number;
  };
  className?: string;
}

interface MenuItem {
  id: 'highlights' | 'summary' | 'notes' | 'tasks';
  label: string;
  icon: React.ReactNode;
  description: string;
}

const menuItems: MenuItem[] = [
  {
    id: 'highlights',
    label: '精选内容',
    description: '重要知识点回顾',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
      </svg>
    ),
  },
  {
    id: 'summary',
    label: '课堂摘要',
    description: 'AI 生成的课程总结',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
  {
    id: 'notes',
    label: '我的笔记',
    description: '课堂中记录的笔记',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
      </svg>
    ),
  },
  {
    id: 'tasks',
    label: '今晚任务',
    description: '复习和练习清单',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
    ),
  },
];

export function MobileMenu({
  isOpen,
  onClose,
  onNavigate,
  badges = {},
  className,
}: MobileMenuProps) {
  if (!isOpen) return null;

  const handleItemClick = (id: MenuItem['id']) => {
    onNavigate(id);
    onClose();
  };

  return (
    <>
      {/* 遮罩层 */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 animate-fadeIn"
        onClick={onClose}
      />

      {/* 菜单面板 */}
      <div
        className={cn(
          "fixed top-0 right-0 bottom-0 z-50",
          "w-72 bg-slate-900",
          "animate-slideInRight",
          "flex flex-col",
          className
        )}
      >
        {/* 头部 */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <h2 className="text-lg font-medium text-white">更多功能</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-slate-400 hover:text-white transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 菜单列表 */}
        <div className="flex-1 overflow-y-auto py-2">
          {menuItems.map((item) => {
            const badge = badges[item.id as keyof typeof badges];
            
            return (
              <button
                key={item.id}
                onClick={() => handleItemClick(item.id)}
                className={cn(
                  "w-full px-5 py-4 flex items-center gap-4",
                  "text-left transition-colors",
                  "hover:bg-slate-800/50 active:bg-slate-800"
                )}
              >
                {/* 图标 */}
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500/20 to-amber-400/20 flex items-center justify-center text-amber-400">
                  {item.icon}
                </div>

                {/* 文字 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white">{item.label}</span>
                    {badge && badge > 0 && (
                      <span className="px-1.5 py-0.5 text-xs rounded-full bg-amber-500/20 text-amber-300">
                        {badge}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">{item.description}</p>
                </div>

                {/* 箭头 */}
                <svg className="w-4 h-4 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            );
          })}
        </div>

        {/* 底部信息 */}
        <div className="px-5 py-4 border-t border-slate-800">
          <p className="text-xs text-slate-600 text-center">
            MeetMind · 让学习更高效
          </p>
        </div>
      </div>

      <style jsx>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        .animate-fadeIn {
          animation: fadeIn 0.2s ease-out;
        }
        .animate-slideInRight {
          animation: slideInRight 0.25s ease-out;
        }
      `}</style>
    </>
  );
}

// 汉堡菜单按钮
export function HamburgerMenuButton({
  onClick,
  className,
}: {
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-10 h-10 rounded-full flex items-center justify-center",
        "bg-slate-800/80 text-slate-300 hover:text-white",
        "transition-colors",
        className
      )}
      aria-label="打开菜单"
    >
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    </button>
  );
}

export default MobileMenu;
