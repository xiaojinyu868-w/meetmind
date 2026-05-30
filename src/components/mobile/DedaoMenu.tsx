'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/hooks/useAuth';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

export interface DedaoMenuProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * 'ai-call' = 语音同桌（手机端 P2 §30：从二级提到一级菜单）
   */
  onNavigate: (page: 'tasks' | 'apps' | 'ai-chat' | 'ai-call') => void;
  showApps?: boolean;
  badges?: {
    tasks?: number;
    apps?: number;
  };
}

export function DedaoMenu({
  isOpen,
  onClose,
  onNavigate,
  showApps = true,
  badges = {},
}: DedaoMenuProps) {
  const { user, isAuthenticated, logout } = useAuth();

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

  const handleLogout = async () => {
    await logout();
    onClose();
  };

  const roleLabels: Record<string, string> = {
    student: '学生',
    admin: '管理员',
  };

  const menuItems = [
    {
      id: 'ai-chat' as const,
      label: '学习同桌',
      description: '把这节课讲清楚',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
        </svg>
      ),
      highlight: true,
    },
    {
      // 手机端 P2 §30：语音同桌从 AI Chat 二级页面提到一级菜单，
      // 让"打电话问"成为和"打字问"并列的入口
      id: 'ai-call' as const,
      label: '语音同桌',
      description: '直接说话，像打电话问老师',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
        </svg>
      ),
    },
    ...(showApps
      ? [
          {
            id: 'apps' as const,
            label: '学习应用',
            description: '导图、测验、闪卡都在这里',
            icon: (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75A2.25 2.25 0 016 4.5h3a2.25 2.25 0 012.25 2.25v3A2.25 2.25 0 019 12H6a2.25 2.25 0 01-2.25-2.25v-3zM12.75 6.75A2.25 2.25 0 0115 4.5h3a2.25 2.25 0 012.25 2.25v3A2.25 2.25 0 0118 12h-3a2.25 2.25 0 01-2.25-2.25v-3zM3.75 15A2.25 2.25 0 016 12.75h3A2.25 2.25 0 0111.25 15v3A2.25 2.25 0 019 20.25H6A2.25 2.25 0 013.75 18v-3zM12.75 15A2.25 2.25 0 0115 12.75h3A2.25 2.25 0 0120.25 15v3A2.25 2.25 0 0118 20.25h-3A2.25 2.25 0 0112.75 18v-3z" />
              </svg>
            ),
            badge: badges.apps,
          },
        ]
      : []),
    {
      id: 'tasks' as const,
      label: '今日任务',
      description: '今天适合先复习这些',
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
          'bg-white',
          'transform transition-transform duration-300 ease-out',
          isOpen ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        {/* 头部 - 用户信息或登录入口 */}
        <div className="border-b border-divider px-4 py-4">
          <div className="flex items-center justify-between">
            {isAuthenticated && user ? (
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-canvas">
                  <Avatar className="h-full w-full">
                    {user.avatar ? (
                      <AvatarImage src={user.avatar} alt={user.nickname} className="object-cover" />
                    ) : null}
                    <AvatarFallback className="bg-transparent text-sm font-medium text-ink-muted">
                      我
                    </AvatarFallback>
                  </Avatar>
                </div>
                <div>
                  <p className="text-sm font-medium text-ink">{user.nickname}</p>
                  <p className="text-xs text-ink-muted">{roleLabels[user.role] || user.role}账号</p>
                </div>
              </div>
            ) : (
              <Link
                href="/login"
                onClick={onClose}
                className="flex items-center gap-3"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-sand">
                  <span className="text-sm font-medium text-ink">我</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-ink-secondary">点击登录</p>
                  <p className="text-xs text-ink-muted">登录后数据云端同步</p>
                </div>
              </Link>
            )}
            <button
              onClick={onClose}
              className="mm-touch-target flex items-center justify-center rounded-full text-ink-muted transition-colors active:bg-divider-light active:text-ink-secondary"
              aria-label="关闭菜单"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
                'highlight' in item && item.highlight && 'bg-[#FDF3C0]/50'
              )}
            >
              <span className={cn(
                'highlight' in item && item.highlight 
                  ? 'text-[#787774]' 
                  : 'text-[var(--dedao-gold)]'
              )}>{item.icon}</span>
              <div className="flex-1 min-w-0">
                <span className={cn(
                  'block text-sm font-medium',
                  'highlight' in item && item.highlight 
                    ? 'text-[#232322]' 
                    : 'text-[var(--dedao-text)]'
                )}>
                  {item.label}
                </span>
                {'description' in item && item.description && (
                  <span className="mt-1 block truncate text-[12px] text-ink-muted">
                    {item.description}
                  </span>
                )}
              </div>
              {'badge' in item && item.badge && item.badge > 0 && (
                <span className="px-2 py-0.5 text-xs font-medium bg-[var(--dedao-gold-light)] text-[var(--dedao-brown)] rounded-full">
                  {item.badge}
                </span>
              )}
              <svg className="h-4 w-4 shrink-0 text-ink-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          ))}
        </div>

        {/* 系统菜单 */}
        <div className="mt-auto border-t border-divider py-2">
          <Link
            href="/settings"
            onClick={onClose}
            className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-canvas"
          >
            <svg className="h-5 w-5 text-ink-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12a7.5 7.5 0 1115 0 7.5 7.5 0 01-15 0zm7.5-4.125v8.25m4.125-4.125h-8.25" />
            </svg>
            <span className="text-sm text-ink-secondary">设置</span>
          </Link>
          <Link
            href="/help"
            onClick={onClose}
            className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-canvas"
          >
            <svg className="h-5 w-5 text-ink-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
            </svg>
            <span className="text-sm text-ink-secondary">帮助中心</span>
          </Link>
          <Link
            href="/feedback"
            onClick={onClose}
            className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-canvas"
          >
            <svg className="h-5 w-5 text-ink-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
            </svg>
            <span className="text-sm text-ink-secondary">意见反馈</span>
          </Link>
          {isAuthenticated && user && (
            <button
              onClick={handleLogout}
              className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-[#FADEC9]/30 transition-colors"
            >
              <svg className="w-5 h-5 text-[#787774]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
              </svg>
              <span className="text-sm text-[#787774]">退出登录</span>
            </button>
          )}
        </div>
      </div>
    </>
  );
}

// 汉堡菜单按钮（得到风格）
export function DedaoMenuButton({ 
  onClick, 
}: { 
  onClick: () => void;
}) {
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
