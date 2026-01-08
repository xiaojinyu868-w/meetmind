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

// Demo 数据
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
type ChatMode = 'tutor' | 'chat';

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
  
  const liveSegmentsRef = useRef<TranscriptSegment[]>([]);
  const waveformRef = useRef<WaveformPlayerRef>(null);

  // 初始化
  useEffect(() => {
    checkServices().then(setServiceStatus);
    
    const savedAnchors = anchorService.getActive(sessionId);
    setAnchors(savedAnchors);

    if (segments.length === 0) {
      setSegments(DEMO_SEGMENTS);
      setDataSource('demo');
      
      const tl = memoryService.buildTimeline(
        sessionId,
        DEMO_SEGMENTS,
        savedAnchors,
        { subject: '数学', teacher: '张老师', date: new Date().toISOString().split('T')[0] }
      );
      setTimeline(tl);
    }

    const firstUnresolved = savedAnchors.find(a => !a.resolved);
    if (firstUnresolved) {
      setSelectedAnchor(firstUnresolved);
      setCurrentTime(firstUnresolved.timestamp);
    }
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRecordingStart = useCallback((newSessionId: string) => {
    setSessionId(newSessionId);
    setIsRecording(true);
    setSegments([]);
    setAnchors([]);
    setDataSource('live');
    liveSegmentsRef.current = [];
    anchorService.clear(newSessionId);
  }, []);

  const handleRecordingStop = useCallback((blob?: Blob) => {
    setIsRecording(false);
    if (blob) setAudioBlob(blob);
    
    const currentSegments = segments.length > 0 && segments !== DEMO_SEGMENTS 
      ? segments 
      : liveSegmentsRef.current;
    
    const finalSegments = currentSegments.length > 0 ? currentSegments : DEMO_SEGMENTS;
    const isLiveData = currentSegments.length > 0;
    
    setSegments(finalSegments);
    setDataSource(isLiveData ? 'live' : 'demo');
    
    const tl = memoryService.buildTimeline(
      sessionId,
      finalSegments,
      anchors,
      { subject: '数学', teacher: '张老师', date: new Date().toISOString().split('T')[0] }
    );
    setTimeline(tl);
    memoryService.save(tl);
    setViewMode('review');
  }, [sessionId, anchors, segments]);

  const handleTranscriptUpdate = useCallback((newSegments: TranscriptSegment[]) => {
    liveSegmentsRef.current = newSegments;
    setSegments(newSegments);
    setDataSource('live');
  }, []);

  const handleAnchorMark = useCallback((timestamp: number) => {
    const anchor = anchorService.mark(sessionId, 'student-1', timestamp, 'confusion');
    setAnchors(prev => [...prev, anchor]);
    
    if (timeline) {
      setTimeline({ ...timeline, anchors: [...timeline.anchors, anchor] });
    }
  }, [sessionId, timeline]);

  const handleAnchorSelect = useCallback((anchor: Anchor) => {
    setSelectedAnchor(anchor);
    setCurrentTime(anchor.timestamp);
  }, []);

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

  const handleTimelineClick = useCallback((timeMs: number) => {
    setCurrentTime(timeMs);
    waveformRef.current?.seekTo(timeMs);
  }, []);

  const handleActionComplete = useCallback((actionId: string) => {
    setActionItems(prev => prev.map(item =>
      item.id === actionId ? { ...item, completed: !item.completed } : item
    ));
  }, []);

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

  const selectedBreakpoint = selectedAnchor ? {
    id: selectedAnchor.id,
    lessonId: sessionId,
    studentId: selectedAnchor.studentId,
    timestamp: selectedAnchor.timestamp,
    type: selectedAnchor.type as 'confusion' | 'important' | 'question',
    resolved: selectedAnchor.resolved,
    createdAt: selectedAnchor.createdAt,
  } : null;

  const unresolvedCount = anchors.filter(a => !a.resolved).length;

  return (
    <div className="h-screen flex flex-col">
      <DegradedModeBanner status={serviceStatus} />
      
      <Header 
        lessonTitle={viewMode === 'record' ? '课堂录音' : '二次函数的图像与性质'}
        courseName="数学"
      />

      {/* 模式切换栏 */}
      <div className="glass border-b border-white/20 px-6 py-3 no-print">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 p-1 bg-gray-100/80 rounded-xl">
            <button
              onClick={() => setViewMode('record')}
              className={`mode-tab ${viewMode === 'record' ? 'active' : ''}`}
            >
              <span className="mr-1.5">🎙️</span>
              录音
            </button>
            <button
              onClick={() => setViewMode('review')}
              className={`mode-tab ${viewMode === 'review' ? 'active' : ''}`}
            >
              <span className="mr-1.5">📚</span>
              复习
            </button>
          </div>
          
          <div className="flex items-center gap-4">
            <ServiceStatus compact pollInterval={60000} />
            
            <div className="flex items-center gap-3 text-sm">
              <span className={`badge ${dataSource === 'live' ? 'badge-live' : 'badge-demo'}`}>
                {dataSource === 'live' ? '🎙️ 实时' : '📋 演示'}
              </span>
              
              <div className="flex items-center gap-2 text-gray-500">
                <span>困惑点</span>
                <span className="font-semibold text-gray-900">{anchors.length}</span>
                {unresolvedCount > 0 && (
                  <>
                    <span>·</span>
                    <span className="text-rose-500 font-semibold">{unresolvedCount} 待解决</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 主内容区 */}
      {viewMode === 'record' ? (
        <div className="flex-1 flex items-center justify-center p-8 page-enter">
          <div className="w-full max-w-lg">
            <Recorder
              onRecordingStart={handleRecordingStart}
              onRecordingStop={handleRecordingStop}
              onTranscriptUpdate={handleTranscriptUpdate}
              onAnchorMark={handleAnchorMark}
            />
            
            {/* 已标记的困惑点 */}
            {anchors.length > 0 && (
              <div className="mt-6 card p-5 animate-slide-up">
                <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <span>🎯</span>
                  已标记的困惑点
                  <span className="ml-auto text-xs font-normal text-gray-400">{anchors.length} 个</span>
                </h3>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {anchors.map((anchor, index) => (
                    <div
                      key={anchor.id}
                      className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors"
                    >
                      <div className={`w-2.5 h-2.5 rounded-full ${
                        anchor.resolved ? 'bg-emerald-400' : 'bg-rose-400'
                      }`} />
                      <span className="text-sm font-mono text-gray-600">
                        {formatTime(anchor.timestamp)}
                      </span>
                      <span className="text-sm text-gray-500">
                        困惑点 #{index + 1}
                      </span>
                      {anchor.resolved && (
                        <span className="ml-auto text-xs text-emerald-600">已解决</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex overflow-hidden page-enter">
          {/* 左栏 - 时间轴 */}
          <div className="w-80 border-r border-gray-100 flex flex-col glass">
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

          {/* 中栏 - AI 对话 */}
          <div className="flex-1 flex flex-col min-h-0 bg-white">
            {/* 波形播放器 */}
            {audioBlob && (
              <div className="p-4 border-b border-gray-100">
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
            
            {/* 对话模式切换 */}
            <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-100">
              <button
                onClick={() => setChatMode('tutor')}
                className={`px-4 py-1.5 text-sm rounded-full transition-all ${
                  chatMode === 'tutor'
                    ? 'bg-rose-100 text-rose-700 font-medium'
                    : 'text-gray-500 hover:bg-gray-100'
                }`}
              >
                🎓 AI 家教
              </button>
              <button
                onClick={() => setChatMode('chat')}
                className={`px-4 py-1.5 text-sm rounded-full transition-all ${
                  chatMode === 'chat'
                    ? 'bg-accent-100 text-accent-700 font-medium'
                    : 'text-gray-500 hover:bg-gray-100'
                }`}
              >
                💬 自由对话
              </button>
            </div>
            
            {/* AI 对话区 */}
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
          <div className="w-80 border-l border-gray-100 glass">
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

function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(minutes)}:${pad(seconds % 60)}`;
}
