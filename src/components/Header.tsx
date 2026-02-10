'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/hooks/useAuth';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { LanguageSwitcher } from './LanguageSwitcher';

interface HeaderProps {
  lessonTitle: string;
  courseName: string;
  userRole?: 'student' | 'parent' | 'teacher';
}

export function Header({ lessonTitle, courseName, userRole = 'student' }: HeaderProps) {
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [loadingRole, setLoadingRole] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const { user, isAuthenticated, logout } = useAuth();
  const t = useTranslations();

  // 预加载角色切换的目标页面，提升跳转速度
  // bundle-preload: Preload on hover/focus for perceived speed
  useEffect(() => {
    router.prefetch('/');
    router.prefetch('/parent');
    router.prefetch('/teacher');
  }, [router]);

  // 悬停预加载数据（提前触发数据请求）
  const handleRoleHover = useCallback((href: string) => {
    // 预热目标页面的数据请求
    if (href === '/parent') {
      // 预取家长端数据
      fetch('/api/parent/today-status', { 
        method: 'GET',
        credentials: 'include',
      }).catch(() => {});
    } else if (href === '/teacher') {
      // 预取教师端数据
      fetch('/api/teacher/dashboard', { 
        method: 'GET',
        credentials: 'include',
      }).catch(() => {});
    }
  }, []);

  const handleRoleChange = (href: string, role: string) => {
    if (userRole === role) return; // 已经是当前角色
    setLoadingRole(role);
    startTransition(() => {
      router.push(href);
    });
  };

  // 清除 loading 状态（导航完成后）
  useEffect(() => {
    if (!isPending && loadingRole) {
      // 延迟清除，确保过渡动画完成
      const timer = setTimeout(() => {
        setLoadingRole(null);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isPending, loadingRole]);

  const handleLogout = async () => {
    await logout();
    setShowUserMenu(false);
  };

  const roleLabels: Record<string, string> = {
    student: t('nav.student'),
    parent: t('nav.parent'),
    teacher: t('nav.teacher'),
    admin: t('nav.admin'),
  };

  return (
    <header className="h-16 bg-white border-b flex items-center justify-between px-6 flex-shrink-0 no-print" style={{ borderColor: 'var(--edu-border-light)' }}>
      <div className="flex items-center gap-5 min-w-0">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 group flex-shrink-0">
          <div className="w-9 h-9 bg-gradient-to-br from-amber-400 to-amber-500 rounded-xl flex items-center justify-center shadow-md group-hover:shadow-lg group-hover:scale-105 transition-all">
            <span className="text-white font-bold text-lg">M</span>
          </div>
          <span className="font-semibold text-navy text-lg whitespace-nowrap">MeetMind</span>
        </Link>

        {/* 分隔线 */}
        <div className="w-px h-6 bg-gray-200 flex-shrink-0 hidden sm:block" />

        {/* 当前课程 */}
        <div className="flex items-center gap-2 min-w-0 hidden sm:flex">
          <span className="px-2.5 py-1 bg-sunflower-100 text-sunflower-800 rounded-lg text-xs font-medium whitespace-nowrap flex-shrink-0">
            {courseName}
          </span>
          <h1 className="text-sm font-medium text-navy truncate min-w-0">{lessonTitle}</h1>
        </div>
      </div>

      {/* 右侧 */}
      <div className="flex items-center gap-4">
        {/* 语言切换 */}
        <LanguageSwitcher />
        
        {/* 角色切换 */}
        <nav className="flex items-center gap-1 p-1 rounded-xl" style={{ background: 'var(--edu-bg-soft)' }}>
          <RoleTab 
            label={t('nav.student') || '学生'}
            icon="👤" 
            active={userRole === 'student'} 
            loading={loadingRole === 'student'}
            onClick={() => handleRoleChange('/', 'student')}
            onHover={() => handleRoleHover('/')}
          />
          <RoleTab 
            label={t('nav.parent') || '家长'}
            icon="👨‍👩‍👧" 
            active={userRole === 'parent'}
            loading={loadingRole === 'parent'}
            onClick={() => handleRoleChange('/parent', 'parent')}
            onHover={() => handleRoleHover('/parent')}
          />
          <RoleTab 
            label={t('nav.teacher') || '教师'}
            icon="👨‍🏫" 
            active={userRole === 'teacher'}
            loading={loadingRole === 'teacher'}
            onClick={() => handleRoleChange('/teacher', 'teacher')}
            onHover={() => handleRoleHover('/teacher')}
          />
        </nav>

        {/* 用户头像/登录按钮 */}
        <div className="relative">
          {isAuthenticated && user ? (
            <>
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="w-9 h-9 bg-gradient-to-br from-lilac-200 to-lilac-300 rounded-full flex items-center justify-center hover:from-lilac-300 hover:to-lilac-400 transition-all overflow-hidden"
              >
                <Avatar className="w-full h-full">
                  {user.avatar ? (
                    <AvatarImage src={user.avatar} alt={user.nickname} className="object-cover" />
                  ) : null}
                  <AvatarFallback className="bg-transparent text-base">
                    {user.role === 'parent' ? '👨‍👩‍👧' : user.role === 'teacher' ? '👨‍🏫' : '👤'}
                  </AvatarFallback>
                </Avatar>
              </button>
              
              {showUserMenu && (
                <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-xl shadow-lg border border-gray-100 py-2 animate-scale-in z-50">
                  <div className="px-4 py-2 border-b border-gray-100">
                    <p className="text-sm font-medium text-navy">{user.nickname}</p>
                    <p className="text-xs text-gray-500">{roleLabels[user.role] || user.role}</p>
                  </div>
                  <Link
                    href="/profile"
                    onClick={() => setShowUserMenu(false)}
                    className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-lilac-50 transition-colors"
                  >
                    {t('settings.profile')}
                  </Link>
                  <Link
                    href="/settings"
                    onClick={() => setShowUserMenu(false)}
                    className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-lilac-50 transition-colors"
                  >
                    {t('settings.title')}
                  </Link>
                  <Link
                    href="/help"
                    onClick={() => setShowUserMenu(false)}
                    className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-lilac-50 transition-colors"
                  >
                    {t('settings.help')}
                  </Link>
                  <Link
                    href="/feedback"
                    onClick={() => setShowUserMenu(false)}
                    className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-lilac-50 transition-colors"
                  >
                    {t('settings.feedback')}
                  </Link>
                  <button
                    onClick={handleLogout}
                    className="w-full px-4 py-2 text-left text-sm text-coral-600 hover:bg-coral-50 transition-colors"
                  >
                    {t('nav.logout')}
                  </button>
                </div>
              )}
            </>
          ) : (
            <Link
              href="/login"
              className="px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-amber-400 to-amber-500 rounded-lg hover:from-amber-500 hover:to-amber-600 transition-all shadow-md"
            >
              {t('nav.login')}
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

function RoleTab({ 
  label, 
  icon, 
  active,
  loading,
  onClick,
  onHover,
}: { 
  label: string; 
  icon: string; 
  active: boolean;
  loading?: boolean;
  onClick?: () => void;
  onHover?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      onMouseEnter={onHover}
      onFocus={onHover}
      disabled={loading}
      className={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5 transition-all duration-200 ${
        active
          ? 'bg-white text-amber-600 shadow-sm font-medium'
          : loading
            ? 'text-gray-400 cursor-wait bg-white/50'
            : 'text-gray-500 hover:text-navy hover:bg-white/50'
      }`}
    >
      {loading ? (
        <svg className="animate-spin h-3.5 w-3.5 text-amber-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      ) : (
        <span className="text-xs">{icon}</span>
      )}
      <span className="hide-mobile">{label}</span>
    </button>
  );
}
