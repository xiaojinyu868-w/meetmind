'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  GraduationCap,
  User,
  Users,
  School,
  UserCircle,
  Settings,
  HelpCircle,
  MessageSquare,
  LogOut,
  Mic,
  BookOpen,
} from 'lucide-react';

const ICON_SM = 16;
const ICON_STROKE = 1.75;

interface HeaderProps {
  lessonTitle: string;
  courseName: string;
  userRole?: 'student' | 'parent' | 'teacher';
  viewMode?: 'record' | 'review';
}

export function Header({ lessonTitle, courseName, userRole = 'student', viewMode = 'record' }: HeaderProps) {
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [loadingRole, setLoadingRole] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const { user, isAuthenticated, logout } = useAuth();

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
    student: '学生',
    parent: '家长',
    teacher: '教师',
    admin: '管理员',
  };

  return (
    <header className="h-16 bg-white border-b flex items-center justify-between px-6 flex-shrink-0 no-print" style={{ borderColor: 'var(--edu-border-light)' }}>
      <div className="flex items-center gap-5 min-w-0">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 group flex-shrink-0">
          <div className="w-9 h-9 bg-[#FDF3C0] rounded-xl flex items-center justify-center group-hover:group-hover:scale-105 transition-all">
            <GraduationCap size={20} strokeWidth={2} className="text-white" />
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
          <div className="flex items-center gap-1.5 min-w-0">
            {viewMode === 'record' ? (
              <Mic size={ICON_SM} strokeWidth={ICON_STROKE} className="text-[#787774] flex-shrink-0" />
            ) : (
              <BookOpen size={ICON_SM} strokeWidth={ICON_STROKE} className="text-[#787774] flex-shrink-0" />
            )}
            <h1 className="text-sm font-medium text-navy truncate min-w-0">{lessonTitle}</h1>
          </div>
        </div>
      </div>

      {/* 右侧 */}
      <div className="flex items-center gap-4">
        {/* 角色切换 */}
        <nav className="flex items-center gap-1 p-1 rounded-xl" style={{ background: 'var(--edu-bg-soft)' }}>
          <RoleTab 
            label="学生" 
            icon={<User size={14} strokeWidth={ICON_STROKE} />} 
            active={userRole === 'student'} 
            loading={loadingRole === 'student'}
            onClick={() => handleRoleChange('/', 'student')}
            onHover={() => handleRoleHover('/')}
          />
          <RoleTab 
            label="家长" 
            icon={<Users size={14} strokeWidth={ICON_STROKE} />} 
            active={userRole === 'parent'}
            loading={loadingRole === 'parent'}
            onClick={() => handleRoleChange('/parent', 'parent')}
            onHover={() => handleRoleHover('/parent')}
          />
          <RoleTab 
            label="教师" 
            icon={<School size={14} strokeWidth={ICON_STROKE} />} 
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
                className="w-9 h-9 bg-lilac-200 rounded-full flex items-center justify-center hover:from-lilac-300 hover:to-lilac-400 transition-all overflow-hidden"
              >
                <Avatar className="w-full h-full">
                  {user.avatar ? (
                    <AvatarImage src={user.avatar} alt={user.nickname} className="object-cover" />
                  ) : null}
                  <AvatarFallback className="bg-transparent text-base">
                    <User size={18} strokeWidth={ICON_STROKE} className="text-lilac-600" />
                  </AvatarFallback>
                </Avatar>
              </button>
              
              {showUserMenu && (
                <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-xl border border-gray-100 py-2 animate-scale-in z-50">
                  <div className="px-4 py-2 border-b border-gray-100">
                    <p className="text-sm font-medium text-navy">{user.nickname}</p>
                    <p className="text-xs text-gray-500">{roleLabels[user.role] || user.role}账号</p>
                  </div>
                  <Link
                    href="/profile"
                    onClick={() => setShowUserMenu(false)}
                    className="flex items-center gap-2.5 w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-lilac-50 transition-colors"
                  >
                    <UserCircle size={ICON_SM} strokeWidth={ICON_STROKE} className="text-gray-400" />
                    个人资料
                  </Link>
                  <Link
                    href="/settings"
                    onClick={() => setShowUserMenu(false)}
                    className="flex items-center gap-2.5 w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-lilac-50 transition-colors"
                  >
                    <Settings size={ICON_SM} strokeWidth={ICON_STROKE} className="text-gray-400" />
                    设置
                  </Link>
                  <Link
                    href="/help"
                    onClick={() => setShowUserMenu(false)}
                    className="flex items-center gap-2.5 w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-lilac-50 transition-colors"
                  >
                    <HelpCircle size={ICON_SM} strokeWidth={ICON_STROKE} className="text-gray-400" />
                    帮助
                  </Link>
                  <Link
                    href="/feedback"
                    onClick={() => setShowUserMenu(false)}
                    className="flex items-center gap-2.5 w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-lilac-50 transition-colors"
                  >
                    <MessageSquare size={ICON_SM} strokeWidth={ICON_STROKE} className="text-gray-400" />
                    意见反馈
                  </Link>
                  <button
                    onClick={handleLogout}
                    className="flex items-center gap-2.5 w-full px-4 py-2 text-left text-sm text-coral-600 hover:bg-coral-50 transition-colors"
                  >
                    <LogOut size={ICON_SM} strokeWidth={ICON_STROKE} />
                    退出登录
                  </button>
                </div>
              )}
            </>
          ) : (
            <Link
              href="/login"
              className="px-4 py-2 text-sm font-medium text-white bg-[#FDF3C0] rounded-lg hover:from-[#FDF3C0] hover:to-[#FDECC8] transition-all"
            >
              登录
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
  icon: React.ReactNode; 
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
          ? 'bg-white text-[#787774] shadow-sm font-medium'
          : loading
            ? 'text-gray-400 cursor-wait bg-white/50'
            : 'text-gray-500 hover:text-navy hover:bg-white/50'
      }`}
    >
      {loading ? (
        <svg className="animate-spin h-3.5 w-3.5 text-[#787774]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      ) : (
        <span className="flex items-center">{icon}</span>
      )}
      <span className="hide-mobile">{label}</span>
    </button>
  );
}
