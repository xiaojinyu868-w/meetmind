'use client';

import { useState, useEffect } from 'react';
import { ConfusionHotspotCard, type HotspotData } from './ConfusionHotspotCard';
import { ReflectionGenerator } from './ReflectionGenerator';

interface LessonData {
  id: string;
  subject: string;
  teacher: string;
  date: string;
  duration: number;
  totalStudents: number;
  hotspots: HotspotData[];
}

// 演示数据
const DEMO_LESSON: LessonData = {
  id: 'demo-session',
  subject: '数学',
  teacher: '张老师',
  date: new Date().toISOString().split('T')[0],
  duration: 340000,
  totalStudents: 42,
  hotspots: [
    {
      rank: 1,
      timeRange: '01:50 - 02:30',
      startMs: 110000,
      endMs: 150000,
      count: 8,
      content: '顶点坐标公式 (-b/2a, (4ac-b²)/4a) 的推导过程',
      students: ['小明', '小红', '小华', '小李', '小张', '小王', '小刘', '小陈'],
      possibleReason: '公式推导步骤跳跃',
    },
    {
      rank: 2,
      timeRange: '04:10 - 04:40',
      startMs: 250000,
      endMs: 280000,
      count: 5,
      content: '代入公式计算 x = -b/2a = 4/4 = 1 的过程',
      students: ['小明', '小华', '小张', '小刘', '小陈'],
      possibleReason: '计算步骤不清晰',
    },
    {
      rank: 3,
      timeRange: '00:15 - 00:35',
      startMs: 15000,
      endMs: 35000,
      count: 3,
      content: '二次函数的一般形式 y = ax² + bx + c 中参数的含义',
      students: ['小红', '小李', '小王'],
      possibleReason: '概念引入过快',
    },
  ],
};

export function TeacherDashboard() {
  const [lesson, setLesson] = useState<LessonData>(DEMO_LESSON);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // 模拟加载
    const timer = setTimeout(() => setIsLoading(false), 800);
    return () => clearTimeout(timer);
  }, []);

  if (isLoading) {
    return (
      <div className="h-screen overflow-y-auto bg-gradient-to-br from-slate-50 via-slate-100 to-indigo-50 flex items-center justify-center">
        <div className="text-center">
          <div className="relative w-20 h-20 mx-auto mb-6">
            <div className="absolute inset-0 rounded-full border-4 border-slate-200" />
            <div className="absolute inset-0 rounded-full border-4 border-indigo-500 border-t-transparent animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-3xl">📊</span>
            </div>
          </div>
          <p className="text-slate-600 font-medium">加载课堂数据...</p>
        </div>
      </div>
    );
  }

  const formatDuration = (ms: number) => {
    const minutes = Math.floor(ms / 60000);
    return `${minutes} 分钟`;
  };

  return (
    <div className="h-screen overflow-y-auto bg-gradient-to-br from-slate-50 via-slate-100 to-indigo-50">
      {/* 顶部导航 */}
      <header className="sticky top-0 z-50 bg-white/70 backdrop-blur-xl border-b border-slate-200/50 shadow-sm">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <a 
                href="/"
                className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors"
              >
                <svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </a>
              <div>
                <h1 className="text-xl font-bold text-slate-900">课后反馈</h1>
                <p className="text-sm text-slate-500">
                  {new Date().toLocaleDateString('zh-CN', { 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric',
                    weekday: 'long'
                  })}
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <a
                href="/"
                className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
              >
                学生端
              </a>
              <a
                href="/parent"
                className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
              >
                家长端
              </a>
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/25">
                <span className="text-lg">👨‍🏫</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* 课程信息卡片 */}
        <div className="mb-8 p-6 bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-slate-200/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/25">
                <span className="text-2xl">📖</span>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h2 className="text-xl font-bold text-slate-900">{lesson.subject}</h2>
                  <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-xs font-medium rounded-full">
                    {lesson.teacher}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-sm text-slate-500">
                  <span className="flex items-center gap-1">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {formatDuration(lesson.duration)}
                  </span>
                  <span className="flex items-center gap-1">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                    {lesson.totalStudents} 名学生
                  </span>
                </div>
              </div>
            </div>
            
            {/* 统计数据 */}
            <div className="flex items-center gap-6">
              <div className="text-center">
                <div className="text-3xl font-bold text-amber-600">{lesson.hotspots.length}</div>
                <div className="text-xs text-slate-500">困惑热点</div>
              </div>
              <div className="w-px h-10 bg-slate-200" />
              <div className="text-center">
                <div className="text-3xl font-bold text-red-500">
                  {lesson.hotspots.reduce((sum, h) => sum + h.count, 0)}
                </div>
                <div className="text-xs text-slate-500">困惑人次</div>
              </div>
            </div>
          </div>
        </div>

        {/* 困惑热点 TOP3 */}
        <section className="mb-8">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center shadow-lg shadow-red-500/25">
                <span className="text-sm">🔥</span>
              </div>
              <h2 className="text-lg font-bold text-slate-900">困惑热点 TOP3</h2>
            </div>
            <p className="text-sm text-slate-500">学生最困惑的知识点</p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-5">
            {lesson.hotspots.map((hotspot, index) => (
              <ConfusionHotspotCard 
                key={hotspot.rank} 
                hotspot={hotspot}
                isTop={index === 0}
              />
            ))}
          </div>
        </section>

        {/* 课后反思生成器 */}
        <section>
          <div className="flex items-center gap-3 mb-5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/25">
              <span className="text-sm">✨</span>
            </div>
            <h2 className="text-lg font-bold text-slate-900">一键生成课后反思</h2>
          </div>
          
          <ReflectionGenerator
            lessonInfo={{
              subject: lesson.subject,
              teacher: lesson.teacher,
              duration: lesson.duration,
              date: lesson.date,
            }}
            hotspots={lesson.hotspots.map(h => ({
              timeRange: h.timeRange,
              count: h.count,
              content: h.content,
              possibleReason: h.possibleReason,
            }))}
          />
        </section>
      </main>

      {/* 底部 */}
      <footer className="py-8 text-center text-sm text-slate-400">
        <p>MeetMind 教师工作台 · 让教学更有效</p>
      </footer>
    </div>
  );
}
