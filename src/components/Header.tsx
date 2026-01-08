'use client';

import Link from 'next/link';

interface HeaderProps {
  lessonTitle: string;
  courseName: string;
  userRole?: 'student' | 'parent' | 'teacher';
}

export function Header({ lessonTitle, courseName, userRole = 'student' }: HeaderProps) {
  return (
    <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-4 flex-shrink-0">
      <div className="flex items-center gap-4">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <div className="w-8 h-8 bg-gradient-to-br from-primary-500 to-primary-600 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">M</span>
          </div>
          <span className="font-semibold text-gray-900">MeetMind</span>
        </Link>

        {/* 分隔线 */}
        <div className="w-px h-6 bg-gray-200" />

        {/* 当前课程 */}
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs px-2 py-0.5 bg-primary-100 text-primary-700 rounded">
              {courseName}
            </span>
            <h1 className="text-sm font-medium text-gray-900">{lessonTitle}</h1>
          </div>
        </div>
      </div>

      {/* 右侧操作 */}
      <div className="flex items-center gap-3">
        {/* 角色切换 */}
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
          <Link
            href="/"
            className={`px-3 py-1 rounded-md text-sm transition-colors ${
              userRole === 'student'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            学生端
          </Link>
          <Link
            href="/parent"
            className={`px-3 py-1 rounded-md text-sm transition-colors ${
              userRole === 'parent'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            家长端
          </Link>
          <Link
            href="/teacher"
            className={`px-3 py-1 rounded-md text-sm transition-colors ${
              userRole === 'teacher'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            教师端
          </Link>
        </div>

        {/* 服务状态指示器 */}
        <div className="hidden md:flex items-center gap-2 text-xs text-gray-500">
          <ServiceStatus name="Discussion" port={4000} />
          <ServiceStatus name="Notebook" port={5055} />
          <ServiceStatus name="LongCut" port={3000} />
        </div>

        {/* 用户头像 */}
        <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center">
          <span className="text-sm">
            {userRole === 'parent' ? '👨‍👩‍👧' : userRole === 'teacher' ? '👨‍🏫' : '👤'}
          </span>
        </div>
      </div>
    </header>
  );
}

function ServiceStatus({ name, port }: { name: string; port: number }) {
  // 简化版：假设服务都在线
  // TODO: 实际检测服务状态
  const isOnline = true;

  return (
    <div className="flex items-center gap-1" title={`${name} @ :${port}`}>
      <div className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-green-500' : 'bg-red-500'}`} />
      <span className="hidden lg:inline">{name}</span>
    </div>
  );
}
