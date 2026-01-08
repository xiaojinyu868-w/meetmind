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
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-600">加载教学数据...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50">
      {/* 顶部导航 */}
      <header className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-gray-500 hover:text-gray-700">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div>
              <h1 className="text-xl font-bold text-gray-900">教师工作台</h1>
              <p className="text-sm text-gray-500">{new Date().toLocaleDateString('zh-CN')}</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900"
            >
              学生端
            </Link>
            <Link
              href="/parent"
              className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900"
            >
              家长端
            </Link>
            <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center">
              <span className="text-lg">👨‍🏫</span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* 统计卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <StatCard
            icon="📚"
            label="今日课程"
            value={stats?.totalSessions || 0}
            color="blue"
          />
          <StatCard
            icon="👥"
            label="参与学生"
            value={stats?.totalStudents || 0}
            color="green"
          />
          <StatCard
            icon="❓"
            label="困惑点总数"
            value={stats?.totalAnchors || 0}
            color="yellow"
          />
          <StatCard
            icon="⚠️"
            label="待解决"
            value={stats?.unresolvedAnchors || 0}
            color="red"
          />
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* 困惑热区 */}
          <div className="bg-white rounded-2xl shadow-sm p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
              <span>🔥</span> 困惑热区
            </h2>
            
            {stats?.hotspots && stats.hotspots.length > 0 ? (
              <div className="space-y-3">
                {/* 热区可视化 */}
                <div className="relative h-8 bg-gray-100 rounded-lg overflow-hidden">
                  {stats.hotspots.map((hotspot, i) => {
                    const duration = selectedTimeline?.duration || 1;
                    const left = (hotspot.startMs / duration) * 100;
                    const width = ((hotspot.endMs - hotspot.startMs) / duration) * 100;
                    const intensity = Math.min(hotspot.count / 3, 1);
                    
                    return (
                      <div
                        key={i}
                        className="absolute top-0 bottom-0 transition-opacity hover:opacity-80"
                        style={{
                          left: `${left}%`,
                          width: `${Math.max(width, 2)}%`,
                          backgroundColor: `rgba(239, 68, 68, ${0.3 + intensity * 0.7})`,
                        }}
                        title={`${formatTime(hotspot.startMs)}: ${hotspot.count} 个困惑点`}
                      />
                    );
                  })}
                </div>
                
                {/* 热区列表 */}
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {stats.hotspots.slice(0, 10).map((hotspot, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg"
                    >
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm ${
                        hotspot.count >= 3 ? 'bg-red-500' :
                        hotspot.count >= 2 ? 'bg-orange-500' : 'bg-yellow-500'
                      }`}>
                        {hotspot.count}
                      </div>
                      <div className="flex-1">
                        <div className="text-sm font-medium text-gray-900">
                          {formatTime(hotspot.startMs)} - {formatTime(hotspot.endMs)}
                        </div>
                        <div className="text-xs text-gray-500">
                          {getSegmentTextAtTime(selectedTimeline, hotspot.startMs)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                <div className="text-4xl mb-2">🎉</div>
                <p>今天没有困惑热区</p>
              </div>
            )}
          </div>

          {/* AI 课后反思 */}
          <div className="bg-white rounded-2xl shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <span>🤖</span> AI 课后反思
              </h2>
              <button
                onClick={generateReflection}
                disabled={isGenerating}
                className="px-4 py-2 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 disabled:opacity-50 text-sm transition-colors"
              >
                {isGenerating ? '生成中...' : '生成反思'}
              </button>
            </div>

            {aiReflection ? (
              <div className="prose prose-sm max-w-none">
                <div className="bg-indigo-50 rounded-xl p-4 whitespace-pre-wrap text-gray-700">
                  {aiReflection}
                </div>
              </div>
            ) : (
              <div className="text-center py-12 text-gray-400">
                <div className="text-4xl mb-3">📝</div>
                <p>点击"生成反思"获取 AI 教学建议</p>
              </div>
            )}
          </div>
        </div>

        {/* 课程列表 */}
        <div className="mt-6 bg-white rounded-2xl shadow-sm p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
            <span>📋</span> 今日课程
          </h2>
          
          <div className="space-y-3">
            {timelines.map((timeline) => (
              <div
                key={timeline.id}
                onClick={() => setSelectedTimeline(timeline)}
                className={`flex items-center gap-4 p-4 rounded-xl cursor-pointer transition-colors ${
                  selectedTimeline?.id === timeline.id
                    ? 'bg-indigo-50 border-2 border-indigo-500'
                    : 'bg-gray-50 hover:bg-gray-100'
                }`}
              >
                <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center">
                  <span className="text-2xl">📖</span>
                </div>
                <div className="flex-1">
                  <div className="font-medium text-gray-900">{timeline.subject}</div>
                  <div className="text-sm text-gray-500">
                    {timeline.teacher} · {Math.round(timeline.duration / 60000)} 分钟
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-red-500">
                    {timeline.anchors.length}
                  </div>
                  <div className="text-xs text-gray-500">困惑点</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 学生困惑详情 */}
        {selectedTimeline && selectedTimeline.anchors.length > 0 && (
          <div className="mt-6 bg-white rounded-2xl shadow-sm p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
              <span>👥</span> 学生困惑详情
            </h2>
            
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">时间</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">学生</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">类型</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">状态</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">相关内容</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedTimeline.anchors.map((anchor) => (
                    <tr key={anchor.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-3 px-4 text-sm font-mono">
                        {formatTime(anchor.timestamp)}
                      </td>
                      <td className="py-3 px-4 text-sm">
                        {anchor.studentId}
                      </td>
                      <td className="py-3 px-4">
                        <span className={`text-xs px-2 py-1 rounded-full ${
                          anchor.type === 'confusion' ? 'bg-red-100 text-red-700' :
                          anchor.type === 'question' ? 'bg-blue-100 text-blue-700' :
                          'bg-yellow-100 text-yellow-700'
                        }`}>
                          {anchor.type === 'confusion' ? '困惑' :
                           anchor.type === 'question' ? '提问' : '重点'}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`text-xs px-2 py-1 rounded-full ${
                          anchor.resolved ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
                        }`}>
                          {anchor.resolved ? '已解决' : '待解决'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-600 max-w-xs truncate">
                        {getSegmentTextAtTime(selectedTimeline, anchor.timestamp)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
  color 
}: { 
  icon: string; 
  label: string; 
  value: number; 
  color: 'blue' | 'green' | 'yellow' | 'red';
}) {
  const colors = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    yellow: 'bg-yellow-50 text-yellow-600',
    red: 'bg-red-50 text-red-600',
  };

  return (
    <div className={`${colors[color]} rounded-2xl p-4`}>
      <div className="text-2xl mb-2">{icon}</div>
      <div className="text-3xl font-bold">{value}</div>
      <div className="text-sm opacity-80">{label}</div>
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
