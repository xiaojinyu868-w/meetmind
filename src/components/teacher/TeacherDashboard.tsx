'use client';

import { useState, useEffect, useCallback } from 'react';
import { ConfusionHotspotCard, type HotspotData } from './ConfusionHotspotCard';
import { ReflectionGenerator } from './ReflectionGenerator';
import { 
  classroomDataService, 
  type ClassSession, 
  type ConfusionHotspot,
} from '@/lib/services/classroom-data-service';
import { db } from '@/lib/db';
import type { TranscriptSegment } from '@/types';
import { DEMO_SEGMENTS, DEMO_ANCHORS, DEMO_SESSION_ID } from '@/fixtures/demo-data';

interface LessonData {
  id: string;
  subject: string;
  teacher: string;
  date: string;
  duration: number;
  totalStudents: number;
  hotspots: HotspotData[];
}

/**
 * 生成演示数据的困惑热点
 * 基于 demo-data.ts 中的 DEMO_SEGMENTS 和 DEMO_ANCHORS
 */
function generateDemoHotspots(): HotspotData[] {
  const windowSize = 30000; // 30秒窗口
  const windowMap = new Map<number, typeof DEMO_ANCHORS>();
  
  DEMO_ANCHORS.forEach(anchor => {
    if (anchor.cancelled) return;
    const windowStart = Math.floor(anchor.timestamp / windowSize) * windowSize;
    if (!windowMap.has(windowStart)) {
      windowMap.set(windowStart, []);
    }
    windowMap.get(windowStart)!.push(anchor);
  });
  
  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };
  
  const getTranscriptContent = (startMs: number, endMs: number): string => {
    const relevantSegments = DEMO_SEGMENTS.filter(
      t => t.startMs < endMs && t.endMs > startMs
    );
    if (relevantSegments.length === 0) return '(无转录内容)';
    return relevantSegments
      .sort((a, b) => a.startMs - b.startMs)
      .map(t => t.text)
      .join(' ')
      .slice(0, 150);
  };
  
  const hotspots: HotspotData[] = Array.from(windowMap.entries())
    .map(([startMs, anchors]) => {
      const endMs = startMs + windowSize;
      const content = getTranscriptContent(startMs, endMs);
      
      // v2.0: 计算搞定率
      const resolvedCount = anchors.filter(a => a.resolved).length;
      const resolvedRate = anchors.length > 0 ? Math.round((resolvedCount / anchors.length) * 100) : 0;
      
      return {
        rank: 0,
        timeRange: `${formatTime(startMs)} - ${formatTime(endMs)}`,
        startMs,
        endMs,
        count: anchors.length,
        content,
        students: anchors.map((_, i) => `演示学生${i + 1}`),
        possibleReason: content.includes('?') || content.includes('？') 
          ? '问答环节理解困难' 
          : '听力内容较难理解',
        resolvedCount,
        resolvedRate,
      };
    })
    .sort((a, b) => b.count - a.count)
    .map((h, i) => ({ ...h, rank: i + 1 }));
  
  return hotspots;
}

// 演示数据 - 使用统一的 demo-data.ts 数据源
const DEMO_LESSON: LessonData = {
  id: DEMO_SESSION_ID,
  subject: '英语',
  teacher: 'Demo Teacher',
  date: new Date().toISOString().split('T')[0],
  duration: DEMO_SEGMENTS.length > 0 ? DEMO_SEGMENTS[DEMO_SEGMENTS.length - 1].endMs : 93000,
  totalStudents: 1,
  hotspots: generateDemoHotspots(),
};

interface TeacherDashboardProps {
  /** 指定课程会话ID，如果不指定则显示最新的课程 */
  sessionId?: string;
}

