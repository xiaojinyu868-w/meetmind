'use client';

import dynamic from 'next/dynamic';

// 动态加载 TeacherDashboard，减少首页 chunk 体积
const TeacherDashboard = dynamic(
  () => import('@/components/teacher/TeacherDashboard').then(m => ({ default: m.TeacherDashboard })),
  {
    loading: () => (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <div className="w-16 h-16 bg-gradient-to-br from-indigo-400 to-indigo-600 rounded-2xl" />
          <div className="text-gray-500 text-sm">加载教师端...</div>
        </div>
      </div>
    )
  }
);

export default function TeacherPage() {
  return <TeacherDashboard />;
}
