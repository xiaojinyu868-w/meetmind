'use client';

import Link from 'next/link';
import { useState } from 'react';

interface HeaderProps {
  lessonTitle: string;
  courseName: string;
  userRole?: 'student' | 'parent' | 'teacher';
}

export function Header({ lessonTitle, courseName, userRole = 'student' }: HeaderProps) {
  const [showUserMenu, setShowUserMenu] = useState(false);

  return (
    <header className="h-16 glass border-b border-white/20 flex items-center justify-between px-6 flex-shrink-0 no-print">
      <div className="flex items-center gap-5">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="w-9 h-9 bg-gradient-to-br from-rose-400 to-rose-500 rounded-xl flex items-center justify-center shadow-md group-hover:shadow-lg group-hover:scale-105 transition-all">
            <span className="text-white font-bold text-lg">M</span>
          </div>
          <span className="font-semibold text-gray-900 text-lg">MeetMind</span>
        </Link>

        {/* 分隔线 */}
        <div className="w-px h-6 bg-gray-200" />

        {/* 当前课程 */}
        <div className="flex items-center gap-2">
          <span className="px-2.5 py-1 bg-rose-100 text-rose-700 rounded-lg text-xs font-medium">
            {courseName}
          </span>
          <h1 className="text-sm font-medium text-gray-700">{lessonTitle}</h1>
        </div>
      </div>

      {/* 右侧 */}
      <div className="flex items-center gap-4">
        {/* 角色切换 */}
        <nav className="flex items-center gap-1 p-1 bg-gray-100/80 rounded-xl">
          <RoleTab href="/" label="学生" icon="👤" active={userRole === 'student'} />
          <RoleTab href="/parent" label="家长" icon="👨‍👩‍👧" active={userRole === 'parent'} />
          <RoleTab href="/teacher" label="教师" icon="👨‍🏫" active={userRole === 'teacher'} />
        </nav>

        {/* 用户头像 */}
        <div className="relative">
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="w-9 h-9 bg-gradient-to-br from-gray-100 to-gray-200 rounded-full flex items-center justify-center hover:from-gray-200 hover:to-gray-300 transition-all"
          >
            <span className="text-base">
              {userRole === 'parent' ? '👨‍👩‍👧' : userRole === 'teacher' ? '👨‍🏫' : '👤'}
            </span>
          </button>
          
          {showUserMenu && (
            <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-xl shadow-lg border border-gray-100 py-2 animate-scale-in z-50">
              <div className="px-4 py-2 border-b border-gray-100">
                <p className="text-sm font-medium text-gray-900">张小明</p>
                <p className="text-xs text-gray-500">学生账号</p>
              </div>
              <button className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 transition-colors">
                设置
              </button>
              <button className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 transition-colors">
                帮助
              </button>
              <button className="w-full px-4 py-2 text-left text-sm text-rose-600 hover:bg-rose-50 transition-colors">
                退出登录
              </button>
            </div>
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
          ? 'bg-white text-gray-900 shadow-sm font-medium'
          : 'text-gray-500 hover:text-gray-700 hover:bg-white/50'
      }`}
    >
      <span className="text-xs">{icon}</span>
      <span className="hide-mobile">{label}</span>
    </Link>
  );
}
