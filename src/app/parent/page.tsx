'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { parentService, type ParentDailyReport, type ConfusionPoint } from '@/lib/services/parent-service';
import { memoryService, type ClassTimeline } from '@/lib/services/memory-service';
import type { ClassSummary } from '@/types';

export default function ParentApp() {
  const [report, setReport] = useState<ParentDailyReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<ConfusionPoint | null>(null);
  const [showScript, setShowScript] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'confusion' | 'tasks'>('overview');
  
  // 新增：课堂摘要状态
  const [classSummaries, setClassSummaries] = useState<ClassSummary[]>([]);
  const [isLoadingSummary, setIsLoadingSummary] = useState(false);
  const [expandedSummary, setExpandedSummary] = useState<string | null>(null);

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

  // 生成课堂摘要
  const generateSummaryForSession = async (sessionId: string, segments: Array<{ text: string; startMs: number; endMs: number }>, subject: string) => {
    setIsLoadingSummary(true);
    try {
      const response = await fetch('/api/generate-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          transcript: segments,
          sessionInfo: { subject },
          format: 'structured'
        })
      });
      
      const data = await response.json();
      if (data.success && data.summary) {
        const newSummary: ClassSummary = {
          ...data.summary,
          sessionId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        setClassSummaries(prev => [...prev.filter(s => s.sessionId !== sessionId), newSummary]);
        setExpandedSummary(sessionId);
      }
    } catch (err) {
      console.error('生成摘要失败:', err);
    } finally {
      setIsLoadingSummary(false);
    }
  };

  // 格式化时间
  const formatTime = (ms: number): string => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(minutes)}:${pad(seconds % 60)}`;
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-violet-50 via-purple-50 to-fuchsia-50 flex items-center justify-center">
        <div className="text-center">
          <div className="relative w-20 h-20 mx-auto mb-6">
            <div className="absolute inset-0 rounded-full border-4 border-purple-200"></div>
            <div className="absolute inset-0 rounded-full border-4 border-purple-500 border-t-transparent animate-spin"></div>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-3xl">📊</span>
            </div>
          </div>
          <p className="text-gray-600 font-medium">正在生成今日报告...</p>
          <p className="text-sm text-gray-400 mt-2">分析学习数据中</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-violet-50 via-purple-50 to-fuchsia-50 flex items-center justify-center p-4">
        <div className="text-center p-8 bg-white rounded-3xl shadow-xl max-w-md w-full">
          <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <span className="text-4xl">😕</span>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">加载失败</h2>
          <p className="text-gray-600 mb-6">{error}</p>
          <button
            onClick={loadReport}
            className="w-full px-6 py-3 bg-gradient-to-r from-purple-500 to-fuchsia-500 text-white rounded-xl font-medium hover:from-purple-600 hover:to-fuchsia-600 transition-all shadow-lg shadow-purple-500/25"
          >
            重新加载
          </button>
        </div>
      </div>
    );
  }

  if (!report) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-50 via-purple-50 to-fuchsia-50">
      {/* 顶部导航 */}
      <header className="bg-white/80 backdrop-blur-lg shadow-sm sticky top-0 z-10 border-b border-purple-100">
        <div className="max-w-lg mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link 
                href="/" 
                className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center text-purple-600 hover:bg-purple-200 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </Link>
              <div>
                <h1 className="text-lg font-bold text-gray-900">家长日报</h1>
                <p className="text-xs text-gray-500">{report.date}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 bg-purple-100 px-3 py-2 rounded-xl">
              <span className="text-lg">👨‍👩‍👧</span>
              <span className="text-sm font-medium text-purple-700">{report.studentName}</span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-6">
        {/* 今日概览卡片 - 大卡片设计 */}
        <div className="bg-gradient-to-br from-purple-500 to-fuchsia-500 rounded-3xl p-6 text-white shadow-xl shadow-purple-500/25">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-medium opacity-90">今日学习</h2>
              <p className="text-3xl font-bold mt-1">{report.totalLessons} 节课</p>
            </div>
            <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center backdrop-blur-sm">
              <span className="text-4xl">📚</span>
            </div>
          </div>
          
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white/20 backdrop-blur-sm rounded-2xl p-3 text-center">
              <div className="text-2xl font-bold">{report.unresolvedBreakpoints}</div>
              <div className="text-xs opacity-80">待解决</div>
            </div>
            <div className="bg-white/20 backdrop-blur-sm rounded-2xl p-3 text-center">
              <div className="text-2xl font-bold">{report.totalBreakpoints - report.unresolvedBreakpoints}</div>
              <div className="text-xs opacity-80">已解决</div>
            </div>
            <div className="bg-white/20 backdrop-blur-sm rounded-2xl p-3 text-center">
              <div className="text-2xl font-bold">{report.estimatedMinutes}</div>
              <div className="text-xs opacity-80">分钟陪学</div>
            </div>
          </div>
        </div>

        {/* 标签页切换 */}
        <div className="flex bg-white rounded-2xl p-1.5 shadow-sm">
          {[
            { id: 'overview', label: '概览', icon: '📊' },
            { id: 'confusion', label: '困惑点', icon: '❓' },
            { id: 'tasks', label: '任务', icon: '✅' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`flex-1 py-3 px-4 rounded-xl text-sm font-medium transition-all ${
                activeTab === tab.id
                  ? 'bg-gradient-to-r from-purple-500 to-fuchsia-500 text-white shadow-lg shadow-purple-500/25'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <span className="mr-1.5">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        {/* 概览标签页 */}
        {activeTab === 'overview' && (
          <div className="space-y-4">
            {/* 今日课堂概要卡片 */}
            <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
              <div className="p-5 border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-gradient-to-br from-blue-400 to-indigo-500 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/25">
                    <span className="text-2xl">📝</span>
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-900">今日课堂概要</h3>
                    <p className="text-sm text-gray-500">AI 智能总结课堂内容</p>
                  </div>
                </div>
              </div>
              
              <div className="divide-y divide-gray-100">
                {/* 数学课概要 */}
                <div className="p-4">
                  <button
                    onClick={() => {
                      if (classSummaries.find(s => s.sessionId === 'demo-session')) {
                        setExpandedSummary(expandedSummary === 'demo-session' ? null : 'demo-session');
                      } else {
                        // 生成摘要
                        generateSummaryForSession('demo-session', [
                          { text: '今天我们来学习二次函数的图像', startMs: 0, endMs: 15000 },
                          { text: '二次函数的一般形式是 y = ax² + bx + c', startMs: 15000, endMs: 35000 },
                          { text: '其中 a 不等于 0，a 的正负决定了抛物线的开口方向', startMs: 35000, endMs: 60000 },
                          { text: '当 a 大于 0 时，抛物线开口向上', startMs: 60000, endMs: 85000 },
                          { text: '顶点坐标公式是 (-b/2a, (4ac-b²)/4a)', startMs: 110000, endMs: 150000 },
                          { text: '这个公式很重要，大家要记住', startMs: 150000, endMs: 170000 },
                        ], '数学');
                      }
                    }}
                    className="w-full flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-lg font-medium">数学</span>
                      <span className="text-gray-900 font-medium">二次函数的图像与性质</span>
                    </div>
                    {isLoadingSummary ? (
                      <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    ) : classSummaries.find(s => s.sessionId === 'demo-session') ? (
                      <svg 
                        className={`w-5 h-5 text-gray-400 transition-transform ${expandedSummary === 'demo-session' ? 'rotate-180' : ''}`}
                        fill="none" 
                        stroke="currentColor" 
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    ) : (
                      <span className="text-xs text-blue-600 font-medium">点击生成</span>
                    )}
                  </button>
                  
                  {/* 展开的摘要内容 */}
                  {expandedSummary === 'demo-session' && classSummaries.find(s => s.sessionId === 'demo-session') && (
                    <div className="mt-4 space-y-3 animate-in slide-in-from-top-2 duration-200">
                      {(() => {
                        const summary = classSummaries.find(s => s.sessionId === 'demo-session')!;
                        return (
                          <>
                            {/* 课堂概要 */}
                            <div className="bg-blue-50 rounded-xl p-4">
                              <p className="text-sm text-blue-800">{summary.overview}</p>
                            </div>
                            
                            {/* 主要知识点 */}
                            <div>
                              <h4 className="text-sm font-medium text-gray-700 mb-2">📚 主要知识点</h4>
                              <div className="space-y-2">
                                {summary.takeaways.map((takeaway, idx) => (
                                  <div key={idx} className="bg-gray-50 rounded-lg p-3">
                                    <div className="flex items-start gap-2">
                                      <span className="flex-shrink-0 w-5 h-5 bg-green-100 text-green-600 text-xs rounded-full flex items-center justify-center font-medium">
                                        {idx + 1}
                                      </span>
                                      <div>
                                        <p className="text-sm font-medium text-gray-900">{takeaway.label}</p>
                                        <p className="text-xs text-gray-600 mt-0.5">{takeaway.insight}</p>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                            
                            {/* 重点难点 */}
                            {summary.keyDifficulties.length > 0 && (
                              <div>
                                <h4 className="text-sm font-medium text-gray-700 mb-2">⚠️ 重点难点</h4>
                                <div className="flex flex-wrap gap-2">
                                  {summary.keyDifficulties.map((diff, idx) => (
                                    <span key={idx} className="px-3 py-1 bg-orange-100 text-orange-700 text-xs rounded-full">
                                      {diff}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  )}
                </div>
              </div>
            </div>
            
            {/* 陪学脚本 */}
            <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
              <button
                onClick={() => setShowScript(!showScript)}
                className="w-full p-5 flex items-center justify-between hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-gradient-to-br from-amber-400 to-orange-500 rounded-xl flex items-center justify-center shadow-lg shadow-orange-500/25">
                    <span className="text-2xl">📝</span>
                  </div>
                  <div className="text-left">
                    <h3 className="font-bold text-gray-900">今晚陪学脚本</h3>
                    <p className="text-sm text-gray-500">约 {report.estimatedMinutes} 分钟</p>
                  </div>
                </div>
                <svg 
                  className={`w-5 h-5 text-gray-400 transition-transform ${showScript ? 'rotate-180' : ''}`} 
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              
              {showScript && (
                <div className="px-5 pb-5">
                  <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl p-4 text-gray-700 text-sm leading-relaxed whitespace-pre-wrap border border-amber-100">
                    {report.actionScript}
                  </div>
                </div>
              )}
            </div>

            {/* 学习进度环 */}
            <div className="bg-white rounded-2xl shadow-sm p-5">
              <h3 className="font-bold text-gray-900 mb-4">陪学进度</h3>
              <div className="flex items-center gap-6">
                <div className="relative w-24 h-24">
                  <svg className="w-24 h-24 transform -rotate-90">
                    <circle
                      cx="48"
                      cy="48"
                      r="40"
                      stroke="#E9D5FF"
                      strokeWidth="8"
                      fill="none"
                    />
                    <circle
                      cx="48"
                      cy="48"
                      r="40"
                      stroke="url(#progressGradient)"
                      strokeWidth="8"
                      fill="none"
                      strokeLinecap="round"
                      strokeDasharray={`${completionRate * 2.51} 251`}
                      className="transition-all duration-500"
                    />
                    <defs>
                      <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#A855F7" />
                        <stop offset="100%" stopColor="#D946EF" />
                      </linearGradient>
                    </defs>
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-2xl font-bold text-gray-900">{completionRate}%</span>
                  </div>
                </div>
                <div className="flex-1">
                  <p className="text-gray-600 text-sm">
                    {completionRate === 100 
                      ? '🎉 太棒了！今天的陪学任务已全部完成！'
                      : completionRate >= 50
                      ? '👍 进展顺利，继续加油！'
                      : '💪 开始今天的陪学吧！'}
                  </p>
                  <div className="mt-3 flex gap-2">
                    <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded-full">
                      已完成 {report.completionStatus.filter(t => t.completed).length}
                    </span>
                    <span className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded-full">
                      待完成 {report.completionStatus.filter(t => !t.completed).length}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 困惑点标签页 */}
        {activeTab === 'confusion' && (
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            {report.confusionPoints.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="text-4xl">🎉</span>
                </div>
                <h3 className="font-bold text-gray-900 mb-2">太棒了！</h3>
                <p className="text-gray-500 text-sm">今天没有困惑点</p>
                <p className="text-gray-400 text-xs mt-1">孩子课堂表现很好</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {report.confusionPoints.map((point, index) => (
                  <div
                    key={point.id}
                    className="p-4 hover:bg-gray-50 transition-colors"
                  >
                    <button
                      onClick={() => setSelectedPoint(selectedPoint?.id === point.id ? null : point)}
                      className="w-full text-left"
                    >
                      <div className="flex items-start gap-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                          selectedPoint?.id === point.id 
                            ? 'bg-gradient-to-br from-purple-500 to-fuchsia-500 text-white shadow-lg shadow-purple-500/25' 
                            : 'bg-red-100 text-red-600'
                        }`}>
                          <span className="font-bold">{index + 1}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-xs rounded-full font-medium">
                              {point.subject}
                            </span>
                            <span className="text-xs text-gray-400">{point.time}</span>
                          </div>
                          <p className="text-gray-900 font-medium">{point.summary}</p>
                        </div>
                        <svg 
                          className={`w-5 h-5 text-gray-400 transition-transform flex-shrink-0 ${
                            selectedPoint?.id === point.id ? 'rotate-180' : ''
                          }`} 
                          fill="none" 
                          stroke="currentColor" 
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </button>
                    
                    {selectedPoint?.id === point.id && (
                      <div className="mt-4 ml-13 pl-13 animate-in slide-in-from-top-2 duration-200">
                        <div className="bg-gray-50 rounded-xl p-4 mb-3">
                          <p className="text-xs text-gray-500 mb-2">老师原话：</p>
                          <blockquote className="text-sm text-gray-700 italic">
                            &ldquo;{point.teacherQuote}&rdquo;
                          </blockquote>
                        </div>
                        <Link
                          href={`/?anchor=${point.id}&time=${point.timestamp}`}
                          className="block w-full text-center py-3 bg-gradient-to-r from-purple-500 to-fuchsia-500 text-white rounded-xl text-sm font-medium hover:from-purple-600 hover:to-fuchsia-600 transition-all shadow-lg shadow-purple-500/25"
                        >
                          查看 AI 解释
                        </Link>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 任务标签页 */}
        {activeTab === 'tasks' && (
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            {report.completionStatus.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="text-4xl">📋</span>
                </div>
                <p className="text-gray-500">今天没有待完成的任务</p>
              </div>
            ) : (
              <div className="p-4 space-y-3">
                {report.completionStatus.map((task, index) => (
                  <button
                    key={task.taskId}
                    onClick={() => handleTaskComplete(task.taskId)}
                    className={`w-full flex items-center gap-4 p-4 rounded-xl transition-all ${
                      task.completed
                        ? 'bg-green-50 border-2 border-green-200'
                        : 'bg-gray-50 hover:bg-gray-100 border-2 border-transparent'
                    }`}
                  >
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-all ${
                      task.completed
                        ? 'bg-gradient-to-br from-green-400 to-emerald-500 text-white shadow-lg shadow-green-500/25'
                        : 'border-2 border-gray-300'
                    }`}>
                      {task.completed && (
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                    </div>
                    <span className={`flex-1 text-left font-medium ${
                      task.completed ? 'text-green-700 line-through' : 'text-gray-700'
                    }`}>
                      {task.title}
                    </span>
                    {!task.completed && (
                      <span className="text-xs text-gray-400">点击完成</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 底部提示 */}
        <div className="text-center py-6">
          <p className="text-sm text-gray-400">
            💡 完成陪学后，记得给孩子一个鼓励！
          </p>
        </div>
      </main>
    </div>
  );
}
