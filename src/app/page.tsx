'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Recorder } from '@/components/Recorder';
import { TimelineView } from '@/components/TimelineView';
import { AITutor } from '@/components/AITutor';
import { ActionList } from '@/components/ActionList';
import { Header } from '@/components/Header';
import { ServiceStatus, DegradedModeBanner } from '@/components/ServiceStatus';

import { WaveformPlayer, type WaveformPlayerRef, type WaveformAnchor } from '@/components/WaveformPlayer';
import { HighlightsPanel } from '@/components/HighlightsPanel';
import { SummaryPanel } from '@/components/SummaryPanel';
import { NotesPanel } from '@/components/NotesPanel';
import { AudioUploader } from '@/components/AudioUploader';
import { AnchorDetailPanel } from '@/components/AnchorDetailPanel';
import { anchorService, type Anchor } from '@/lib/services/anchor-service';
import { memoryService, type ClassTimeline } from '@/lib/services/memory-service';
import { checkServices, type ServiceStatus as ServiceStatusType } from '@/lib/services/health-check';
import { getPreference, setPreference } from '@/lib/db';
import type { TranscriptSegment, HighlightTopic, ClassSummary, Note, TopicGenerationMode, NoteSource, NoteMetadata } from '@/types';
import { DEMO_SEGMENTS, DEMO_ANCHORS, DEMO_AUDIO_URL } from '@/fixtures/demo-data';

type ViewMode = 'record' | 'review';
type DataSource = 'live' | 'demo';

type ReviewTab = 'timeline' | 'highlights' | 'summary' | 'notes' | 'anchor-detail';

