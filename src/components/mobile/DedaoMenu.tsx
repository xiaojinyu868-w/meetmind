'use client';

import React, { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/hooks/useAuth';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

export interface DedaoMenuProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (page: 'highlights' | 'summary' | 'notes' | 'tasks' | 'apps' | 'ai-chat') => void;
  showApps?: boolean;
  userRole?: 'student' | 'parent' | 'teacher';
  badges?: {
    highlights?: number;
    notes?: number;
    tasks?: number;
    apps?: number;
  };
}

export function DedaoMenu({
  isOpen,
  onClose,
  onNavigate,
  showApps = true,
  userRole = 'student',
  badges = {},
}: DedaoMenuProps) {
  const { user, isAuthenticated, logout } = useAuth();
  const router = useRouter();
  const [loadingRole, setLoadingRole] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [isPending, startTransition] = useTransition();

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

  const handleRoleChange = (href: string, role: string) => {
    if (userRole === role) return;
    setLoadingRole(role);
    startTransition(() => {
      router.push(href);
      onClose();
    });
  };

  const handleLogout = async () => {
    await logout();
    onClose();
  };

  const roleLabels: Record<string, string> = {
    student: '学生',
    parent: '家长',
    teacher: '教师',
    admin: '管理员',
  };

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
    ...(showApps
      ? [
          {
            id: 'apps' as const,
            label: 'AI工坊',
            description: '进入 AI 学习应用黄页',
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
        {/* 头部 - 用户信息或登录入口 */}
        <div className="px-4 py-4 border-b border-gray-100">
          <div className="flex items-center justify-between">
            {isAuthenticated && user ? (
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-lilac-200 to-lilac-300 rounded-full flex items-center justify-center overflow-hidden">
                  <Avatar className="w-full h-full">
                    {user.avatar ? (
                      <AvatarImage src={user.avatar} alt={user.nickname} className="object-cover" />
                    ) : null}
                    <AvatarFallback className="bg-transparent text-lg">
                      {user.role === 'parent' ? '👨‍👩‍👧' : user.role === 'teacher' ? '👨‍🏫' : '👤'}
                    </AvatarFallback>
                  </Avatar>
                </div>
                <div>
                  <p className="text-sm font-medium text-[var(--dedao-text)]">{user.nickname}</p>
                  <p className="text-xs text-gray-400">{roleLabels[user.role] || user.role}账号</p>
                </div>
              </div>
            ) : (
              <Link
                href="/login"
                onClick={onClose}
                className="flex items-center gap-3"
              >
                <div className="w-10 h-10 bg-gradient-to-br from-amber-100 to-amber-200 rounded-full flex items-center justify-center">
                  <span className="text-lg">👤</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-amber-600">点击登录</p>
                  <p className="text-xs text-gray-400">登录后数据云端同步</p>
                </div>
              </Link>
            )}
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

        {/* 角色切换 */}
        <div className="px-4 py-3 border-b border-gray-100">
          <p className="text-xs text-gray-400 mb-2">切换视角</p>
          <div className="flex items-center gap-2">
            {[
              { id: 'student', href: '/', label: '学生', icon: '👤' },
              { id: 'parent', href: '/parent', label: '家长', icon: '👨‍👩‍👧' },
              { id: 'teacher', href: '/teacher', label: '教师', icon: '👨‍🏫' },
            ].map((role) => (
              <button
                key={role.id}
                onClick={() => handleRoleChange(role.href, role.id)}
                disabled={loadingRole === role.id}
                className={cn(
                  'flex-1 px-3 py-2 rounded-lg text-sm flex items-center justify-center gap-1.5 transition-all',
                  userRole === role.id
                    ? 'bg-amber-50 text-amber-600 font-medium border border-amber-200'
                    : loadingRole === role.id
                      ? 'bg-gray-50 text-gray-400 cursor-wait'
                      : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                )}
              >
                {loadingRole === role.id ? (
                  <svg className="animate-spin h-3.5 w-3.5 text-amber-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                ) : (
                  <span className="text-xs">{role.icon}</span>
                )}
                <span>{role.label}</span>
              </button>
            ))}
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

        {/* 系统菜单 */}
        <div className="py-2 border-t border-gray-100 mt-auto">
          {isAuthenticated && user && (
            <Link
              href="/profile"
              onClick={onClose}
              className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-gray-50 transition-colors"
            >
              <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
              </svg>
              <span className="text-sm text-gray-600">个人资料</span>
            </Link>
          )}
          <Link
            href="/help"
            onClick={onClose}
            className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-gray-50 transition-colors"
          >
            <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
            </svg>
            <span className="text-sm text-gray-600">帮助中心</span>
          </Link>
          <Link
            href="/feedback"
            onClick={onClose}
            className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-gray-50 transition-colors"
          >
            <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
            </svg>
            <span className="text-sm text-gray-600">意见反馈</span>
          </Link>
          {isAuthenticated && user && (
            <button
              onClick={handleLogout}
              className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-coral-50 transition-colors"
            >
              <svg className="w-5 h-5 text-coral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
              </svg>
              <span className="text-sm text-coral-600">退出登录</span>
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
  'data-onboarding': dataOnboarding 
}: { 
  onClick: () => void;
  'data-onboarding'?: string;
}) {
  return (
    <button
      onClick={onClick}
      data-onboarding={dataOnboarding}
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
