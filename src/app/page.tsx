'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Recorder } from '@/components/Recorder';
import { TimelineView } from '@/components/TimelineView';
import { AITutor } from '@/components/AITutor';
import { ActionList } from '@/components/ActionList';
import { Header } from '@/components/Header';
import { ServiceStatus, DegradedModeBanner } from '@/components/ServiceStatus';
import { AIChat } from '@/components/AIChat';
import { WaveformPlayer, type WaveformPlayerRef, type WaveformAnchor } from '@/components/WaveformPlayer';
import { anchorService, type Anchor } from '@/lib/services/anchor-service';
import { memoryService, type ClassTimeline } from '@/lib/services/memory-service';
import { checkServices, type ServiceStatus as ServiceStatusType } from '@/lib/services/health-check';
import type { TranscriptSegment } from '@/types';

// Mock 数据（用于演示，当没有真实转录时使用）
const DEMO_SEGMENTS: TranscriptSegment[] = [
  { id: 's1', text: '今天我们来学习二次函数的图像', startMs: 0, endMs: 15000, confidence: 0.95 },
  { id: 's2', text: '二次函数的一般形式是 y = ax² + bx + c', startMs: 15000, endMs: 35000, confidence: 0.92 },
  { id: 's3', text: '其中 a 不等于 0，a 的正负决定了抛物线的开口方向', startMs: 35000, endMs: 60000, confidence: 0.94 },
  { id: 's4', text: '当 a 大于 0 时，抛物线开口向上', startMs: 60000, endMs: 85000, confidence: 0.96 },
  { id: 's5', text: '当 a 小于 0 时，抛物线开口向下', startMs: 85000, endMs: 110000, confidence: 0.93 },
  { id: 's6', text: '顶点坐标公式是 (-b/2a, (4ac-b²)/4a)', startMs: 110000, endMs: 150000, confidence: 0.91 },
  { id: 's7', text: '这个公式很重要，大家要记住', startMs: 150000, endMs: 170000, confidence: 0.97 },
  { id: 's8', text: '我们来看一个例题', startMs: 170000, endMs: 190000, confidence: 0.95 },
  { id: 's9', text: '求 y = 2x² - 4x + 1 的顶点坐标', startMs: 190000, endMs: 220000, confidence: 0.94 },
  { id: 's10', text: '首先 a = 2, b = -4, c = 1', startMs: 220000, endMs: 250000, confidence: 0.96 },
  { id: 's11', text: '代入公式 x = -b/2a = 4/4 = 1', startMs: 250000, endMs: 280000, confidence: 0.93 },
  { id: 's12', text: 'y = 2(1)² - 4(1) + 1 = -1', startMs: 280000, endMs: 310000, confidence: 0.92 },
  { id: 's13', text: '所以顶点坐标是 (1, -1)', startMs: 310000, endMs: 340000, confidence: 0.98 },
];

type ViewMode = 'record' | 'review';
type DataSource = 'live' | 'demo';
type ChatMode = 'tutor' | 'chat'; // 新增：AI 对话模式切换

interface ActionItem {
  id: string;
  type: 'replay' | 'exercise' | 'review';
  title: string;
  description: string;
  estimatedMinutes: number;
  completed: boolean;
  relatedTimestamp?: number;
}