// 持久化状态的 key
const APP_STATE_KEY = 'app_last_state';
const TUTOR_STATE_KEY = 'tutor_last_state';

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
  const [dataSource, setDataSource] = useState<DataSource>('live');
  const [serviceStatus, setServiceStatus] = useState<ServiceStatusType | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  
  // 新增状态：精选片段、摘要、笔记
  const [reviewTab, setReviewTab] = useState<ReviewTab>('timeline');
  const [highlightTopics, setHighlightTopics] = useState<HighlightTopic[]>([]);
  const [selectedTopic, setSelectedTopic] = useState<HighlightTopic | null>(null);
  const [isLoadingTopics, setIsLoadingTopics] = useState(false);
  const [classSummary, setClassSummary] = useState<ClassSummary | null>(null);
  const [isLoadingSummary, setIsLoadingSummary] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [isPlayingAll, setIsPlayingAll] = useState(false);
  const [playAllIndex, setPlayAllIndex] = useState(0);
  
  const liveSegmentsRef = useRef<TranscriptSegment[]>([]);
  const waveformRef = useRef<WaveformPlayerRef>(null);
  const hasRestoredState = useRef(false);  // 是否已恢复状态

  // 保存应用状态到 IndexedDB
  const saveAppState = useCallback(async () => {
    if (viewMode !== 'review') return;
    
    try {
      await setPreference(APP_STATE_KEY, {
        viewMode,
        sessionId,
        selectedAnchorId: selectedAnchor?.id,
        reviewTab,
        currentTime,
        savedAt: Date.now(),
      });
    } catch (err) {
      console.error('Failed to save app state:', err);
    }
  }, [viewMode, sessionId, selectedAnchor?.id, reviewTab, currentTime]);

  // 当关键状态变化时保存
  useEffect(() => {
    if (hasRestoredState.current && viewMode === 'review') {
      saveAppState();
    }
  }, [selectedAnchor?.id, reviewTab, saveAppState, viewMode]);

  // 初始化 - 恢复状态（仅在首次加载时执行）
  useEffect(() => {
    // 防止重复初始化
    if (hasRestoredState.current) return;
    
    const initializeApp = async () => {
      checkServices().then(setServiceStatus);
      
      const savedAnchors = anchorService.getActive(sessionId);
      setAnchors(savedAnchors);

      // 尝试从 IndexedDB 恢复上次状态
      let restoredAnchorId: string | null = null;
      let restoredReviewTab: ReviewTab | null = null;
      let restoredViewMode: ViewMode | null = null;
      
      try {
        const savedAppState = await getPreference<{
          viewMode: ViewMode;
          sessionId: string;
          selectedAnchorId?: string;
          reviewTab?: ReviewTab;
          currentTime?: number;
          savedAt: number;
        } | null>(APP_STATE_KEY, null);
        
        // 检查是否是最近 24 小时内的状态
        if (savedAppState && Date.now() - savedAppState.savedAt < 24 * 60 * 60 * 1000) {
          restoredAnchorId = savedAppState.selectedAnchorId || null;
          restoredReviewTab = savedAppState.reviewTab || null;
          restoredViewMode = savedAppState.viewMode || null;
          
          if (savedAppState.currentTime) {
            setCurrentTime(savedAppState.currentTime);
          }
        }
      } catch (err) {
        console.error('Failed to restore app state:', err);
      }

      // 确定最终的 viewMode
      const finalViewMode = restoredViewMode || 'record';
      
      // 仅在复习模式下加载演示数据
      if (finalViewMode === 'review') {
        setViewMode('review');
        setSegments(DEMO_SEGMENTS);
        setAudioUrl(DEMO_AUDIO_URL);
        setAnchors(DEMO_ANCHORS);
        
        const tl = memoryService.buildTimeline(
          sessionId,
          DEMO_SEGMENTS,
          DEMO_ANCHORS,
          { subject: '数学', teacher: '张老师', date: new Date().toISOString().split('T')[0] }
        );
        setTimeline(tl);
        
        // 恢复选中的困惑点
        if (restoredAnchorId) {
          const restoredAnchor = DEMO_ANCHORS.find(a => a.id === restoredAnchorId);
          if (restoredAnchor) {
            setSelectedAnchor(restoredAnchor);
            setCurrentTime(restoredAnchor.timestamp);
          }
        } else {
          const firstUnresolved = DEMO_ANCHORS.find(a => !a.resolved);
          if (firstUnresolved) {
            setSelectedAnchor(firstUnresolved);
            setCurrentTime(firstUnresolved.timestamp);
          }
        }
        
        // 恢复标签页
        if (restoredReviewTab) {
          setReviewTab(restoredReviewTab);
        }
      }
      
      hasRestoredState.current = true;
    };
    
    initializeApp();
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRecordingStart = useCallback((newSessionId: string) => {
    setSessionId(newSessionId);
    setIsRecording(true);
    setSegments([]);
    setAnchors([]);
    setDataSource('live');
    setAudioUrl(null); // 清除示例音频URL
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

  // 回放时添加困惑点标注
  const handlePlaybackAnchorAdd = useCallback((timestamp: number) => {
    const anchor = anchorService.mark(sessionId, 'student-1', timestamp, 'confusion');
    setAnchors(prev => [...prev, anchor]);
    setSelectedAnchor(anchor);
    
    if (timeline) {
      setTimeline({ ...timeline, anchors: [...timeline.anchors, anchor] });
    }
    
    // 自动切换到困惑点详情面板
    setReviewTab('anchor-detail');
  }, [sessionId, timeline]);

  const handleAnchorSelect = useCallback((anchor: Anchor) => {
    setSelectedAnchor(anchor);
    setCurrentTime(anchor.timestamp);
    // 自动切换到困惑点详情面板
    setReviewTab('anchor-detail');
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

  // 生成精选片段
  const handleGenerateTopics = useCallback(async (mode: TopicGenerationMode) => {
    if (segments.length === 0) {
      console.warn('无转录内容，无法生成精选片段');
      return;
    }
    
    setIsLoadingTopics(true);
    try {
      console.log('[生成精选片段] 开始，模式:', mode, '片段数:', segments.length);
      
      const response = await fetch('/api/generate-topics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          transcript: segments.map(s => ({
            id: s.id,
            text: s.text,
            startMs: s.startMs,
            endMs: s.endMs,
            confidence: s.confidence
          })),
          mode,
          sessionInfo: {
            subject: '数学',
            topic: '二次函数'
          }
        })
      });
      
      const data = await response.json();
      console.log('[生成精选片段] 响应:', data);
      
      if (data.success && data.topics) {
        setHighlightTopics(data.topics);
        console.log('[生成精选片段] 成功，生成', data.topics.length, '个片段');
      } else {
        console.error('[生成精选片段] 失败:', data.error);
        alert(`生成失败: ${data.error || '未知错误'}`);
      }
    } catch (error) {
      console.error('生成精选片段失败:', error);
      alert(`生成失败: ${error instanceof Error ? error.message : '网络错误'}`);
    } finally {
      setIsLoadingTopics(false);
    }
  }, [sessionId, segments]);

  // 按主题重新生成片段
  const handleRegenerateByTheme = useCallback(async (theme: string) => {
    if (segments.length === 0) return;
    
    setIsLoadingTopics(true);
    try {
      const response = await fetch('/api/generate-topics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          transcript: segments.map(s => ({
            id: s.id,
            text: s.text,
            startMs: s.startMs,
            endMs: s.endMs
          })),
          mode: 'smart',
          theme,
          sessionInfo: { subject: '数学' }
        })
      });
      
      const data = await response.json();
      if (data.success && data.topics) {
        setHighlightTopics(data.topics);
      }
    } catch (error) {
      console.error('按主题生成失败:', error);
    } finally {
      setIsLoadingTopics(false);
    }
  }, [sessionId, segments]);

  // 生成课堂摘要
  const handleGenerateSummary = useCallback(async () => {
    if (segments.length === 0) return;
    
    setIsLoadingSummary(true);
    try {
      const response = await fetch('/api/generate-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          transcript: segments.map(s => ({
            id: s.id,
            text: s.text,
            startMs: s.startMs,
            endMs: s.endMs
          })),
          sessionInfo: {
            subject: '数学',
            topic: '二次函数'
          }
        })
      });
      
      const data = await response.json();
      if (data.success && data.summary) {
        setClassSummary({
          ...data.summary,
          sessionId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      }
    } catch (error) {
      console.error('生成摘要失败:', error);
    } finally {
      setIsLoadingSummary(false);
    }
  }, [sessionId, segments]);

  // 播放精选片段
  const handlePlayTopic = useCallback((topic: HighlightTopic) => {
    if (topic.segments.length > 0) {
      const startTime = topic.segments[0].start;
      setCurrentTime(startTime);
      if (waveformRef.current) {
        waveformRef.current.seekTo(startTime);
        waveformRef.current.play();
      }
    }
  }, []);

  // 清空精选片段
  const handleClearTopics = useCallback(() => {
    setHighlightTopics([]);
    setSelectedTopic(null);
  }, []);

  // 播放全部片段
  const handlePlayAll = useCallback(() => {
    if (isPlayingAll) {
      setIsPlayingAll(false);
      return;
    }
    
    if (highlightTopics.length > 0) {
      setIsPlayingAll(true);
      setPlayAllIndex(0);
      handlePlayTopic(highlightTopics[0]);
    }
  }, [isPlayingAll, highlightTopics, handlePlayTopic]);

  // 添加笔记
  const handleAddNote = useCallback((text: string, source: NoteSource = 'custom', metadata?: NoteMetadata) => {
    const newNote: Note = {
      id: crypto.randomUUID(),
      sessionId,
      studentId: 'student-1',
      source,
      text,
      metadata,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    setNotes(prev => [newNote, ...prev]);
  }, [sessionId]);

  // 更新笔记
  const handleUpdateNote = useCallback((noteId: string, text: string) => {
    setNotes(prev => prev.map(n => 
      n.id === noteId ? { ...n, text, updatedAt: new Date().toISOString() } : n
    ));
  }, []);

  // 删除笔记
  const handleDeleteNote = useCallback((noteId: string) => {
    setNotes(prev => prev.filter(n => n.id !== noteId));
  }, []);

  // 处理 AI 家教生成的行动清单
  const handleActionItemsUpdate = useCallback((items: ActionItem[]) => {
    setActionItems(items);
  }, []);

  // 计算总时长
  const totalDuration = segments.length > 0 
    ? segments[segments.length - 1].endMs 
    : 0;

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
          <div className="w-full max-w-2xl space-y-6">
            {/* 录音或上传切换 */}
            <div className="flex items-center justify-center gap-4 mb-4">
              <span className="text-sm text-gray-500">选择输入方式：</span>
              <div className="flex items-center gap-2 p-1 bg-gray-100 rounded-xl">
                <button
                  onClick={() => setDataSource('live')}
                  className={`px-4 py-2 text-sm rounded-lg transition-all ${
                    dataSource === 'live'
                      ? 'bg-white text-gray-900 font-medium shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  🎙️ 实时录音
                </button>
                <button
                  onClick={() => setDataSource('demo')}
                  className={`px-4 py-2 text-sm rounded-lg transition-all ${
                    dataSource === 'demo'
                      ? 'bg-white text-gray-900 font-medium shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  📁 上传音频
                </button>
              </div>
            </div>

            {dataSource === 'live' ? (
              <Recorder
                onRecordingStart={handleRecordingStart}
                onRecordingStop={handleRecordingStop}
                onTranscriptUpdate={handleTranscriptUpdate}
                onAnchorMark={handleAnchorMark}
              />
            ) : (
              <div className="card p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <span>📁</span>
                  上传课堂录音
                </h3>
                <AudioUploader
                  onTranscriptReady={(newSegments, blob) => {
                    setSegments(newSegments);
                    setAudioBlob(blob);
                    setAudioUrl(null); // 清除示例音频URL
                    setDataSource('live');
                    
                    // 构建时间轴
                    const tl = memoryService.buildTimeline(
                      sessionId,
                      newSegments,
                      anchors,
                      { subject: '数学', teacher: '张老师', date: new Date().toISOString().split('T')[0] }
                    );
                    setTimeline(tl);
                    
                    // 自动切换到复习模式
                    setViewMode('review');
                  }}
                  onError={(error) => {
                    console.error('上传失败:', error);
                  }}
                  disabled={isRecording}
                />
                <p className="mt-4 text-sm text-gray-500 text-center">
                  支持 MP3、WAV、WebM 等格式，上传后自动转录并进入复习模式
                </p>
              </div>
            )}
            
            {/* 已标记的困惑点 */}
            {anchors.length > 0 && (
              <div className="card p-5 animate-slide-up">
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
          {/* 左栏 - 多功能面板 */}
          <div className="w-96 border-r border-gray-100 flex flex-col glass">
            {/* 标签页切换 */}
            <div className="flex items-center gap-1 px-4 py-2 border-b border-gray-100 bg-gray-50/50 overflow-x-auto">
              <button
                onClick={() => setReviewTab('timeline')}
                className={`px-3 py-1.5 text-sm rounded-lg transition-all whitespace-nowrap ${
                  reviewTab === 'timeline'
                    ? 'bg-white text-gray-900 font-medium shadow-sm'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-white/50'
                }`}
              >
                📋 时间轴
              </button>
              <button
                onClick={() => setReviewTab('anchor-detail')}
                className={`px-3 py-1.5 text-sm rounded-lg transition-all whitespace-nowrap ${
                  reviewTab === 'anchor-detail'
                    ? 'bg-white text-gray-900 font-medium shadow-sm'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-white/50'
                }`}
              >
                🎯 困惑点
                {selectedAnchor && !selectedAnchor.resolved && (
                  <span className="ml-1 w-2 h-2 bg-red-500 rounded-full inline-block animate-pulse" />
                )}
              </button>
              <button
                onClick={() => setReviewTab('highlights')}
                className={`px-3 py-1.5 text-sm rounded-lg transition-all whitespace-nowrap ${
                  reviewTab === 'highlights'
                    ? 'bg-white text-gray-900 font-medium shadow-sm'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-white/50'
                }`}
              >
                ⚡ 精选
                {highlightTopics.length > 0 && (
                  <span className="ml-1 text-xs text-blue-600">({highlightTopics.length})</span>
                )}
              </button>
              <button
                onClick={() => setReviewTab('summary')}
                className={`px-3 py-1.5 text-sm rounded-lg transition-all whitespace-nowrap ${
                  reviewTab === 'summary'
                    ? 'bg-white text-gray-900 font-medium shadow-sm'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-white/50'
                }`}
              >
                📝 摘要
                {classSummary && <span className="ml-1 text-xs text-green-600">✓</span>}
              </button>
              <button
                onClick={() => setReviewTab('notes')}
                className={`px-3 py-1.5 text-sm rounded-lg transition-all whitespace-nowrap ${
                  reviewTab === 'notes'
                    ? 'bg-white text-gray-900 font-medium shadow-sm'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-white/50'
                }`}
              >
                📄 笔记
                {notes.length > 0 && (
                  <span className="ml-1 text-xs text-purple-600">({notes.length})</span>
                )}
              </button>
            </div>
            
            {/* 标签页内容 */}
            <div className="flex-1 min-h-0 overflow-hidden">
              {reviewTab === 'timeline' && timelineForView && (
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
              
              {reviewTab === 'anchor-detail' && (
                <AnchorDetailPanel
                  anchor={selectedAnchor}
                  segments={segments}
                  onSeek={(timeMs) => {
                    setCurrentTime(timeMs);
                    waveformRef.current?.seekTo(timeMs);
                  }}
                  onPlay={(startMs) => {
                    waveformRef.current?.seekTo(startMs);
                    waveformRef.current?.play();
                  }}
                  onResolve={handleResolveAnchor}
                  onAskAI={() => {
                    // AI 家教已经是默认模式，无需切换
                  }}
                  onAddNote={(text, anchorId) => {
                    handleAddNote(text, 'anchor', {
                      anchorId,
                      timestamp: selectedAnchor?.timestamp,
                    });
                  }}
                  onClose={() => setReviewTab('timeline')}
                />
              )}
              
              {reviewTab === 'highlights' && (
                <HighlightsPanel
                  topics={highlightTopics}
                  selectedTopic={selectedTopic}
                  onTopicSelect={setSelectedTopic}
                  onPlayTopic={handlePlayTopic}
                  onSeek={handleTimelineClick}
                  onPlayAll={handlePlayAll}
                  isPlayingAll={isPlayingAll}
                  playAllIndex={playAllIndex}
                  currentTime={currentTime}
                  totalDuration={totalDuration}
                  isLoading={isLoadingTopics}
                  onGenerate={handleGenerateTopics}
                  onRegenerateByTheme={handleRegenerateByTheme}
                  onClear={handleClearTopics}
                />
              )}
              
              {reviewTab === 'summary' && (
                <SummaryPanel
                  summary={classSummary}
                  isLoading={isLoadingSummary}
                  onGenerate={handleGenerateSummary}
                  onSeek={handleTimelineClick}
                  onAddNote={(text, takeaway) => {
                    handleAddNote(text, 'takeaways', {
                      selectedText: takeaway.label,
                      extra: { timestamps: takeaway.timestamps }
                    });
                  }}
                />
              )}
              
              {reviewTab === 'notes' && (
                <NotesPanel
                  notes={notes}
                  onAddNote={handleAddNote}
                  onUpdateNote={handleUpdateNote}
                  onDeleteNote={handleDeleteNote}
                  onSeek={handleTimelineClick}
                />
              )}
            </div>
          </div>

          {/* 中栏 - AI 对话 */}
          <div className="flex-1 flex flex-col min-h-0 bg-white">
            {/* 波形播放器 */}
            {(audioBlob || audioUrl) && (
              <div className="p-4 border-b border-gray-100">
                <WaveformPlayer
                  ref={waveformRef}
                  src={audioBlob || audioUrl || undefined}
                  anchors={anchors.map(a => ({
                    id: a.id,
                    timestamp: a.timestamp,
                    resolved: a.resolved,
                    type: a.type,
                  } as WaveformAnchor))}
                  onTimeUpdate={setCurrentTime}
                  onAnchorClick={(anchor) => {
                    const found = anchors.find(a => a.id === anchor.id);
                    if (found) handleAnchorSelect(found);
                  }}
                  onAnchorAdd={handlePlaybackAnchorAdd}
                  allowAddAnchor={true}
                  selectedAnchorId={selectedAnchor?.id}
                  height={60}
                />
              </div>
            )}
            
            {/* AI 家教区 */}
            <div className="flex-1 min-h-0">
              <AITutor
                breakpoint={selectedBreakpoint}
                segments={segments}
                isLoading={false}
                onResolve={handleResolveAnchor}
                onActionItemsUpdate={handleActionItemsUpdate}
                sessionId={sessionId}
                onSeek={(timeMs) => {
                  setCurrentTime(timeMs);
                  waveformRef.current?.seekTo(timeMs);
                  waveformRef.current?.play();
                }}
              />
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