export function TeacherDashboard({ sessionId: propSessionId }: TeacherDashboardProps) {
  const [lesson, setLesson] = useState<LessonData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [, setError] = useState<string | null>(null);
  const [availableSessions, setAvailableSessions] = useState<ClassSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>(propSessionId || '');
  const [isRealData, setIsRealData] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  /**
   * 将 ConfusionHotspot 转换为 HotspotData
   */
  const convertToHotspotData = (hotspot: ConfusionHotspot): HotspotData => ({
    rank: hotspot.rank,
    timeRange: hotspot.timeRange,
    startMs: hotspot.startMs,
    endMs: hotspot.endMs,
    count: hotspot.count,
    content: hotspot.content,
    students: hotspot.students,
    possibleReason: hotspot.possibleReason,
    // v2.0: 添加搞定率数据
    resolvedCount: hotspot.resolvedCount,
    resolvedRate: hotspot.resolvedRate,
  });

  /**
   * 加载课堂数据
   */
  const loadClassroomData = useCallback(async (sessionId: string) => {
    setIsLoading(true);
    setError(null);
    
    try {
      // 获取课程会话信息
      const session = classroomDataService.getSession(sessionId);
      
      // 获取困惑点
      const anchors = classroomDataService.getSessionAnchors(sessionId);
      
      // 从 IndexedDB 获取转录内容
      let transcripts: TranscriptSegment[] = [];
      try {
        const dbTranscripts = await db.transcripts
          .where('sessionId')
          .equals(sessionId)
          .sortBy('startMs');
        // 转换类型：db.TranscriptSegment -> types.TranscriptSegment
        transcripts = dbTranscripts.map((t, idx) => ({
          id: t.id?.toString() || `seg-${idx}`,
          text: t.text,
          startMs: t.startMs,
          endMs: t.endMs,
          confidence: t.confidence,
          speakerId: t.speakerId,
          isFinal: t.isFinal,
        }));
      } catch (e) {
        console.warn('获取转录内容失败:', e);
      }
      
      // 如果没有任何数据，使用演示数据
      if (!session && anchors.length === 0 && transcripts.length === 0) {
        setLesson(DEMO_LESSON);
        setIsRealData(false);
        setIsLoading(false);
        return;
      }
      
      // 聚合热点数据
      const hotspots = classroomDataService.aggregateHotspots(
        sessionId,
        transcripts,
        30000, // 30秒窗口
        10     // 最多10个热点
      );
      
      // 统计学生数
      const studentIds = new Set(anchors.map(a => a.studentId));
      
      // 构建课程数据
      const lessonData: LessonData = {
        id: sessionId,
        subject: session?.subject || '英语',
        teacher: session?.teacherName || 'Teacher',
        date: session?.createdAt 
          ? new Date(session.createdAt).toISOString().split('T')[0]
          : new Date().toISOString().split('T')[0],
        duration: session?.duration || (transcripts.length > 0 ? transcripts[transcripts.length - 1].endMs : 0),
        totalStudents: studentIds.size || 1,
        hotspots: hotspots.length > 0 
          ? hotspots.map(convertToHotspotData)
          : [], // 有数据但无热点时显示空
      };
      
      setLesson(lessonData);
      setIsRealData(hotspots.length > 0 || anchors.length > 0 || transcripts.length > 0);
      setLastRefresh(new Date());
      
    } catch (err) {
      console.error('加载课堂数据失败:', err);
      setError('加载数据失败');
      // 降级使用演示数据
      setLesson(DEMO_LESSON);
      setIsRealData(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * 加载可用的课程会话列表
   */
  const loadAvailableSessions = useCallback(() => {
    const sessions = classroomDataService.getAllSessions();
    setAvailableSessions(sessions);
    
    // 如果没有指定 sessionId，选择最新的课程
    if (!propSessionId && sessions.length > 0) {
      const latestSession = sessions.sort((a, b) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )[0];
      setSelectedSessionId(latestSession.id);
    } else if (propSessionId) {
      setSelectedSessionId(propSessionId);
    } else {
      // 没有课程，使用演示数据
      setSelectedSessionId('demo-session');
    }
  }, [propSessionId]);

  // 初始化
  useEffect(() => {
    loadAvailableSessions();
  }, [loadAvailableSessions]);

  // 当选中的课程变化时加载数据
  useEffect(() => {
    if (selectedSessionId) {
      loadClassroomData(selectedSessionId);
    }
  }, [selectedSessionId, loadClassroomData]);

  // 监听跨标签页的困惑点更新
  useEffect(() => {
    const cleanup = classroomDataService.onAnchorUpdate((action, anchor) => {
      // 如果是当前课程的更新，刷新数据
      if (anchor.sessionId === selectedSessionId) {
        loadClassroomData(selectedSessionId);
      }
    });
    
    return cleanup;
  }, [selectedSessionId, loadClassroomData]);

  /**
   * 手动刷新数据
   */
  const handleRefresh = () => {
    loadAvailableSessions();
    if (selectedSessionId) {
      loadClassroomData(selectedSessionId);
    }
  };

  if (isLoading) {
    return (
      <div className="h-screen overflow-y-auto bg-[#F7F7F5] flex items-center justify-center">
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

  if (!lesson) {
    return (
      <div className="h-screen overflow-y-auto bg-[#F7F7F5] flex items-center justify-center">
        <div className="text-center">
          <span className="text-6xl mb-4 block">📭</span>
          <h2 className="text-xl font-bold text-slate-900 mb-2">暂无课堂数据</h2>
          <p className="text-slate-500 mb-4">请先在学生端录制课程</p>
          <a 
            href="/"
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition-colors"
          >
            前往学生端
          </a>
        </div>
      </div>
    );
  }

  const formatDuration = (ms: number) => {
    const minutes = Math.floor(ms / 60000);
    return minutes > 0 ? `${minutes} 分钟` : '进行中';
  };

  return (
    <div className="h-screen overflow-y-auto bg-[#F7F7F5]">
      {/* 顶部导航 */}
      <header className="sticky top-0 z-50 bg-white/70 border-b border-slate-200/50 shadow-sm">
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
              {/* 数据来源指示 */}
              <span className={`px-2 py-1 text-xs rounded-full ${
                isRealData 
                  ? 'bg-green-100 text-green-700' 
                  : 'bg-[#FDF3C0] text-[#232322]'
              }`}>
                {isRealData ? '📡 实时数据' : '📋 演示数据'}
              </span>
              
              {/* 刷新按钮 */}
              <button
                onClick={handleRefresh}
                className="p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                title={`上次刷新: ${lastRefresh.toLocaleTimeString()}`}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
              
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
              <div className="w-10 h-10 rounded-xl bg-[#232322] flex items-center justify-center ">
                <span className="text-lg">👨‍🏫</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* 课程选择器 (如果有多个课程) */}
        {availableSessions.length > 1 && (
          <div className="mb-6">
            <label className="block text-sm font-medium text-slate-700 mb-2">
              选择课程
            </label>
            <select
              value={selectedSessionId}
              onChange={(e) => setSelectedSessionId(e.target.value)}
              className="w-full max-w-xs px-4 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {availableSessions.map(session => (
                <option key={session.id} value={session.id}>
                  {session.subject || '未命名课程'} - {new Date(session.createdAt).toLocaleDateString()}
                </option>
              ))}
              <option value="demo-session">演示数据</option>
            </select>
          </div>
        )}

        {/* 课程信息卡片 */}
        <div className="mb-8 p-6 bg-white/80 rounded-2xl border border-slate-200/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-[#232322] flex items-center justify-center ">
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
                    {lesson.totalStudents > 0 ? `${lesson.totalStudents} 名学生` : '暂无学生数据'}
                  </span>
                </div>
              </div>
            </div>
            
            {/* 统计数据 */}
            <div className="flex items-center gap-6">
              <div className="text-center">
                <div className="text-3xl font-bold text-[#787774]">{lesson.hotspots.length}</div>
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
              <div className="w-8 h-8 rounded-lg bg-[#232322] flex items-center justify-center ">
                <span className="text-sm">🔥</span>
              </div>
              <h2 className="text-lg font-bold text-slate-900">困惑热点 TOP3</h2>
            </div>
            <p className="text-sm text-slate-500">
              {isRealData ? '来自学生实时标记' : '学生最困惑的知识点'}
            </p>
          </div>
          
          {lesson.hotspots.length > 0 ? (
            <div className="grid md:grid-cols-3 gap-5">
              {lesson.hotspots.slice(0, 3).map((hotspot, index) => (
                <ConfusionHotspotCard 
                  key={`${hotspot.rank}-${hotspot.startMs}`} 
                  hotspot={hotspot}
                  isTop={index === 0}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-12 bg-white/50 rounded-2xl border border-dashed border-slate-300">
              <span className="text-4xl mb-3 block">🎉</span>
              <p className="text-slate-600">暂无困惑点，学生们都听懂了！</p>
            </div>
          )}
        </section>

        {/* 课后反思生成器 */}
        <section>
          <div className="flex items-center gap-3 mb-5">
            <div className="w-8 h-8 rounded-lg bg-[#232322] flex items-center justify-center ">
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