export default function StudentApp() {
  // 状态
  const [viewMode, setViewMode] = useState<ViewMode>('record');
  const [sessionId, setSessionId] = useState<string>('demo-session');
  const [isRecording, setIsRecording] = useState(false);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [anchors, setAnchors] = useState<Anchor[]>([]);
  const [timeline, setTimeline] = useState<ClassTimeline | null>(null);
  const [selectedAnchor, setSelectedAnchor] = useState<Anchor | null>(null);
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [dataSource, setDataSource] = useState<DataSource>('demo');
  const [chatMode, setChatMode] = useState<ChatMode>('tutor');
  const [serviceStatus, setServiceStatus] = useState<ServiceStatusType | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  
  // 保存录音期间的转录数据
  const liveSegmentsRef = useRef<TranscriptSegment[]>([]);
  const waveformRef = useRef<WaveformPlayerRef>(null);

  // 加载演示数据（仅在 demo 模式下）
  useEffect(() => {
    // 检查服务状态
    checkServices().then(setServiceStatus);
    
    // 加载本地存储的断点
    const savedAnchors = anchorService.getActive(sessionId);
    setAnchors(savedAnchors);

    // 如果没有录音数据，使用演示数据
    if (segments.length === 0) {
      const demoSegments = DEMO_SEGMENTS;
      setSegments(demoSegments);
      setDataSource('demo');
      
      // 构建时间轴
      const tl = memoryService.buildTimeline(
        sessionId,
        demoSegments,
        savedAnchors,
        {
          subject: '数学',
          teacher: '张老师',
          date: new Date().toISOString().split('T')[0],
        }
      );
      setTimeline(tl);
    }

    // 选中第一个未解决的断点
    const firstUnresolved = savedAnchors.find(a => !a.resolved);
    if (firstUnresolved) {
      setSelectedAnchor(firstUnresolved);
      setCurrentTime(firstUnresolved.timestamp);
    }
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // 录音开始
  const handleRecordingStart = useCallback((newSessionId: string) => {
    setSessionId(newSessionId);
    setIsRecording(true);
    setSegments([]);
    setAnchors([]);
    setDataSource('live');
    liveSegmentsRef.current = [];
    anchorService.clear(newSessionId);
  }, []);

  // 录音停止
  const handleRecordingStop = useCallback((blob?: Blob) => {
    setIsRecording(false);
    
    // 保存音频 Blob
    if (blob) {
      setAudioBlob(blob);
    }
    
    // 使用当前 segments 状态（已通过 handleTranscriptUpdate 更新）
    // 如果 segments 为空或仍是 DEMO 数据，则使用 liveSegmentsRef
    const currentSegments = segments.length > 0 && segments !== DEMO_SEGMENTS 
      ? segments 
      : liveSegmentsRef.current;
    
    const finalSegments = currentSegments.length > 0 
      ? currentSegments 
      : DEMO_SEGMENTS;
    
    const isLiveData = currentSegments.length > 0;
    
    setSegments(finalSegments);
    setDataSource(isLiveData ? 'live' : 'demo');
    
    // 构建时间轴
    const tl = memoryService.buildTimeline(
      sessionId,
      finalSegments,
      anchors,
      {
        subject: '数学',
        teacher: '张老师',
        date: new Date().toISOString().split('T')[0],
      }
    );
    setTimeline(tl);
    memoryService.save(tl);
    
    // 切换到复习模式
    setViewMode('review');
  }, [sessionId, anchors, segments]);

  // 转录更新（录音期间实时调用）
  const handleTranscriptUpdate = useCallback((newSegments: TranscriptSegment[]) => {
    // 保存到 ref，避免频繁触发重渲染
    liveSegmentsRef.current = newSegments;
    // 同时更新状态用于显示
    setSegments(newSegments);
    setDataSource('live');
  }, []);

  // 标记断点
  const handleAnchorMark = useCallback((timestamp: number) => {
    const anchor = anchorService.mark(sessionId, 'student-1', timestamp, 'confusion');
    setAnchors(prev => [...prev, anchor]);
    
    // 更新时间轴
    if (timeline) {
      const updatedTimeline = {
        ...timeline,
        anchors: [...timeline.anchors, anchor],
      };
      setTimeline(updatedTimeline);
    }
  }, [sessionId, timeline]);

  // 选择断点
  const handleAnchorSelect = useCallback((anchor: Anchor) => {
    setSelectedAnchor(anchor);
    setCurrentTime(anchor.timestamp);
  }, []);

  // 解决断点
  const handleResolveAnchor = useCallback(() => {
    if (!selectedAnchor) return;
    
    anchorService.resolve(selectedAnchor.id, sessionId);
    
    setAnchors(prev => prev.map(a => 
      a.id === selectedAnchor.id ? { ...a, resolved: true } : a
    ));
    
    setSelectedAnchor({ ...selectedAnchor, resolved: true });
    
    if (timeline) {
      setTimeline({
        ...timeline,
        anchors: timeline.anchors.map(a =>
          a.id === selectedAnchor.id ? { ...a, resolved: true } : a
        ),
      });
    }
  }, [selectedAnchor, sessionId, timeline]);

  // 时间轴点击
  const handleTimelineClick = useCallback((timeMs: number) => {
    setCurrentTime(timeMs);
    // 同步波形播放器
    waveformRef.current?.seekTo(timeMs);
  }, []);

  // 行动项完成
  const handleActionComplete = useCallback((actionId: string) => {
    setActionItems(prev => prev.map(item =>
      item.id === actionId ? { ...item, completed: !item.completed } : item
    ));
  }, []);

  // 转换 Timeline 格式以适配 TimelineView
  const timelineForView = timeline ? {
    lessonId: timeline.lessonId,
    segments: timeline.segments.map(s => ({
      id: s.id,
      text: s.text,
      startMs: s.startMs,
      endMs: s.endMs,
    })),
    breakpoints: timeline.anchors.map(a => ({
      id: a.id,
      lessonId: timeline.lessonId,
      studentId: a.studentId,
      timestamp: a.timestamp,
      type: a.type as 'confusion' | 'important' | 'question',
      resolved: a.resolved,
      createdAt: a.createdAt,
    })),
    topics: memoryService.extractTopics(timeline.segments).map(t => ({
      id: t.id,
      title: t.title,
      startMs: t.startMs,
      endMs: t.endMs,
    })),
  } : null;

  // 选中的断点转换格式
  const selectedBreakpoint = selectedAnchor ? {
    id: selectedAnchor.id,
    lessonId: sessionId,
    studentId: selectedAnchor.studentId,
    timestamp: selectedAnchor.timestamp,
    type: selectedAnchor.type as 'confusion' | 'important' | 'question',
    resolved: selectedAnchor.resolved,
    createdAt: selectedAnchor.createdAt,
  } : null;

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* 降级模式横幅 */}
      <DegradedModeBanner status={serviceStatus} />
      
      {/* 顶部导航 */}
      <Header 
        lessonTitle={viewMode === 'record' ? '课堂录音' : '二次函数的图像与性质'}
        courseName="数学"
      />

      {/* 模式切换 */}
      <div className="bg-white border-b border-gray-200 px-4 py-2">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setViewMode('record')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              viewMode === 'record'
                ? 'bg-primary-100 text-primary-700'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            🎙️ 录音模式
          </button>
          <button
            onClick={() => setViewMode('review')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              viewMode === 'review'
                ? 'bg-primary-100 text-primary-700'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            📚 复习模式
          </button>
          
          {/* 服务状态指示器 */}
          <div className="ml-2">
            <ServiceStatus compact pollInterval={60000} />
          </div>
          
          {/* 断点统计 */}
          <div className="ml-auto flex items-center gap-4 text-sm">
            {/* 数据来源指示 */}
            <span className={`px-2 py-1 rounded text-xs ${
              dataSource === 'live' 
                ? 'bg-green-100 text-green-700' 
                : 'bg-yellow-100 text-yellow-700'
            }`}>
              {dataSource === 'live' ? '🎙️ 实时转录' : '📋 演示数据'}
            </span>
            <span className="text-gray-500">
              断点: <span className="font-medium text-gray-900">{anchors.length}</span>
            </span>
            <span className="text-gray-500">
              未解决: <span className="font-medium text-red-600">
                {anchors.filter(a => !a.resolved).length}
              </span>
            </span>
          </div>
        </div>
      </div>

      {/* 主体内容 */}
      {viewMode === 'record' ? (
        // 录音模式
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="w-full max-w-xl">
            <Recorder
              onRecordingStart={handleRecordingStart}
              onRecordingStop={handleRecordingStop}
              onTranscriptUpdate={handleTranscriptUpdate}
              onAnchorMark={handleAnchorMark}
            />
            
            {/* 断点列表 */}
            {anchors.length > 0 && (
              <div className="mt-6 bg-white rounded-xl shadow-sm border border-gray-200 p-4">
                <h3 className="text-sm font-semibold text-gray-900 mb-3">
                  已标记的困惑点 ({anchors.length})
                </h3>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {anchors.map((anchor, index) => (
                    <div
                      key={anchor.id}
                      className="flex items-center gap-3 p-2 bg-gray-50 rounded-lg"
                    >
                      <div className={`w-2 h-2 rounded-full ${
                        anchor.resolved ? 'bg-green-500' : 'bg-red-500'
                      }`} />
                      <span className="text-sm font-mono text-gray-600">
                        {formatTime(anchor.timestamp)}
                      </span>
                      <span className="text-sm text-gray-500">
                        困惑点 #{index + 1}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        // 复习模式 - 三栏布局
        <div className="flex-1 min-h-0 flex overflow-hidden">
          {/* 左栏 - 时间轴 */}
          <div className="w-80 border-r border-gray-200 flex flex-col bg-white">
            {timelineForView && (
              <TimelineView
                timeline={timelineForView}
                currentTime={currentTime}
                selectedBreakpoint={selectedBreakpoint}
                onTimeClick={handleTimelineClick}
                onBreakpointClick={(bp) => {
                  const anchor = anchors.find(a => a.id === bp.id);
                  if (anchor) handleAnchorSelect(anchor);
                }}
              />
            )}
          </div>

          {/* 中栏 - AI 家教对话 + 波形播放器 */}
          <div className="flex-1 flex flex-col min-h-0 bg-white">
            {/* 波形播放器 */}
            {audioBlob && (
              <div className="p-4 border-b border-gray-200">
                <WaveformPlayer
                  ref={waveformRef}
                  src={audioBlob}
                  anchors={anchors.map(a => ({
                    id: a.id,
                    timestamp: a.timestamp,
                    resolved: a.resolved,
                  } as WaveformAnchor))}
                  onTimeUpdate={setCurrentTime}
                  onAnchorClick={(anchor) => {
                    const found = anchors.find(a => a.id === anchor.id);
                    if (found) handleAnchorSelect(found);
                  }}
                  height={60}
                />
              </div>
            )}
            
            {/* AI 对话模式切换 */}
            <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100">
              <button
                onClick={() => setChatMode('tutor')}
                className={`px-3 py-1 text-sm rounded-full transition-colors ${
                  chatMode === 'tutor'
                    ? 'bg-indigo-100 text-indigo-700'
                    : 'text-gray-500 hover:bg-gray-100'
                }`}
              >
                🎓 AI 家教
              </button>
              <button
                onClick={() => setChatMode('chat')}
                className={`px-3 py-1 text-sm rounded-full transition-colors ${
                  chatMode === 'chat'
                    ? 'bg-indigo-100 text-indigo-700'
                    : 'text-gray-500 hover:bg-gray-100'
                }`}
              >
                💬 自由对话
              </button>
            </div>
            
            {/* AI 对话区域 */}
            <div className="flex-1 min-h-0">
              {chatMode === 'tutor' ? (
                <AITutor
                  breakpoint={selectedBreakpoint}
                  segments={segments}
                  isLoading={false}
                  onResolve={handleResolveAnchor}
                />
              ) : (
                <AIChat
                  anchorId={selectedAnchor?.id}
                  anchorTimestamp={selectedAnchor?.timestamp}
                  contextText={segments.map(s => s.text).join(' ')}
                  onTimestampClick={handleTimelineClick}
                />
              )}
            </div>
          </div>

          {/* 右栏 - 行动清单 */}
          <div className="w-80 border-l border-gray-200 bg-white">
            <ActionList
              items={actionItems}
              onComplete={handleActionComplete}
            />
          </div>
        </div>
      )}
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
