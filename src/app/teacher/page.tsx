'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { memoryService, type ClassTimeline } from '@/lib/services/memory-service';
import type { ConfusionHotspot, Anchor } from '@/types';

interface TeacherStats {
  totalSessions: number;
  totalStudents: number;
  totalAnchors: number;
  unresolvedAnchors: number;
  hotspots: ConfusionHotspot[];
}

export default function TeacherApp() {
  const [stats, setStats] = useState<TeacherStats | null>(null);
  const [timelines, setTimelines] = useState<ClassTimeline[]>([]);
  const [selectedTimeline, setSelectedTimeline] = useState<ClassTimeline | null>(null);
  const [aiReflection, setAiReflection] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [activeView, setActiveView] = useState<'hotspots' | 'students' | 'reflection'>('hotspots');

  // 加载数据
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    
    try {
      // 从本地存储加载时间轴
      const loadedTimelines: ClassTimeline[] = [];
      
      // 尝试加载 demo-session
      const demoTimeline = memoryService.load('demo-session');
      if (demoTimeline) {
        loadedTimelines.push(demoTimeline);
      }

      // 如果没有数据，使用演示数据
      if (loadedTimelines.length === 0) {
        const demoData = createDemoTimeline();
        loadedTimelines.push(demoData);
      }

      setTimelines(loadedTimelines);
      
      // 计算统计数据
      const allAnchors = loadedTimelines.flatMap(t => t.anchors);
      const hotspots = loadedTimelines.length > 0 
        ? memoryService.getConfusionHotspots(loadedTimelines[0])
        : [];

      setStats({
        totalSessions: loadedTimelines.length,
        totalStudents: new Set(allAnchors.map(a => a.studentId)).size || 1,
        totalAnchors: allAnchors.length,
        unresolvedAnchors: allAnchors.filter(a => !a.resolved).length,
        hotspots,
      });

      if (loadedTimelines.length > 0) {
        setSelectedTimeline(loadedTimelines[0]);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // 生成 AI 反思
  const generateReflection = async () => {
    if (!selectedTimeline || !stats) return;
    
    setIsGenerating(true);
    setAiReflection('');
    setActiveView('reflection');

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            {
              role: 'system',
              content: `你是一位教学顾问，帮助教师反思课堂教学。根据学生的困惑点数据，生成课后反思和改进建议。

要求：
1. 分析困惑点的分布规律
2. 指出可能的教学问题
3. 给出具体的改进建议
4. 语气专业但友好`,
            },
            {
              role: 'user',
              content: `今天的课堂数据：
- 科目：${selectedTimeline.subject}
- 时长：${Math.round(selectedTimeline.duration / 60000)} 分钟
- 学生困惑点：${stats.totalAnchors} 个
- 未解决：${stats.unresolvedAnchors} 个

困惑热区分布：
${stats.hotspots.slice(0, 5).map((h, i) => 
  `${i + 1}. ${formatTime(h.startMs)}-${formatTime(h.endMs)}: ${h.count} 个困惑点`
).join('\n')}

课堂内容片段：
${selectedTimeline.segments.slice(0, 10).map(s => 
  `[${formatTime(s.startMs)}] ${s.text}`
).join('\n')}

请生成课后反思和改进建议。`,
            },
          ],
          model: 'qwen3-max',
        }),
      });

      if (!response.ok) {
        throw new Error('生成失败');
      }

      const data = await response.json();
      setAiReflection(data.content);
    } catch (error) {
      setAiReflection('生成反思失败，请重试。');
    } finally {
      setIsGenerating(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 flex items-center justify-center">
        <div className="text-center">
          <div className="relative w-20 h-20 mx-auto mb-6">
            <div className="absolute inset-0 rounded-full border-4 border-indigo-200"></div>
            <div className="absolute inset-0 rounded-full border-4 border-indigo-500 border-t-transparent animate-spin"></div>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-3xl">📊</span>
            </div>
          </div>
          <p className="text-gray-600 font-medium">加载教学数据...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      {/* 顶部导航 */}
      <header className="bg-white/80 backdrop-blur-lg shadow-sm sticky top-0 z-10 border-b border-indigo-100">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link 
                href="/" 
                className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center text-indigo-600 hover:bg-indigo-200 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </Link>
              <div>
                <h1 className="text-xl font-bold text-gray-900">教师工作台</h1>
                <p className="text-sm text-gray-500">{new Date().toLocaleDateString('zh-CN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Link
                href="/"
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
              >
                学生端
              </Link>
              <Link
                href="/parent"
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
              >
                家长端
              </Link>
              <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/25">
                <span className="text-lg">👨‍🏫</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* 统计卡片 */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatCard
            icon="📚"
            label="今日课程"
            value={stats?.totalSessions || 0}
            gradient="from-blue-500 to-cyan-500"
          />
          <StatCard
            icon="👥"
            label="参与学生"
            value={stats?.totalStudents || 0}
            gradient="from-emerald-500 to-teal-500"
          />
          <StatCard
            icon="❓"
            label="困惑点总数"
            value={stats?.totalAnchors || 0}
            gradient="from-amber-500 to-orange-500"
          />
          <StatCard
            icon="⚠️"
            label="待解决"
            value={stats?.unresolvedAnchors || 0}
            gradient="from-rose-500 to-pink-500"
          />
        </div>

        {/* 课程选择器 */}
        {timelines.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm p-4 mb-6">
            <div className="flex items-center gap-4 overflow-x-auto pb-2">
              {timelines.map((timeline) => (
                <button
                  key={timeline.id}
                  onClick={() => setSelectedTimeline(timeline)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all whitespace-nowrap ${
                    selectedTimeline?.id === timeline.id
                      ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-lg shadow-indigo-500/25'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  <span className="text-xl">📖</span>
                  <div className="text-left">
                    <div className="font-medium">{timeline.subject}</div>
                    <div className="text-xs opacity-80">{timeline.teacher}</div>
                  </div>
                  <div className={`ml-2 px-2 py-1 rounded-full text-xs font-bold ${
                    selectedTimeline?.id === timeline.id
                      ? 'bg-white/20'
                      : 'bg-red-100 text-red-600'
                  }`}>
                    {timeline.anchors.length}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 视图切换 */}
        <div className="flex gap-2 mb-6">
          {[
            { id: 'hotspots', label: '困惑热区', icon: '🔥' },
            { id: 'students', label: '学生详情', icon: '👥' },
            { id: 'reflection', label: 'AI 反思', icon: '🤖' },
          ].map((view) => (
            <button
              key={view.id}
              onClick={() => setActiveView(view.id as typeof activeView)}
              className={`flex items-center gap-2 px-5 py-3 rounded-xl font-medium transition-all ${
                activeView === view.id
                  ? 'bg-white text-indigo-600 shadow-lg'
                  : 'bg-white/50 text-gray-600 hover:bg-white/80'
              }`}
            >
              <span>{view.icon}</span>
              {view.label}
            </button>
          ))}
        </div>

        {/* 困惑热区视图 */}
        {activeView === 'hotspots' && (
          <div className="bg-white rounded-2xl shadow-sm p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-6 flex items-center gap-2">
              <span className="text-2xl">🔥</span> 困惑热区分析
            </h2>
            
            {stats?.hotspots && stats.hotspots.length > 0 ? (
              <div className="space-y-6">
                {/* 热区时间轴可视化 */}
                <div className="relative">
                  <div className="h-16 bg-gradient-to-r from-gray-100 to-gray-50 rounded-2xl overflow-hidden relative">
                    {/* 时间刻度 */}
                    <div className="absolute inset-x-0 bottom-0 flex justify-between px-4 py-1 text-xs text-gray-400">
                      <span>00:00</span>
                      <span>{formatTime((selectedTimeline?.duration || 0) / 2)}</span>
                      <span>{formatTime(selectedTimeline?.duration || 0)}</span>
                    </div>
                    
                    {/* 热区块 */}
                    {stats.hotspots.map((hotspot, i) => {
                      const duration = selectedTimeline?.duration || 1;
                      const left = (hotspot.startMs / duration) * 100;
                      const width = ((hotspot.endMs - hotspot.startMs) / duration) * 100;
                      const intensity = Math.min(hotspot.count / 3, 1);
                      
                      return (
                        <div
                          key={i}
                          className="absolute top-2 bottom-6 rounded-lg transition-all hover:scale-y-110 cursor-pointer group"
                          style={{
                            left: `${left}%`,
                            width: `${Math.max(width, 2)}%`,
                            background: `linear-gradient(180deg, rgba(239, 68, 68, ${0.4 + intensity * 0.6}) 0%, rgba(239, 68, 68, ${0.2 + intensity * 0.4}) 100%)`,
                          }}
                          title={`${formatTime(hotspot.startMs)}: ${hotspot.count} 个困惑点`}
                        >
                          <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                            {hotspot.count} 个困惑点
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                
                {/* 热区列表 */}
                <div className="grid md:grid-cols-2 gap-4">
                  {stats.hotspots.slice(0, 6).map((hotspot, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-4 p-4 bg-gradient-to-r from-gray-50 to-white rounded-xl border border-gray-100 hover:shadow-md transition-all"
                    >
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold shadow-lg ${
                        hotspot.count >= 3 ? 'bg-gradient-to-br from-red-500 to-rose-500 shadow-red-500/25' :
                        hotspot.count >= 2 ? 'bg-gradient-to-br from-orange-500 to-amber-500 shadow-orange-500/25' : 
                        'bg-gradient-to-br from-yellow-500 to-amber-400 shadow-yellow-500/25'
                      }`}>
                        {hotspot.count}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-gray-900">
                          {formatTime(hotspot.startMs)} - {formatTime(hotspot.endMs)}
                        </div>
                        <div className="text-sm text-gray-500 truncate">
                          {getSegmentTextAtTime(selectedTimeline, hotspot.startMs)}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {Array.from({ length: Math.min(hotspot.count, 5) }).map((_, j) => (
                          <div key={j} className="w-2 h-2 bg-red-400 rounded-full" />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center py-16">
                <div className="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                  <span className="text-5xl">🎉</span>
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">太棒了！</h3>
                <p className="text-gray-500">今天没有困惑热区，学生们理解得很好</p>
              </div>
            )}
          </div>
        )}

        {/* 学生详情视图 */}
        {activeView === 'students' && selectedTimeline && (
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="p-6 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <span className="text-2xl">👥</span> 学生困惑详情
              </h2>
            </div>
            
            {selectedTimeline.anchors.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left py-4 px-6 text-sm font-medium text-gray-500">时间</th>
                      <th className="text-left py-4 px-6 text-sm font-medium text-gray-500">学生</th>
                      <th className="text-left py-4 px-6 text-sm font-medium text-gray-500">类型</th>
                      <th className="text-left py-4 px-6 text-sm font-medium text-gray-500">状态</th>
                      <th className="text-left py-4 px-6 text-sm font-medium text-gray-500">相关内容</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {selectedTimeline.anchors.map((anchor) => (
                      <tr key={anchor.id} className="hover:bg-gray-50 transition-colors">
                        <td className="py-4 px-6">
                          <span className="font-mono text-sm bg-gray-100 px-2 py-1 rounded">
                            {formatTime(anchor.timestamp)}
                          </span>
                        </td>
                        <td className="py-4 px-6">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center">
                              <span className="text-sm">👤</span>
                            </div>
                            <span className="font-medium text-gray-900">{anchor.studentId}</span>
                          </div>
                        </td>
                        <td className="py-4 px-6">
                          <span className={`inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-full font-medium ${
                            anchor.type === 'confusion' ? 'bg-red-100 text-red-700' :
                            anchor.type === 'question' ? 'bg-blue-100 text-blue-700' :
                            'bg-yellow-100 text-yellow-700'
                          }`}>
                            {anchor.type === 'confusion' ? '❓ 困惑' :
                             anchor.type === 'question' ? '💬 提问' : '⭐ 重点'}
                          </span>
                        </td>
                        <td className="py-4 px-6">
                          <span className={`inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-full font-medium ${
                            anchor.resolved 
                              ? 'bg-green-100 text-green-700' 
                              : 'bg-gray-100 text-gray-600'
                          }`}>
                            {anchor.resolved ? '✅ 已解决' : '⏳ 待解决'}
                          </span>
                        </td>
                        <td className="py-4 px-6">
                          <p className="text-sm text-gray-600 max-w-xs truncate">
                            {getSegmentTextAtTime(selectedTimeline, anchor.timestamp)}
                          </p>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-16">
                <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="text-4xl">📋</span>
                </div>
                <p className="text-gray-500">暂无学生困惑记录</p>
              </div>
            )}
          </div>
        )}

        {/* AI 反思视图 */}
        {activeView === 'reflection' && (
          <div className="bg-white rounded-2xl shadow-sm p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <span className="text-2xl">🤖</span> AI 课后反思
              </h2>
              <button
                onClick={generateReflection}
                disabled={isGenerating}
                className="px-6 py-3 bg-gradient-to-r from-indigo-500 to-purple-500 text-white rounded-xl font-medium hover:from-indigo-600 hover:to-purple-600 disabled:opacity-50 transition-all shadow-lg shadow-indigo-500/25 flex items-center gap-2"
              >
                {isGenerating ? (
                  <>
                    <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    生成中...
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    生成反思
                  </>
                )}
              </button>
            </div>

            {aiReflection ? (
              <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-2xl p-6 border border-indigo-100">
                <div className="prose prose-indigo max-w-none">
                  <div className="whitespace-pre-wrap text-gray-700 leading-relaxed">
                    {aiReflection}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-20">
                <div className="w-24 h-24 bg-gradient-to-br from-indigo-100 to-purple-100 rounded-full flex items-center justify-center mx-auto mb-6">
                  <span className="text-5xl">📝</span>
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">生成教学反思</h3>
                <p className="text-gray-500 max-w-md mx-auto">
                  AI 将根据今天的课堂数据和学生困惑点，为您生成专业的教学反思和改进建议
                </p>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

// 统计卡片组件
function StatCard({ 
  icon, 
  label, 
  value, 
  gradient 
}: { 
  icon: string; 
  label: string; 
  value: number; 
  gradient: string;
}) {
  return (
    <div className="bg-white rounded-2xl shadow-sm p-5 hover:shadow-lg transition-shadow">
      <div className="flex items-center gap-4">
        <div className={`w-14 h-14 bg-gradient-to-br ${gradient} rounded-xl flex items-center justify-center shadow-lg`}>
          <span className="text-2xl">{icon}</span>
        </div>
        <div>
          <div className="text-3xl font-bold text-gray-900">{value}</div>
          <div className="text-sm text-gray-500">{label}</div>
        </div>
      </div>
    </div>
  );
}

// 辅助函数
function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(minutes)}:${pad(seconds % 60)}`;
}

function getSegmentTextAtTime(timeline: ClassTimeline | null, timestamp: number): string {
  if (!timeline) return '';
  const segment = timeline.segments.find(
    s => s.startMs <= timestamp && s.endMs >= timestamp
  );
  return segment?.text || '';
}

// 创建演示数据
function createDemoTimeline(): ClassTimeline {
  return {
    id: 'timeline-demo',
    lessonId: 'demo-session',
    date: new Date().toISOString().split('T')[0],
    subject: '数学',
    teacher: '张老师',
    duration: 340000,
    segments: [
      { id: 's1', text: '今天我们来学习二次函数的图像', startMs: 0, endMs: 15000, confidence: 0.95, anchors: [], type: 'lecture' },
      { id: 's2', text: '二次函数的一般形式是 y = ax² + bx + c', startMs: 15000, endMs: 35000, confidence: 0.92, anchors: [], type: 'lecture' },
      { id: 's3', text: '顶点坐标公式是 (-b/2a, (4ac-b²)/4a)', startMs: 110000, endMs: 150000, confidence: 0.91, anchors: [], type: 'lecture' },
      { id: 's4', text: '求 y = 2x² - 4x + 1 的顶点坐标', startMs: 190000, endMs: 220000, confidence: 0.94, anchors: [], type: 'exercise' },
      { id: 's5', text: '代入公式 x = -b/2a = 4/4 = 1', startMs: 250000, endMs: 280000, confidence: 0.93, anchors: [], type: 'lecture' },
    ],
    anchors: [
      {
        id: 'anchor-1',
        sessionId: 'demo-session',
        studentId: '小明',
        timestamp: 125000,
        type: 'confusion',
        cancelled: false,
        resolved: false,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'anchor-2',
        sessionId: 'demo-session',
        studentId: '小红',
        timestamp: 130000,
        type: 'confusion',
        cancelled: false,
        resolved: true,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'anchor-3',
        sessionId: 'demo-session',
        studentId: '小明',
        timestamp: 260000,
        type: 'confusion',
        cancelled: false,
        resolved: false,
        createdAt: new Date().toISOString(),
      },
    ],
  };
}
