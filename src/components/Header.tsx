'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';

interface HeaderProps {
  lessonTitle: string;
  courseName: string;
  userRole?: 'student' | 'parent' | 'teacher';
}

export function Header({ lessonTitle, courseName, userRole = 'student' }: HeaderProps) {
  const [showUserMenu, setShowUserMenu] = useState(false);
  const { user, isAuthenticated, logout } = useAuth();

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
        {/* 角色切换 */}
        <nav className="flex items-center gap-1 p-1 rounded-xl" style={{ background: 'var(--edu-bg-soft)' }}>
          <RoleTab href="/" label="学生" icon="👤" active={userRole === 'student'} />
          <RoleTab href="/parent" label="家长" icon="👨‍👩‍👧" active={userRole === 'parent'} />
          <RoleTab href="/teacher" label="教师" icon="👨‍🏫" active={userRole === 'teacher'} />
        </nav>

        {/* 用户头像/登录按钮 */}
        <div className="relative">
          {isAuthenticated && user ? (
            <>
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="w-9 h-9 bg-gradient-to-br from-lilac-200 to-lilac-300 rounded-full flex items-center justify-center hover:from-lilac-300 hover:to-lilac-400 transition-all overflow-hidden"
              >
                {user.avatar ? (
                  <img src={user.avatar} alt={user.nickname} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-base">
                    {user.role === 'parent' ? '👨‍👩‍👧' : user.role === 'teacher' ? '👨‍🏫' : '👤'}
                  </span>
                )}
              </button>
              
              {showUserMenu && (
                <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-xl shadow-lg border border-gray-100 py-2 animate-scale-in z-50">
                  <div className="px-4 py-2 border-b border-gray-100">
                    <p className="text-sm font-medium text-navy">{user.nickname}</p>
                    <p className="text-xs text-gray-500">{roleLabels[user.role] || user.role}账号</p>
                  </div>
                  <Link
                    href="/profile"
                    onClick={() => setShowUserMenu(false)}
                    className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-lilac-50 transition-colors"
                  >
                    个人资料
                  </Link>
                  <button className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-lilac-50 transition-colors">
                    设置
                  </button>
                  <Link
                    href="/help"
                    onClick={() => setShowUserMenu(false)}
                    className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-lilac-50 transition-colors"
                  >
                    帮助
                  </Link>
                  <Link
                    href="/feedback"
                    onClick={() => setShowUserMenu(false)}
                    className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-lilac-50 transition-colors"
                  >
                    意见反馈
                  </Link>
                  <button
                    onClick={handleLogout}
                    className="w-full px-4 py-2 text-left text-sm text-coral-600 hover:bg-coral-50 transition-colors"
                  >
                    退出登录
                  </button>
                </div>
              )}
            </>
          ) : (
            <Link
              href="/login"
              className="px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-amber-400 to-amber-500 rounded-lg hover:from-amber-500 hover:to-amber-600 transition-all shadow-md"
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
  href, 
  label, 
  icon, 
  active 
}: { 
  href: string; 
  label: string; 
  icon: string; 
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5 transition-all ${
        active
          ? 'bg-white text-amber-600 shadow-sm font-medium'
          : 'text-gray-500 hover:text-navy hover:bg-white/50'
      }`}
    >
      <span className="text-xs">{icon}</span>
      <span className="hide-mobile">{label}</span>
    </Link>
  );
}
