'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { parentService, type ParentDailyReport, type ConfusionPoint } from '@/lib/services/parent-service';
import { memoryService, type ClassTimeline } from '@/lib/services/memory-service';

export default function ParentApp() {
  const [report, setReport] = useState<ParentDailyReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<ConfusionPoint | null>(null);
  const [showScript, setShowScript] = useState(false);

  // 加载日报
  useEffect(() => {
    loadReport();
  }, []);

  const loadReport = async () => {
    setIsLoading(true);
    setError(null);

    try {
      // 从本地存储加载时间轴数据
      const timelines: ClassTimeline[] = [];
      
      // 尝试加载 demo-session
      const demoTimeline = memoryService.load('demo-session');
      if (demoTimeline) {
        timelines.push(demoTimeline);
      }

      // 如果没有真实数据，使用演示数据
      if (timelines.length === 0) {
        const demoData: ClassTimeline = {
          id: 'timeline-demo',
          lessonId: 'demo-session',
          date: new Date().toISOString().split('T')[0],
          subject: '数学',
          teacher: '张老师',
          duration: 40 * 60 * 1000,
          segments: [
            { id: 's1', text: '今天我们来学习二次函数的图像', startMs: 0, endMs: 15000, confidence: 0.95, anchors: [], type: 'lecture' },
            { id: 's2', text: '二次函数的一般形式是 y = ax² + bx + c', startMs: 15000, endMs: 35000, confidence: 0.92, anchors: [], type: 'lecture' },
            { id: 's3', text: '顶点坐标公式是 (-b/2a, (4ac-b²)/4a)', startMs: 110000, endMs: 150000, confidence: 0.91, anchors: [], type: 'lecture' },
            { id: 's4', text: '求 y = 2x² - 4x + 1 的顶点坐标', startMs: 190000, endMs: 220000, confidence: 0.94, anchors: [], type: 'exercise' },
          ],
          anchors: [
            {
              id: 'anchor-1',
              sessionId: 'demo-session',
              studentId: 'student-1',
              timestamp: 125000,
              type: 'confusion',
              cancelled: false,
              resolved: false,
              createdAt: new Date().toISOString(),
            },
            {
              id: 'anchor-2',
              sessionId: 'demo-session',
              studentId: 'student-1',
              timestamp: 200000,
              type: 'confusion',
              cancelled: false,
              resolved: false,
              createdAt: new Date().toISOString(),
            },
          ],
        };
        timelines.push(demoData);
      }

      // 生成日报
      const dailyReport = await parentService.generateDailyReport(
        '小明',
        timelines
      );
      setReport(dailyReport);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setIsLoading(false);
    }
  };

  // 标记任务完成
  const handleTaskComplete = (taskId: string) => {
    if (!report) return;
    const updated = parentService.markTaskComplete(report, taskId);
    setReport(updated);
  };

  // 计算完成率
  const completionRate = report ? parentService.getCompletionRate(report) : 0;

  // 格式化时间
  const formatTime = (ms: number): string => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(minutes)}:${pad(seconds % 60)}`;
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-600">正在生成今日报告...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-50 flex items-center justify-center">
        <div className="text-center p-8 bg-white rounded-xl shadow-lg max-w-md">
          <div className="text-red-500 text-5xl mb-4">😕</div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">加载失败</h2>
          <p className="text-gray-600 mb-4">{error}</p>
          <button
            onClick={loadReport}
            className="px-6 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  if (!report) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-50">
      {/* 顶部导航 */}
      <header className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-gray-500 hover:text-gray-700">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div>
              <h1 className="text-xl font-bold text-gray-900">家长日报</h1>
              <p className="text-sm text-gray-500">{report.date}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-2xl">👨‍👩‍👧</span>
            <span className="font-medium text-gray-700">{report.studentName}的家长</span>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* 今日概览卡片 */}
        <div className="bg-white rounded-2xl shadow-sm p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">📊 今日概览</h2>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-blue-50 rounded-xl p-4 text-center">
              <div className="text-3xl font-bold text-blue-600">{report.totalLessons}</div>
              <div className="text-sm text-gray-600">节课</div>
            </div>
            <div className="bg-red-50 rounded-xl p-4 text-center">
              <div className="text-3xl font-bold text-red-600">{report.unresolvedBreakpoints}</div>
              <div className="text-sm text-gray-600">待解决困惑</div>
            </div>
            <div className="bg-green-50 rounded-xl p-4 text-center">
              <div className="text-3xl font-bold text-green-600">{report.totalBreakpoints - report.unresolvedBreakpoints}</div>
              <div className="text-sm text-gray-600">已解决</div>
            </div>
            <div className="bg-purple-50 rounded-xl p-4 text-center">
              <div className="text-3xl font-bold text-purple-600">{report.estimatedMinutes}</div>
              <div className="text-sm text-gray-600">分钟陪学</div>
            </div>
          </div>
        </div>

        {/* 困惑点列表 */}
        <div className="bg-white rounded-2xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-900">🎯 今日困惑点</h2>
            {report.confusionPoints.length > 0 && (
              <span className="text-sm text-gray-500">
                点击查看详情
              </span>
            )}
          </div>

          {report.confusionPoints.length === 0 ? (
            <div className="text-center py-8">
              <div className="text-5xl mb-4">🎉</div>
              <p className="text-gray-600">太棒了！今天没有困惑点</p>
              <p className="text-sm text-gray-400 mt-2">孩子课堂表现很好</p>
            </div>
          ) : (
            <div className="space-y-3">
              {report.confusionPoints.map((point, index) => (
                <div
                  key={point.id}
                  onClick={() => setSelectedPoint(selectedPoint?.id === point.id ? null : point)}
                  className={`border rounded-xl p-4 cursor-pointer transition-all ${
                    selectedPoint?.id === point.id
                      ? 'border-purple-500 bg-purple-50'
                      : 'border-gray-200 hover:border-purple-300'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <span className="text-red-600 font-bold text-sm">{index + 1}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full">
                          {point.subject}
                        </span>
                        <span className="text-sm text-gray-500">{point.time}</span>
                      </div>
                      <p className="text-gray-900 font-medium truncate">{point.summary}</p>
                      
                      {selectedPoint?.id === point.id && (
                        <div className="mt-3 pt-3 border-t border-gray-200">
                          <p className="text-sm text-gray-600 mb-2">老师原话：</p>
                          <blockquote className="text-sm text-gray-700 bg-gray-50 rounded-lg p-3 italic">
                            &ldquo;{point.teacherQuote}&rdquo;
                          </blockquote>
                          <div className="mt-3 flex gap-2">
                            <Link
                              href={`/?anchor=${point.id}&time=${point.timestamp}`}
                              className="flex-1 text-center py-2 bg-purple-500 text-white rounded-lg text-sm hover:bg-purple-600 transition-colors"
                            >
                              查看 AI 解释
                            </Link>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 陪学脚本 */}
        <div className="bg-white rounded-2xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-900">📝 今晚陪学脚本</h2>
            <button
              onClick={() => setShowScript(!showScript)}
              className="text-purple-600 text-sm hover:underline"
            >
              {showScript ? '收起' : '展开'}
            </button>
          </div>

          {showScript ? (
            <div className="prose prose-sm max-w-none">
              <div className="bg-gradient-to-r from-purple-50 to-pink-50 rounded-xl p-4 whitespace-pre-wrap text-gray-700">
                {report.actionScript}
              </div>
            </div>
          ) : (
            <div className="bg-gray-50 rounded-xl p-4">
              <p className="text-gray-600 text-sm">
                已为您生成约 {report.estimatedMinutes} 分钟的陪学脚本，点击展开查看详细步骤。
              </p>
            </div>
          )}
        </div>

        {/* 任务清单 */}
        <div className="bg-white rounded-2xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-900">✅ 陪学进度</h2>
            <div className="flex items-center gap-2">
              <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500 transition-all duration-300"
                  style={{ width: `${completionRate}%` }}
                />
              </div>
              <span className="text-sm text-gray-600">{completionRate}%</span>
            </div>
          </div>

          {report.completionStatus.length === 0 ? (
            <p className="text-gray-500 text-center py-4">今天没有待完成的任务</p>
          ) : (
            <div className="space-y-2">
              {report.completionStatus.map((task) => (
                <div
                  key={task.taskId}
                  onClick={() => handleTaskComplete(task.taskId)}
                  className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                    task.completed
                      ? 'bg-green-50 text-green-700'
                      : 'bg-gray-50 hover:bg-gray-100'
                  }`}
                >
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                    task.completed
                      ? 'border-green-500 bg-green-500'
                      : 'border-gray-300'
                  }`}>
                    {task.completed && (
                      <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </div>
                  <span className={task.completed ? 'line-through' : ''}>
                    {task.title}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 底部提示 */}
        <div className="text-center py-6">
          <p className="text-sm text-gray-400">
            💡 提示：完成陪学后，记得给孩子一个鼓励！
          </p>
        </div>
      </main>
    </div>
  );
}
