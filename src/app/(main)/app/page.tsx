'use client';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import dynamic from 'next/dynamic';
import { Header } from '@/components/Header';
import { ServiceStatus, DegradedModeBanner } from '@/components/ServiceStatus';
import { anchorService, type Anchor } from '@/lib/services/anchor-service';
import { memoryService, type ClassTimeline } from '@/lib/services/memory-service';
import { checkServices, type ServiceStatus as ServiceStatusType } from '@/lib/services/health-check';
import { getPreference, setPreference, db, generateSessionId, saveAudioSession, addTranscripts, ANONYMOUS_USER_ID } from '@/lib/db';
import { useAuth } from '@/lib/hooks/useAuth';
import { classroomDataService, type StudentAnchor } from '@/lib/services/classroom-data-service';
import type { TranscriptSegment, HighlightTopic, ClassSummary, Note, TopicGenerationMode, NoteSource, NoteMetadata } from '@/types';
import { useResponsive } from '@/hooks/useResponsive';
import { UIConfig } from '@/lib/config';

// SWR 数据 Hooks - 统一管理 API 请求
import { useTopics, useSummary } from '@/hooks/data';

// WaveformPlayer 使用 forwardRef，需要静态导入以支持 ref
import { WaveformPlayer, type WaveformPlayerRef, type WaveformAnchor } from '@/components/WaveformPlayer';

// 开屏动画组件
import { AppLoading } from '@/components/AppLoading';

// 动态导入大型组件 - 代码分割优化
const Recorder = dynamic(() => import('@/components/Recorder').then(m => ({ default: m.Recorder })), {
  ssr: false,
  loading: () => <div className="h-32 bg-gray-100 animate-pulse rounded-xl" />
});

const TimelineView = dynamic(() => import('@/components/TimelineView').then(m => ({ default: m.TimelineView })), {
  loading: () => <div className="h-64 bg-gray-50 animate-pulse rounded-lg" />
});

const AITutor = dynamic(() => import('@/components/AITutor').then(m => ({ default: m.AITutor })), {
  ssr: false,
  loading: () => <div className="h-96 bg-gray-50 animate-pulse rounded-lg" />
});

const ActionList = dynamic(() => import('@/components/ActionList').then(m => ({ default: m.ActionList })));
const ActionSidebar = dynamic(() => import('@/components/ActionSidebar').then(m => ({ default: m.ActionSidebar })));
const ActionDrawer = dynamic(() => import('@/components/ActionDrawer').then(m => ({ default: m.ActionDrawer })));
const ResizablePanel = dynamic(() => import('@/components/layout/ResizablePanel').then(m => ({ default: m.ResizablePanel })));

const HighlightsPanel = dynamic(() => import('@/components/HighlightsPanel').then(m => ({ default: m.HighlightsPanel })));
const SummaryPanel = dynamic(() => import('@/components/SummaryPanel').then(m => ({ default: m.SummaryPanel })));
const NotesPanel = dynamic(() => import('@/components/NotesPanel').then(m => ({ default: m.NotesPanel })));
const AudioUploader = dynamic(() => import('@/components/AudioUploader').then(m => ({ default: m.AudioUploader })), { ssr: false });
const AnchorDetailPanel = dynamic(() => import('@/components/AnchorDetailPanel').then(m => ({ default: m.AnchorDetailPanel })));
const ConversationList = dynamic(() => import('@/components/ConversationHistory').then(m => ({ default: m.ConversationList })));
const AIChat = dynamic(() => import('@/components/AIChat').then(m => ({ default: m.AIChat })), { ssr: false });
const SessionHistoryList = dynamic(() => import('@/components/SessionHistoryList').then(m => ({ default: m.SessionHistoryList })));

import type { ConfusionMarker } from '@/components/mobile/PodcastPlayer';
import type { ConversationHistory } from '@/types/conversation';
import type { AudioSession } from '@/lib/db';

// 演示数据延迟加载
let DEMO_DATA_CACHE: { DEMO_SEGMENTS: TranscriptSegment[]; DEMO_ANCHORS: Anchor[]; DEMO_AUDIO_URL: string } | null = null;
const loadDemoData = async () => {
  if (DEMO_DATA_CACHE) return DEMO_DATA_CACHE;
  const data = await import('@/fixtures/demo-data');
  DEMO_DATA_CACHE = {
    DEMO_SEGMENTS: data.DEMO_SEGMENTS,
    DEMO_ANCHORS: data.DEMO_ANCHORS,
    DEMO_AUDIO_URL: data.DEMO_AUDIO_URL,
  };
  return DEMO_DATA_CACHE;
};

// 移动端组件导入 - 直接导入避免 barrel file 导致的 tree-shaking 失效
import { MiniPlayer } from '@/components/mobile/MiniPlayer';
import { MobileTabSwitch } from '@/components/mobile/MobileTabSwitch';
import { DedaoTimeline, toDedaoEntries } from '@/components/mobile/DedaoTimeline';
import { DedaoConfusionCard } from '@/components/mobile/DedaoConfusionCard';
import { DedaoMenu, DedaoMenuButton } from '@/components/mobile/DedaoMenu';

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
  // 开屏动画状态
  const [showSplash, setShowSplash] = useState(true);
  const [appReady, setAppReady] = useState(false);
  
  // 获取当前登录用户
  const { user, isAuthenticated } = useAuth();
  
  // 响应式状态
  const { isMobile, mounted } = useResponsive();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedConfusion, setSelectedConfusion] = useState<ConfusionMarker | null>(null);
  const [mobileSubPage, setMobileSubPage] = useState<'highlights' | 'summary' | 'notes' | 'tasks' | 'ai-chat' | null>(null);
  const [mobileAIQuestion, setMobileAIQuestion] = useState<string>(''); // 移动端AI对话的初始问题
  
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
  // 使用 SWR Hooks 管理精选片段和摘要 - 自动去重、缓存、重试
  const { 
    topics: highlightTopics, 
    selectedTopic, 
    isLoading: isLoadingTopics, 
    generate: generateTopics,
    regenerateByTheme,
    setSelectedTopic,
    clear: clearTopics
  } = useTopics({ sessionId, segments });
  
  const {
    summary: classSummary,
    isLoading: isLoadingSummary,
    generate: generateSummary,
    clear: clearSummary,
  } = useSummary({ sessionId, segments });
  
  const [notes, setNotes] = useState<Note[]>([]);
  const [isPlayingAll, setIsPlayingAll] = useState(false);
  const [playAllIndex, setPlayAllIndex] = useState(0);
  
  // 历史对话相关状态
  const [showConversationHistory, setShowConversationHistory] = useState(false);
  const [selectedHistoryConversation, setSelectedHistoryConversation] = useState<ConversationHistory | null>(null);
  
  // 录音历史相关状态
  const [showSessionHistory, setShowSessionHistory] = useState(false);
  
  // 行动清单抽屉状态
  const [isActionDrawerOpen, setIsActionDrawerOpen] = useState(false);
  
  const liveSegmentsRef = useRef<TranscriptSegment[]>([]);
  const waveformRef = useRef<WaveformPlayerRef>(null);
  const hasRestoredState = useRef(false);  // 是否已恢复状态
  
  // 获取当前用户的 studentId 和 studentName
  const studentId = user?.id || 'anonymous';
  const studentName = user?.nickname || user?.username || '匿名用户';

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
  // 优化：使用并行加载和批量操作提升性能
  useEffect(() => {
    // 防止重复初始化
    if (hasRestoredState.current) return;
    
    const initializeApp = async () => {
      // 第一批并行操作：服务检查 + 状态恢复 + anchors 获取
      const [, savedAppState, savedAnchors] = await Promise.all([
        checkServices().then(setServiceStatus),
        getPreference<{
          viewMode: ViewMode;
          sessionId: string;
          selectedAnchorId?: string;
          reviewTab?: ReviewTab;
          currentTime?: number;
          savedAt: number;
        } | null>(APP_STATE_KEY, null).catch(() => null),
        Promise.resolve(anchorService.getActive(sessionId)),
      ]);
      
      setAnchors(savedAnchors);

      // 解析恢复的状态
      let restoredAnchorId: string | null = null;
      let restoredReviewTab: ReviewTab | null = null;
      let restoredViewMode: ViewMode | null = null;
      
      // 检查是否是最近 24 小时内的状态
      if (savedAppState && Date.now() - savedAppState.savedAt < 24 * 60 * 60 * 1000) {
        restoredAnchorId = savedAppState.selectedAnchorId || null;
        restoredReviewTab = savedAppState.reviewTab || null;
        restoredViewMode = savedAppState.viewMode || null;
        
        if (savedAppState.currentTime) {
          setCurrentTime(savedAppState.currentTime);
        }
      }

      // 确定最终的 viewMode
      const finalViewMode = restoredViewMode || 'record';
      
      // 仅在复习模式下加载演示数据
      if (finalViewMode === 'review') {
        setViewMode('review');
        
        // 第二批并行操作：加载演示数据 + 检查已有转录
        const [demoData, existingTranscriptCount] = await Promise.all([
          loadDemoData(),
          db.transcripts.where('sessionId').equals(sessionId).count().catch(() => 0),
        ]);
        
        // 立即设置 UI 状态（让用户更快看到内容）
        setSegments(demoData.DEMO_SEGMENTS);
        setAudioUrl(demoData.DEMO_AUDIO_URL);
        setAnchors(demoData.DEMO_ANCHORS);
        
        // 构建时间轴（同步操作，优先完成）
        const tl = memoryService.buildTimeline(
          sessionId,
          demoData.DEMO_SEGMENTS,
          demoData.DEMO_ANCHORS,
          { subject: UIConfig.defaultSubject, teacher: 'Demo Teacher', date: new Date().toISOString().split('T')[0] }
        );
        setTimeline(tl);
        
        // 恢复选中的困惑点
        if (restoredAnchorId) {
          const restoredAnchor = demoData.DEMO_ANCHORS.find(a => a.id === restoredAnchorId);
          if (restoredAnchor) {
            setSelectedAnchor(restoredAnchor);
            setCurrentTime(restoredAnchor.timestamp);
          }
        } else {
          const firstUnresolved = demoData.DEMO_ANCHORS.find(a => !a.resolved);
          if (firstUnresolved) {
            setSelectedAnchor(firstUnresolved);
            setCurrentTime(firstUnresolved.timestamp);
          }
        }
        
        // 恢复标签页
        if (restoredReviewTab) {
          setReviewTab(restoredReviewTab);
        }
        
        // 第三批：后台异步写入（不阻塞 UI）
        // 使用 queueMicrotask 延迟执行，让 UI 先渲染
        queueMicrotask(() => {
          // 保存会话信息
          classroomDataService.saveSession({
            id: sessionId,
            subject: UIConfig.defaultSubject,
            topic: 'Australia\'s Moving Experience',
            teacherName: 'Demo Teacher',
            duration: demoData.DEMO_SEGMENTS.length > 0 ? demoData.DEMO_SEGMENTS[demoData.DEMO_SEGMENTS.length - 1].endMs : 0,
            status: 'completed',
            createdBy: studentId,
          });
          
          // 批量保存演示困惑点（优化：一次性处理）
          const anchorsToAdd = demoData.DEMO_ANCHORS.map(anchor => {
            const contextSegments = demoData.DEMO_SEGMENTS.filter(
              s => s.startMs <= anchor.timestamp + 5000 && s.endMs >= anchor.timestamp - 5000
            );
            const transcriptContext = contextSegments.map(s => s.text).join(' ').slice(0, 200);
            return {
              id: anchor.id,
              timestamp: anchor.timestamp,
              type: anchor.type,
              transcriptContext,
            };
          });
          classroomDataService.bulkSaveStudentAnchors(sessionId, studentId, studentName, anchorsToAdd);
          
          // 保存转录到 IndexedDB（如果不存在）
          if (existingTranscriptCount === 0) {
            db.transcripts.bulkAdd(
              demoData.DEMO_SEGMENTS.map(seg => ({
                sessionId: sessionId,
                userId: ANONYMOUS_USER_ID, // demo 数据使用匿名用户
                text: seg.text,
                startMs: seg.startMs,
                endMs: seg.endMs,
                confidence: seg.confidence || 1.0,
                isFinal: true,
              }))
            ).catch(e => console.error('保存演示转录到 IndexedDB 失败:', e));
          }
        });
      }
      
      // 标记应用已准备就绪
      setAppReady(true);
      hasRestoredState.current = true;
    };
    
    initializeApp();
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // 处理开屏动画完成
  const handleSplashComplete = useCallback(() => {
    setShowSplash(false);
  }, []);

  const handleRecordingStart = useCallback((newSessionId: string) => {
    // 清除旧会话的所有状态
    setSessionId(newSessionId);
    setIsRecording(true);
    setSegments([]);
    setAnchors([]);
    setSelectedAnchor(null); // 清除选中的困惑点
    clearTopics(); // 清除精选片段（使用 SWR Hook）
    clearSummary(); // 清除摘要（使用 SWR Hook）
    setNotes([]); // 清除笔记
    setActionItems([]); // 清除行动清单
    setTimeline(null); // 清除时间轴
    setDataSource('live');
    setAudioUrl(null); // 清除示例音频URL
    setAudioBlob(null); // 清除音频 blob
    liveSegmentsRef.current = [];
    anchorService.clear(newSessionId);
    // 清理历史对话相关状态
    setShowConversationHistory(false);
    setSelectedHistoryConversation(null);
    
    // 创建课程会话记录 (供教师端读取)
    classroomDataService.saveSession({
      id: newSessionId,
      subject: UIConfig.defaultSubject,
      topic: UIConfig.defaultLessonTitle,
      status: 'recording',
      duration: 0,
      createdBy: studentId,
    });
  }, [studentId]);

  const handleRecordingStop = useCallback((blob?: Blob) => {
    setIsRecording(false);
    if (blob) setAudioBlob(blob);
    
    // 使用 liveSegmentsRef 判断是否有实时转录数据
    const currentSegments = liveSegmentsRef.current.length > 0 
      ? liveSegmentsRef.current 
      : segments;
    
    const hasLiveData = liveSegmentsRef.current.length > 0;
    const finalSegments = currentSegments;
    
    setSegments(finalSegments);
    setDataSource(hasLiveData ? 'live' : 'demo');
    
    // 计算课程时长
    const duration = finalSegments.length > 0 
      ? finalSegments[finalSegments.length - 1].endMs 
      : 0;
    
    // 更新课程会话状态
    classroomDataService.saveSession({
      id: sessionId,
      subject: UIConfig.defaultSubject,
      topic: UIConfig.defaultLessonTitle,
      teacherName: UIConfig.defaultTeacher || 'Teacher',
      status: 'completed',
      duration,
    });
    
    // 保存音频和转录到 IndexedDB 历史记录
    if (blob && hasLiveData) {
      const currentUserId = user?.id || ANONYMOUS_USER_ID;
      
      // 保存音频
      saveAudioSession(blob, sessionId, currentUserId, {
        subject: UIConfig.defaultSubject,
        topic: UIConfig.defaultLessonTitle,
        duration,
      }).catch(err => console.error('保存录音到历史失败:', err));
      
      // 保存转录到 IndexedDB（供历史记录加载）
      addTranscripts(sessionId, currentUserId, finalSegments.map((seg) => ({
        text: seg.text,
        startMs: seg.startMs,
        endMs: seg.endMs,
        confidence: seg.confidence || 1.0,
        isFinal: true,
      }))).catch(err => console.error('保存转录到 IndexedDB 失败:', err));
    }
    
    const tl = memoryService.buildTimeline(
      sessionId,
      finalSegments,
      anchors,
      { subject: UIConfig.defaultSubject, teacher: UIConfig.defaultTeacher || 'Teacher', date: new Date().toISOString().split('T')[0] }
    );
    setTimeline(tl);
    memoryService.save(tl);
    setViewMode('review');
  }, [sessionId, anchors, segments, user]);

  // 处理 viewMode 切换，同时清理历史对话相关状态
  // 如果切换到复习模式且没有数据，自动加载 demo 数据
  const handleViewModeChange = useCallback(async (newMode: 'record' | 'review') => {
    setViewMode(newMode);
    // 切换模式时清理历史对话面板状态
    setShowConversationHistory(false);
    setSelectedHistoryConversation(null);
    setShowSessionHistory(false);
    
    // 切换到复习模式时，如果没有数据则加载 demo
    if (newMode === 'review' && segments.length === 0) {
      try {
        const demoData = await loadDemoData();
        setSegments(demoData.DEMO_SEGMENTS);
        setAudioUrl(demoData.DEMO_AUDIO_URL);
        setAnchors(demoData.DEMO_ANCHORS);
        setDataSource('demo');
        
        // 构建时间轴
        const tl = memoryService.buildTimeline(
          sessionId,
          demoData.DEMO_SEGMENTS,
          demoData.DEMO_ANCHORS,
          { subject: UIConfig.defaultSubject, teacher: 'Demo Teacher', date: new Date().toISOString().split('T')[0] }
        );
        setTimeline(tl);
        
        // 选中第一个未解决的困惑点
        const firstUnresolved = demoData.DEMO_ANCHORS.find(a => !a.resolved);
        if (firstUnresolved) {
          setSelectedAnchor(firstUnresolved);
          setCurrentTime(firstUnresolved.timestamp);
        }
      } catch (err) {
        console.error('Failed to load demo data:', err);
      }
    }
  }, [segments.length, sessionId]);

  // 从历史记录加载会话并进入复习模式
  const handleLoadHistorySession = useCallback(async (session: AudioSession) => {
    try {
      // 清除旧会话状态
      setSessionId(session.sessionId);
      setAnchors([]);
      setSelectedAnchor(null);
      clearTopics();
      clearSummary();
      setNotes([]);
      setActionItems([]);
      liveSegmentsRef.current = [];
      setShowSessionHistory(false);
      
      // 从 IndexedDB 加载转录数据
      const transcripts = await db.transcripts
        .where('sessionId')
        .equals(session.sessionId)
        .toArray();
      
      // 按时间排序
      const sortedTranscripts = transcripts.sort((a, b) => a.startMs - b.startMs);
      const loadedSegments: TranscriptSegment[] = sortedTranscripts.map(t => ({
        text: t.text,
        startMs: t.startMs,
        endMs: t.endMs,
        confidence: t.confidence,
        isFinal: t.isFinal,
      }));
      
      setSegments(loadedSegments);
      
      // 从 IndexedDB 加载困惑点
      const loadedAnchors = await db.anchors
        .where('sessionId')
        .equals(session.sessionId)
        .toArray();
      
      // 转换为 Anchor 类型
      const anchorsWithResolved = loadedAnchors.map(a => ({
        id: a.id?.toString() || '',
        sessionId: a.sessionId,
        studentId: '',
        timestamp: a.timestamp,
        type: a.type,
        resolved: a.status === 'resolved',
        note: a.note,
        aiExplanation: a.aiExplanation,
        createdAt: a.createdAt.toISOString(),
      }));
      setAnchors(anchorsWithResolved);
      
      // 创建音频 URL
      if (session.blob) {
        const url = URL.createObjectURL(session.blob);
        setAudioUrl(url);
        setAudioBlob(session.blob);
      }
      
      setDataSource('live');
      
      // 构建时间轴
      const tl = memoryService.buildTimeline(
        session.sessionId,
        loadedSegments,
        anchorsWithResolved,
        { 
          subject: session.subject || UIConfig.defaultSubject, 
          teacher: UIConfig.defaultTeacher || 'Teacher', 
          date: new Date(session.createdAt).toISOString().split('T')[0] 
        }
      );
      setTimeline(tl);
      
      // 切换到复习模式
      setViewMode('review');
      
      console.log(`已加载历史会话: ${session.sessionId}, 转录: ${loadedSegments.length} 条, 困惑点: ${anchorsWithResolved.length} 个`);
    } catch (err) {
      console.error('加载历史会话失败:', err);
      alert('加载历史会话失败，请重试');
    }
  }, [clearTopics, clearSummary]);

  const handleTranscriptUpdate = useCallback((newSegments: TranscriptSegment[]) => {
    liveSegmentsRef.current = newSegments;
    setSegments(newSegments);
    setDataSource('live');
  }, []);

  const handleAnchorMark = useCallback((timestamp: number) => {
    // 修正时间戳：如果 segments 存在，将 anchor 时间戳对齐到最近的 segment
    // 这是因为前端 elapsedMs 和后端 ASR 时间戳可能存在偏差
    let alignedTimestamp = timestamp;
    if (segments.length > 0) {
      // 找到最近的 segment（优先找包含该时间点的，否则找最接近的）
      let nearestSeg = segments[0];
      let minDistance = Math.abs(timestamp - (nearestSeg.startMs + nearestSeg.endMs) / 2);
      
      for (const seg of segments) {
        // 如果时间点在 segment 范围内，直接使用
        if (timestamp >= seg.startMs && timestamp <= seg.endMs) {
          alignedTimestamp = timestamp; // 在范围内，保持原值
          nearestSeg = seg;
          break;
        }
        // 否则找最近的
        const segMid = (seg.startMs + seg.endMs) / 2;
        const distance = Math.abs(timestamp - segMid);
        if (distance < minDistance) {
          minDistance = distance;
          nearestSeg = seg;
        }
      }
      
      // 如果原始时间戳超出 segments 范围较多（>5秒），对齐到最近 segment
      const lastSeg = segments[segments.length - 1];
      if (timestamp > lastSeg.endMs + 5000) {
        alignedTimestamp = lastSeg.endMs;
        console.log('[AnchorMark] Timestamp aligned:', timestamp, '->', alignedTimestamp, '(was beyond segments range)');
      } else if (timestamp < segments[0].startMs - 5000) {
        alignedTimestamp = segments[0].startMs;
        console.log('[AnchorMark] Timestamp aligned:', timestamp, '->', alignedTimestamp, '(was before segments range)');
      }
    }
    
    // 同时写入旧版 anchor-service (保持兼容) 和新版共享存储
    const anchor = anchorService.mark(sessionId, studentId, alignedTimestamp, 'confusion');
    setAnchors(prev => [...prev, anchor]);
    
    // 获取当前时间点附近的转录内容作为上下文
    const contextSegments = segments.filter(
      s => s.startMs <= alignedTimestamp + 5000 && s.endMs >= alignedTimestamp - 5000
    );
    const transcriptContext = contextSegments.map(s => s.text).join(' ').slice(0, 200);
    
    // 写入共享存储 (供教师端读取)
    classroomDataService.saveStudentAnchor(
      sessionId,
      studentId,
      studentName,
      alignedTimestamp,
      'confusion',
      transcriptContext
    );
    
    if (timeline) {
      setTimeline({ ...timeline, anchors: [...timeline.anchors, anchor] });
    }
  }, [sessionId, studentId, studentName, timeline, segments]);

  // 回放时添加困惑点标注
  const handlePlaybackAnchorAdd = useCallback((timestamp: number) => {
    // 回放时 timestamp 来自波形播放位置，通常与 segments 对齐
    // 但仍做校验确保在有效范围内
    let alignedTimestamp = timestamp;
    if (segments.length > 0) {
      const lastSeg = segments[segments.length - 1];
      if (timestamp > lastSeg.endMs) {
        alignedTimestamp = lastSeg.endMs;
      } else if (timestamp < segments[0].startMs) {
        alignedTimestamp = segments[0].startMs;
      }
    }
    
    const anchor = anchorService.mark(sessionId, studentId, alignedTimestamp, 'confusion');
    setAnchors(prev => [...prev, anchor]);
    setSelectedAnchor(anchor);
    
    // 获取转录上下文
    const contextSegments = segments.filter(
      s => s.startMs <= alignedTimestamp + 5000 && s.endMs >= alignedTimestamp - 5000
    );
    const transcriptContext = contextSegments.map(s => s.text).join(' ').slice(0, 200);
    
    // 写入共享存储
    classroomDataService.saveStudentAnchor(
      sessionId,
      studentId,
      studentName,
      alignedTimestamp,
      'confusion',
      transcriptContext
    );
    
    if (timeline) {
      setTimeline({ ...timeline, anchors: [...timeline.anchors, anchor] });
    }
    
    // 自动切换到困惑点详情面板
    setReviewTab('anchor-detail');
  }, [sessionId, studentId, studentName, timeline, segments]);

  const handleAnchorSelect = useCallback((anchor: Anchor) => {
    setSelectedAnchor(anchor);
    setCurrentTime(anchor.timestamp);
    // 自动切换到困惑点详情面板
    setReviewTab('anchor-detail');
  }, []);

  const handleResolveAnchor = useCallback(() => {
    if (!selectedAnchor) return;
    
    anchorService.resolve(selectedAnchor.id, sessionId);
    
    // 同步更新共享存储
    classroomDataService.resolveAnchor(selectedAnchor.id);
    
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

  // 生成精选片段 - 使用 SWR Hook（自动请求去重、缓存、重试）
  const handleGenerateTopics = useCallback(async (mode: TopicGenerationMode) => {
    try {
      console.log('[生成精选片段] 开始，模式:', mode, '片段数:', segments.length);
      await generateTopics(mode);
      console.log('[生成精选片段] 完成');
    } catch (error) {
      console.error('生成精选片段失败:', error);
      alert(`生成失败: ${error instanceof Error ? error.message : '网络错误'}`);
    }
  }, [segments.length, generateTopics]);

  // 按主题重新生成片段 - 使用 SWR Hook
  const handleRegenerateByTheme = useCallback(async (theme: string) => {
    try {
      await regenerateByTheme(theme);
    } catch (error) {
      console.error('按主题生成失败:', error);
    }
  }, [regenerateByTheme]);

  // 生成课堂摘要 - 使用 SWR Hook
  const handleGenerateSummary = useCallback(async () => {
    try {
      await generateSummary();
    } catch (error) {
      console.error('生成摘要失败:', error);
    }
  }, [generateSummary]);

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

  // 清空精选片段 - 使用 SWR Hook
  const handleClearTopics = useCallback(() => {
    clearTopics();
  }, [clearTopics]);

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
      studentId,
      source,
      text,
      metadata,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    setNotes(prev => [newNote, ...prev]);
  }, [sessionId, studentId]);

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

  // 客户端未挂载时显示加载状态，避免 Hydration 错误
  if (!mounted) {
    return <AppLoading message="准备学习环境" />;
  }

  // 显示开屏动画（等待应用准备就绪）
  if (showSplash) {
    return (
      <AppLoading 
        message={appReady ? "即将就绪" : undefined}
        onComplete={appReady ? handleSplashComplete : undefined}
      />
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden main-content-enter">
      {/* 移动端隐藏降级横幅 */}
      {!isMobile && <DegradedModeBanner status={serviceStatus} />}
      
      {/* 桌面端 Header - 移动端隐藏 */}
      {!isMobile && (
        <Header 
          lessonTitle={viewMode === 'record' ? '课堂录音' : '课堂回顾'}
          courseName=""
        />
      )}

      {/* 桌面端模式切换栏 - 移动端隐藏 */}
      {!isMobile && (
        <div className="border-b px-6 py-3 no-print" style={{ background: 'var(--edu-bg-secondary)', borderColor: 'var(--edu-border-light)' }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 p-1 rounded-xl" style={{ background: 'var(--edu-bg-soft)' }}>
              <button
                onClick={() => handleViewModeChange('record')}
                className={`mode-tab ${viewMode === 'record' ? 'active' : ''}`}
              >
                <span className="mr-1.5">🎙️</span>
                录音
              </button>
              <button
                onClick={() => handleViewModeChange('review')}
                className={`mode-tab ${viewMode === 'review' ? 'active' : ''}`}
              >
                <span className="mr-1.5">📚</span>
                复习
              </button>
            </div>
            
              <div className="flex items-center gap-4">
              <ServiceStatus compact pollInterval={60000} />
              
              <div className="flex items-center gap-3 text-sm min-w-0 flex-wrap">
                <span className={`badge ${dataSource === 'live' ? 'badge-live' : 'badge-demo'} flex-shrink-0`}>
                  {dataSource === 'live' ? '🎙️ 实时' : '📋 演示'}
                </span>
                
                <div className="flex items-center gap-2 text-gray-500 min-w-0 flex-wrap">
                  <span className="whitespace-nowrap">困惑点</span>
                  <span className="font-semibold text-navy">{anchors.length}</span>
                  {unresolvedCount > 0 && (
                    <>
                      <span>·</span>
                      <span className="text-coral-500 font-semibold whitespace-nowrap">{unresolvedCount} 待解决</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 主内容区 */}
      {viewMode === 'record' ? (
        <>
          {/* 移动端录音页面 - 得到风格 */}
          {isMobile ? (
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden" style={{ background: 'var(--edu-bg-primary)' }}>
              {/* 极简顶部栏：Logo + Tab + 菜单 */}
              <div className="flex-shrink-0 px-4 py-2.5 flex items-center gap-3 bg-white border-b" style={{ borderColor: 'var(--edu-border-light)' }}>
                {/* Logo */}
                <div className="w-8 h-8 bg-gradient-to-br from-amber-400 to-amber-500 rounded-lg flex items-center justify-center flex-shrink-0">
                  <span className="text-white font-bold text-sm">M</span>
                </div>
                
                {/* Tab 切换 */}
                <div className="flex-1 flex items-center justify-center">
                  <MobileTabSwitch
                    activeTab={viewMode}
                    onTabChange={(tab) => handleViewModeChange(tab)}
                    className="w-full max-w-[180px]"
                  />
                </div>
                
                {/* 菜单按钮 */}
                <DedaoMenuButton onClick={() => setIsMenuOpen(true)} />
              </div>

              {/* 录音内容区 */}
              <div className="flex-1 flex flex-col items-center justify-center p-4 overflow-auto">
                <div className="w-full max-w-md space-y-4">
                  {/* 录音或上传切换 */}
                  <div className="flex items-center justify-center gap-2 mb-2">
                    <span className="text-xs text-gray-500">选择输入方式：</span>
                    <div className="flex items-center gap-1 p-0.5 bg-gray-100 rounded-xl">
                      <button
                        onClick={() => { setDataSource('live'); setShowSessionHistory(false); }}
                        className={`px-3 py-1.5 text-xs rounded-lg transition-all ${
                          dataSource === 'live' && !showSessionHistory
                            ? 'bg-white text-gray-900 font-medium shadow-sm'
                            : 'text-gray-500 hover:text-gray-700'
                        }`}
                      >
                        🎙️ 实时录音
                      </button>
                      <button
                        onClick={() => { setDataSource('demo'); setShowSessionHistory(false); }}
                        className={`px-3 py-1.5 text-xs rounded-lg transition-all ${
                          dataSource === 'demo' && !showSessionHistory
                            ? 'bg-white text-gray-900 font-medium shadow-sm'
                            : 'text-gray-500 hover:text-gray-700'
                        }`}
                      >
                        📁 上传音频
                      </button>
                      <button
                        onClick={() => setShowSessionHistory(true)}
                        className={`px-3 py-1.5 text-xs rounded-lg transition-all ${
                          showSessionHistory
                            ? 'bg-white text-gray-900 font-medium shadow-sm'
                            : 'text-gray-500 hover:text-gray-700'
                        }`}
                      >
                        📋 历史
                      </button>
                    </div>
                  </div>

                  {dataSource === 'live' && !showSessionHistory ? (
                    <Recorder
                      onRecordingStart={handleRecordingStart}
                      onRecordingStop={handleRecordingStop}
                      onTranscriptUpdate={handleTranscriptUpdate}
                      onAnchorMark={handleAnchorMark}
                    />
                  ) : showSessionHistory ? (
                    <div className="card-edu p-0 overflow-hidden" style={{ maxHeight: '400px' }}>
                      <SessionHistoryList
                        userId={user?.id}
                        onSessionSelect={handleLoadHistorySession}
                        onClose={() => setShowSessionHistory(false)}
                        activeSessionId={sessionId}
                        maxHeight="400px"
                        showHeader={false}
                      />
                    </div>
                  ) : (
                    <div className="card-edu p-4">
                      <h3 className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">
                        <span>📁</span>
                        上传课堂录音
                      </h3>
                      <AudioUploader
                        onTranscriptReady={async (newSegments, blob) => {
                          const newSessionId = generateSessionId();
                          // 清除旧会话的所有状态
                          setSessionId(newSessionId);
                          setSegments(newSegments);
                          setAnchors([]); // 清除旧困惑点
                          setSelectedAnchor(null); // 清除选中的困惑点
                          clearTopics(); // 清除精选片段（使用 SWR Hook）
                          clearSummary(); // 清除摘要（使用 SWR Hook）
                          setNotes([]); // 清除笔记
                          setActionItems([]); // 清除行动清单
                          setAudioBlob(blob);
                          setAudioUrl(null);
                          setDataSource('live');
                          liveSegmentsRef.current = [];
                          
                          try {
                            const currentUserId = user?.id || ANONYMOUS_USER_ID;
                            await db.transcripts.bulkAdd(
                              newSegments.map((seg) => ({
                                sessionId: newSessionId,
                                userId: currentUserId,
                                text: seg.text,
                                startMs: seg.startMs,
                                endMs: seg.endMs,
                                confidence: seg.confidence || 1.0,
                                isFinal: true,
                              }))
                            );
                          } catch (e) {
                            console.error('保存转录到 IndexedDB 失败:', e);
                          }
                          
                          const duration = newSegments.length > 0 
                            ? newSegments[newSegments.length - 1].endMs 
                            : 0;
                          classroomDataService.saveSession({
                            id: newSessionId,
                            subject: UIConfig.defaultSubject,
                            topic: UIConfig.defaultLessonTitle,
                            teacherName: UIConfig.defaultTeacher || 'Teacher',
                            status: 'completed',
                            duration,
                            createdBy: studentId,
                          });
                          
                          // 保存上传的音频到 IndexedDB 历史记录
                          if (blob) {
                            const currentUserId = user?.id || ANONYMOUS_USER_ID;
                            saveAudioSession(blob, newSessionId, currentUserId, {
                              subject: UIConfig.defaultSubject,
                              topic: UIConfig.defaultLessonTitle,
                              duration,
                            }).catch(err => console.error('保存上传音频到历史失败:', err));
                          }
                          
                          const tl = memoryService.buildTimeline(
                            newSessionId,
                            newSegments,
                            [], // 新会话没有困惑点
                            { subject: UIConfig.defaultSubject, teacher: UIConfig.defaultTeacher || 'Teacher', date: new Date().toISOString().split('T')[0] }
                          );
                          setTimeline(tl);
                          setViewMode('review');
                        }}
                        onError={(error) => {
                          console.error('上传失败:', error);
                        }}
                        disabled={isRecording}
                      />
                      <p className="mt-3 text-xs text-gray-500 text-center">
                        支持 MP3、WAV、WebM 等格式
                      </p>
                    </div>
                  )}
                  
                  {/* 已标记的困惑点 */}
                  {anchors.length > 0 && (
                    <div className="card-edu p-4 animate-slide-up">
                      <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                        <span>🎯</span>
                        已标记的困惑点
                        <span className="ml-auto text-xs font-normal text-gray-400">{anchors.length} 个</span>
                      </h3>
                      <div className="space-y-2 max-h-32 overflow-y-auto">
                        {anchors.map((anchor, index) => (
                                  <div
                                            key={anchor.id}
                                            className="flex items-center gap-2 p-2 rounded-lg"
                                            style={{ background: 'var(--edu-bg-soft)' }}
                                          >
                                            <div className={`w-2 h-2 rounded-full ${
                                              anchor.resolved ? 'bg-mint' : 'bg-coral'
                                            }`} />
                            <span className="text-xs font-mono text-gray-600">
                              {formatTime(anchor.timestamp)}
                            </span>
                            <span className="text-xs text-gray-500">
                              困惑点 #{index + 1}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* 右侧菜单 */}
              <DedaoMenu
                isOpen={isMenuOpen}
                onClose={() => setIsMenuOpen(false)}
                onNavigate={(page) => setMobileSubPage(page)}
                badges={{
                  highlights: highlightTopics.length,
                  notes: notes.length,
                  tasks: actionItems.filter(i => !i.completed).length,
                }}
              />
            </div>
          ) : (
            /* 桌面端录音页面 - 教育风格 */
            <div className="flex-1 flex items-center justify-center p-8 page-enter relative overflow-hidden" style={{ background: 'var(--edu-bg-primary)' }}>
              {/* 背景装饰 */}
              <div className="absolute top-10 right-10 w-48 h-48 opacity-20 pointer-events-none">
                <img src="/illustrations/learning.svg" alt="" className="w-full h-full" />
              </div>
              <div className="absolute bottom-10 left-10 w-32 h-32 opacity-15 pointer-events-none">
                <img src="/illustrations/ai-tutor.svg" alt="" className="w-full h-full" />
              </div>
              
              <div className="w-full max-w-2xl space-y-6 relative z-10">
                {/* 录音或上传切换 */}
                <div className="flex items-center justify-center gap-4 mb-4">
                  <span className="text-sm text-gray-500">选择输入方式：</span>
              <div className="flex items-center gap-2 p-1 rounded-xl" style={{ background: 'var(--edu-bg-soft)' }}>
                <button
                  onClick={() => { setDataSource('live'); setShowSessionHistory(false); }}
                  className={`px-4 py-2 text-sm rounded-lg transition-all ${
                    dataSource === 'live' && !showSessionHistory
                      ? 'bg-white text-navy font-medium shadow-sm'
                      : 'text-gray-500 hover:text-navy'
                  }`}
                >
                  🎙️ 实时录音
                </button>
                <button
                  onClick={() => { setDataSource('demo'); setShowSessionHistory(false); }}
                  className={`px-4 py-2 text-sm rounded-lg transition-all ${
                    dataSource === 'demo' && !showSessionHistory
                      ? 'bg-white text-navy font-medium shadow-sm'
                      : 'text-gray-500 hover:text-navy'
                  }`}
                >
                  📁 上传音频
                </button>
                <button
                  onClick={() => setShowSessionHistory(true)}
                  className={`px-4 py-2 text-sm rounded-lg transition-all ${
                    showSessionHistory
                      ? 'bg-white text-navy font-medium shadow-sm'
                      : 'text-gray-500 hover:text-navy'
                  }`}
                >
                  📋 录音历史
                </button>
              </div>
            </div>

            {dataSource === 'live' && !showSessionHistory ? (
              <div className="relative">
                {/* 装饰插画 */}
                <div className="absolute -right-20 -top-10 w-24 h-24 opacity-30 pointer-events-none hidden lg:block">
                  <img src="/illustrations/recording.svg" alt="" className="w-full h-full" />
                </div>
                <Recorder
                  onRecordingStart={handleRecordingStart}
                  onRecordingStop={handleRecordingStop}
                  onTranscriptUpdate={handleTranscriptUpdate}
                  onAnchorMark={handleAnchorMark}
                />
              </div>
            ) : showSessionHistory ? (
              <div className="card-edu p-0 overflow-hidden" style={{ maxHeight: '500px' }}>
                <SessionHistoryList
                  userId={user?.id}
                  onSessionSelect={handleLoadHistorySession}
                  onClose={() => setShowSessionHistory(false)}
                  activeSessionId={sessionId}
                  maxHeight="500px"
                  showHeader={false}
                />
              </div>
            ) : (
              <div className="card-edu p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <span>📁</span>
                  上传课堂录音
                </h3>
                <AudioUploader
                  onTranscriptReady={async (newSegments, blob) => {
                    // 生成新的 sessionId（而不是使用默认的 demo-session）
                    const newSessionId = generateSessionId();
                    // 清除旧会话的所有状态
                    setSessionId(newSessionId);
                    setSegments(newSegments);
                    setAnchors([]); // 清除旧困惑点
                    setSelectedAnchor(null); // 清除选中的困惑点
                    clearTopics(); // 清除精选片段（使用 SWR Hook）
                    clearSummary(); // 清除摘要（使用 SWR Hook）
                    setNotes([]); // 清除笔记
                    setActionItems([]); // 清除行动清单
                    setAudioBlob(blob);
                    setAudioUrl(null); // 清除示例音频URL
                    setDataSource('live');
                    liveSegmentsRef.current = [];
                    
                    // 将转录数据保存到 IndexedDB（供教师端读取）
                    try {
                      const currentUserId = user?.id || ANONYMOUS_USER_ID;
                      await db.transcripts.bulkAdd(
                        newSegments.map((seg, idx) => ({
                          sessionId: newSessionId,
                          userId: currentUserId,
                          text: seg.text,
                          startMs: seg.startMs,
                          endMs: seg.endMs,
                          confidence: seg.confidence || 1.0,
                          isFinal: true,
                        }))
                      );
                      console.log(`已保存 ${newSegments.length} 条转录到 IndexedDB, sessionId: ${newSessionId}`);
                    } catch (e) {
                      console.error('保存转录到 IndexedDB 失败:', e);
                    }
                    
                    // 更新 classroomDataService 会话信息（供教师端读取）
                    const duration = newSegments.length > 0 
                      ? newSegments[newSegments.length - 1].endMs 
                      : 0;
                    classroomDataService.saveSession({
                      id: newSessionId,
                      subject: UIConfig.defaultSubject,
                      topic: UIConfig.defaultLessonTitle,
                      teacherName: UIConfig.defaultTeacher || 'Teacher',
                      status: 'completed',
                      duration,
                      createdBy: studentId,
                    });
                    
                    // 保存上传的音频到 IndexedDB 历史记录
                    if (blob) {
                      const currentUserId = user?.id || ANONYMOUS_USER_ID;
                      saveAudioSession(blob, newSessionId, currentUserId, {
                        subject: UIConfig.defaultSubject,
                        topic: UIConfig.defaultLessonTitle,
                        duration,
                      }).catch(err => console.error('保存上传音频到历史失败:', err));
                    }
                    
                    // 构建时间轴
                    const tl = memoryService.buildTimeline(
                      newSessionId,
                      newSegments,
                      [], // 新会话没有困惑点
                      { subject: UIConfig.defaultSubject, teacher: UIConfig.defaultTeacher || 'Teacher', date: new Date().toISOString().split('T')[0] }
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
                  <div className="card-edu p-5 animate-slide-up">
                    <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                      <span>🎯</span>
                      已标记的困惑点
                      <span className="ml-auto text-xs font-normal text-gray-400">{anchors.length} 个</span>
                    </h3>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {anchors.map((anchor, index) => (
                          <div
                            key={anchor.id}
                            className="flex items-center gap-3 p-3 rounded-xl transition-colors"
                            style={{ background: 'var(--edu-bg-soft)' }}
                          >
                            <div className={`w-2.5 h-2.5 rounded-full ${
                              anchor.resolved ? 'bg-mint' : 'bg-coral'
                            }`} />
                            <span className="text-sm font-mono text-gray-600">
                              {formatTime(anchor.timestamp)}
                            </span>
                            <span className="text-sm text-gray-500">
                              困惑点 #{index + 1}
                            </span>
                            {anchor.resolved && (
                              <span className="ml-auto text-xs text-mint-600">已解决</span>
                            )}
                          </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          {/* 桌面端布局 */}
          {!isMobile ? (
            <div className="flex-1 min-h-0 flex overflow-hidden page-enter" style={{ background: 'var(--edu-bg-primary)' }}>
              {/* 可拖拽左右面板 */}
              <ResizablePanel
                className="flex-1"
                defaultLeftWidth={360}
                minLeftWidth={280}
                maxLeftWidth={480}
                storageKey="meetmind-left-panel-width"
                leftPanel={
                  /* 左栏 - 多功能面板 */
                  <div className="h-full flex flex-col bg-white" style={{ borderRight: '1px solid var(--edu-border-light)' }}>
                    {/* 标签页切换 */}
                    <div className="flex items-center gap-1 px-3 py-2 border-b overflow-x-auto flex-shrink-0" style={{ background: 'var(--edu-bg-soft)', borderColor: 'var(--edu-border-light)' }}>
                      <button
                        onClick={() => setReviewTab('timeline')}
                        className={`px-2.5 py-1.5 text-sm rounded-lg transition-all whitespace-nowrap ${
                          reviewTab === 'timeline'
                            ? 'bg-white text-amber-600 font-medium shadow-sm'
                            : 'text-gray-500 hover:text-navy hover:bg-white/50'
                        }`}
                      >
                        📋 时间轴
                      </button>
                      <button
                        onClick={() => setReviewTab('anchor-detail')}
                        className={`px-2.5 py-1.5 text-sm rounded-lg transition-all whitespace-nowrap ${
                          reviewTab === 'anchor-detail'
                            ? 'bg-white text-amber-600 font-medium shadow-sm'
                            : 'text-gray-500 hover:text-navy hover:bg-white/50'
                        }`}
                      >
                        🎯 困惑点
                        {selectedAnchor && !selectedAnchor.resolved && (
                          <span className="ml-1 w-2 h-2 bg-coral rounded-full inline-block animate-pulse" />
                        )}
                      </button>
                      <button
                        onClick={() => setReviewTab('highlights')}
                        className={`px-2.5 py-1.5 text-sm rounded-lg transition-all whitespace-nowrap ${
                          reviewTab === 'highlights'
                            ? 'bg-white text-amber-600 font-medium shadow-sm'
                            : 'text-gray-500 hover:text-navy hover:bg-white/50'
                        }`}
                      >
                        ⚡ 精选
                        {highlightTopics.length > 0 && (
                          <span className="ml-1 text-xs text-skyblue-600">({highlightTopics.length})</span>
                        )}
                      </button>
                      <button
                        onClick={() => setReviewTab('summary')}
                        className={`px-2.5 py-1.5 text-sm rounded-lg transition-all whitespace-nowrap ${
                          reviewTab === 'summary'
                            ? 'bg-white text-amber-600 font-medium shadow-sm'
                            : 'text-gray-500 hover:text-navy hover:bg-white/50'
                        }`}
                      >
                        📝 摘要
                        {classSummary && <span className="ml-1 text-xs text-mint-600">✓</span>}
                      </button>
                      <button
                        onClick={() => setReviewTab('notes')}
                        className={`px-2.5 py-1.5 text-sm rounded-lg transition-all whitespace-nowrap ${
                          reviewTab === 'notes'
                            ? 'bg-white text-amber-600 font-medium shadow-sm'
                            : 'text-gray-500 hover:text-navy hover:bg-white/50'
                        }`}
                      >
                        📄 笔记
                        {notes.length > 0 && (
                          <span className="ml-1 text-xs text-amber-600">({notes.length})</span>
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
                }
                rightPanel={
                  /* 中栏 - AI 对话区（现在是右侧主面板） */
                  <div className="h-full flex flex-col bg-white">
                    {/* 精简波形播放器 - compact 模式，置于顶部 */}
                    {(audioBlob || audioUrl) && (
                      <div className="flex-shrink-0 border-b" style={{ background: 'var(--edu-bg-soft)', borderColor: 'var(--edu-border-light)' }}>
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
                          onPlayStateChange={setIsPlaying}
                          onAnchorClick={(anchor) => {
                            const found = anchors.find(a => a.id === anchor.id);
                            if (found) handleAnchorSelect(found);
                          }}
                          onAnchorAdd={handlePlaybackAnchorAdd}
                          allowAddAnchor={true}
                          selectedAnchorId={selectedAnchor?.id}
                          compact={true}
                        />
                      </div>
                    )}
                    
                    {/* AI 家教区 */}
                    <div className="flex-1 min-h-0 flex flex-col">
                      {/* 内容区 */}
                      <div className="flex-1 min-h-0 overflow-hidden">
                        {showConversationHistory ? (
                          selectedHistoryConversation ? (
                            <div className="h-full flex flex-col">
                              <div className="px-4 py-2 border-b flex items-center justify-between flex-shrink-0" style={{ background: 'var(--edu-bg-soft)', borderColor: 'var(--edu-border-light)' }}>
                                <span className="text-sm text-gray-600 truncate">{selectedHistoryConversation.title}</span>
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => setSelectedHistoryConversation(null)}
                                    className="text-xs text-gray-500 hover:text-navy"
                                  >
                                    ← 返回列表
                                  </button>
                                  <button
                                    onClick={() => {
                                      setShowConversationHistory(false);
                                      setSelectedHistoryConversation(null);
                                    }}
                                    className="text-xs text-amber-600 hover:text-amber-700"
                                  >
                                    新对话
                                  </button>
                                </div>
                              </div>
                              <div className="flex-1 min-h-0">
                                <AIChat
                                  conversationId={selectedHistoryConversation.conversationId}
                                  sessionId={sessionId}
                                  onTimestampClick={(timeMs) => {
                                    setCurrentTime(timeMs);
                                    waveformRef.current?.seekTo(timeMs);
                                    waveformRef.current?.play();
                                  }}
                                />
                              </div>
                            </div>
                          ) : (
                            <div className="h-full flex flex-col">
                              <div className="px-4 py-2 border-b flex items-center justify-between flex-shrink-0" style={{ background: 'var(--edu-bg-soft)', borderColor: 'var(--edu-border-light)' }}>
                                <span className="text-sm font-medium text-navy">历史对话</span>
                                <button
                                  onClick={() => {
                                    setShowConversationHistory(false);
                                    setSelectedHistoryConversation(null);
                                  }}
                                  className="text-xs text-amber-600 hover:text-amber-700 flex items-center gap-1"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                  </svg>
                                  新对话
                                </button>
                              </div>
                              <div className="flex-1 min-h-0">
                                <ConversationList
                                  sessionId={sessionId}
                                  onSelect={(conv) => setSelectedHistoryConversation(conv)}
                                  showSearch={true}
                                  maxHeight="100%"
                                />
                              </div>
                            </div>
                          )
                        ) : (
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
                        )}
                      </div>
                    </div>
                  </div>
                }
              />

              {/* 右侧 - 图标条 */}
              <ActionSidebar
                actionCount={actionItems.filter(i => !i.completed).length}
                totalCount={actionItems.length}
                isDrawerOpen={isActionDrawerOpen}
                onToggleDrawer={() => setIsActionDrawerOpen(!isActionDrawerOpen)}
                onShowHistory={() => {
                  setShowConversationHistory(!showConversationHistory);
                  if (showConversationHistory) {
                    setSelectedHistoryConversation(null);
                  }
                }}
                isHistoryActive={showConversationHistory}
              />

              {/* 行动清单抽屉 */}
              <ActionDrawer
                isOpen={isActionDrawerOpen}
                onClose={() => setIsActionDrawerOpen(false)}
                items={actionItems}
                onComplete={handleActionComplete}
              />
            </div>
          ) : (
            /* 移动端教育风格布局 */
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden" style={{ background: 'var(--edu-bg-primary)' }}>
              {/* 极简顶部栏：Logo + Tab + 菜单 */}
              <div className="flex-shrink-0 px-4 py-2.5 flex items-center gap-3 bg-white border-b" style={{ borderColor: 'var(--edu-border-light)' }}>
                {/* Logo */}
                <div className="w-8 h-8 bg-gradient-to-br from-amber-400 to-amber-500 rounded-lg flex items-center justify-center flex-shrink-0">
                  <span className="text-white font-bold text-sm">M</span>
                </div>
                
                {/* Tab 切换 */}
                <div className="flex-1 flex items-center justify-center">
                  <MobileTabSwitch
                    activeTab={viewMode}
                    onTabChange={(tab) => handleViewModeChange(tab)}
                    className="w-full max-w-[180px]"
                  />
                </div>
                
                {/* 菜单按钮 */}
                <DedaoMenuButton onClick={() => setIsMenuOpen(true)} />
              </div>

              {/* 单行极简播放器 */}
              {!mobileSubPage && (
                <MiniPlayer
                  currentTime={currentTime}
                  duration={totalDuration}
                  isPlaying={isPlaying}
                  markers={anchors.map(a => ({
                    id: a.id,
                    timestamp: a.timestamp,
                    resolved: a.resolved,
                  }))}
                  onSeek={(timeMs) => {
                    setCurrentTime(timeMs);
                    waveformRef.current?.seekTo(timeMs);
                  }}
                  onPlayPause={() => {
                    if (isPlaying) {
                      waveformRef.current?.pause();
                    } else {
                      waveformRef.current?.play();
                    }
                    setIsPlaying(!isPlaying);
                  }}
                  onMarkerClick={(marker) => {
                    const anchor = anchors.find(a => a.id === marker.id);
                    if (anchor) {
                      const context = segments.find(
                        s => marker.timestamp >= s.startMs && marker.timestamp <= s.endMs
                      )?.text;
                      
                      setSelectedConfusion({
                        id: marker.id,
                        timestamp: marker.timestamp,
                        content: anchor.note,
                        resolved: marker.resolved,
                        context,
                      } as ConfusionMarker & { context?: string });
                      
                      handleAnchorSelect(anchor);
                    }
                  }}
                />
              )}

              {/* 隐藏的波形播放器（用于实际音频播放） */}
              {(audioBlob || audioUrl) && (
                <div className="hidden">
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
                    onPlayStateChange={setIsPlaying}
                    onAnchorClick={(anchor) => {
                      const found = anchors.find(a => a.id === anchor.id);
                      if (found) handleAnchorSelect(found);
                    }}
                    onAnchorAdd={handlePlaybackAnchorAdd}
                    allowAddAnchor={true}
                    selectedAnchorId={selectedAnchor?.id}
                    height={0}
                    showControls={false}
                  />
                </div>
              )}

              {/* 主内容区：根据 mobileSubPage 条件渲染 */}
              {mobileSubPage === null && (
                <>
                  {/* 时间轴列表（占满剩余空间） */}
                  <DedaoTimeline
                    entries={toDedaoEntries(segments, anchors)}
                    currentTime={currentTime}
                    onEntryClick={(entry) => {
                      setCurrentTime(entry.startMs);
                      waveformRef.current?.seekTo(entry.startMs);
                      waveformRef.current?.play();
                      setIsPlaying(true);
                    }}
                    onConfusionClick={(entry) => {
                      const anchor = anchors.find(
                        a => a.timestamp >= entry.startMs && a.timestamp <= entry.endMs
                      );
                      if (anchor) {
                        setSelectedConfusion({
                          id: anchor.id,
                          timestamp: anchor.timestamp,
                          content: anchor.note,
                          resolved: anchor.resolved,
                          context: entry.content,
                        } as ConfusionMarker & { context?: string });
                        handleAnchorSelect(anchor);
                      }
                    }}
                    className="flex-1 min-h-0"
                  />

                  {/* 困惑点详情卡片 */}
                  <DedaoConfusionCard
                    isOpen={!!selectedConfusion}
                    onClose={() => setSelectedConfusion(null)}
                    confusion={selectedConfusion ? {
                      id: selectedConfusion.id,
                      timestamp: selectedConfusion.timestamp,
                      content: selectedConfusion.content,
                      resolved: selectedConfusion.resolved,
                      context: (selectedConfusion as ConfusionMarker & { context?: string }).context,
                    } : null}
                    onAskAI={(question) => {
                      setSelectedConfusion(null);
                      setMobileAIQuestion(question);
                      setMobileSubPage('ai-chat');
                    }}
                    onResolve={() => {
                      handleResolveAnchor();
                      setSelectedConfusion(null);
                    }}
                    onSeek={(timeMs) => {
                      setCurrentTime(timeMs);
                      waveformRef.current?.seekTo(timeMs);
                    }}
                  />
                </>
              )}

              {/* 移动端 AI 对话页面 */}
              {mobileSubPage === 'ai-chat' && (
                <div className="flex-1 min-h-0 flex flex-col bg-white">
                  {/* 子页面头部 */}
                  <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
                    <button
                      onClick={() => {
                        setMobileSubPage(null);
                        setMobileAIQuestion('');
                        setShowConversationHistory(false);
                        setSelectedHistoryConversation(null);
                      }}
                      className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100"
                    >
                      <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                    <span className="font-medium text-gray-900">AI 助教</span>
                    
                    {/* 历史记录切换按钮 */}
                    <div className="ml-auto flex items-center gap-1">
                      <button
                        onClick={() => {
                          setShowConversationHistory(false);
                          setSelectedHistoryConversation(null);
                        }}
                        className={`px-2.5 py-1 text-xs rounded-full transition-all ${
                          !showConversationHistory
                            ? 'bg-lavender-100 text-lavender-700 font-medium'
                            : 'text-gray-500 hover:bg-gray-100'
                        }`}
                      >
                        当前
                      </button>
                      <button
                        onClick={() => setShowConversationHistory(true)}
                        className={`px-2.5 py-1 text-xs rounded-full transition-all ${
                          showConversationHistory
                            ? 'bg-lavender-100 text-lavender-700 font-medium'
                            : 'text-gray-500 hover:bg-gray-100'
                        }`}
                      >
                        📜 历史
                      </button>
                    </div>
                  </div>
                  
                  {/* MiniPlayer 播放进度条 */}
                  <MiniPlayer
                    currentTime={currentTime}
                    duration={totalDuration}
                    isPlaying={isPlaying}
                    markers={anchors.map(a => ({
                      id: a.id,
                      timestamp: a.timestamp,
                      resolved: a.resolved,
                    }))}
                    onSeek={(timeMs) => {
                      setCurrentTime(timeMs);
                      waveformRef.current?.seekTo(timeMs);
                    }}
                    onPlayPause={() => {
                      if (isPlaying) {
                        waveformRef.current?.pause();
                      } else {
                        waveformRef.current?.play();
                      }
                      setIsPlaying(!isPlaying);
                    }}
                    onMarkerClick={(marker) => {
                      const anchor = anchors.find(a => a.id === marker.id);
                      if (anchor) {
                        setSelectedAnchor(anchor);
                      }
                    }}
                    className="border-b border-gray-100"
                  />
                  
                  {/* AI 对话区 */}
                  <div className="flex-1 min-h-0">
                    {showConversationHistory ? (
                      selectedHistoryConversation ? (
                        // 继续历史对话
                        <div className="h-full flex flex-col">
                          <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                            <span className="text-sm text-gray-600 truncate">{selectedHistoryConversation.title}</span>
                            <button
                              onClick={() => setSelectedHistoryConversation(null)}
                              className="text-xs text-amber-600"
                            >
                              ← 返回
                            </button>
                          </div>
                          <div className="flex-1 min-h-0">
                            <AIChat
                              conversationId={selectedHistoryConversation.conversationId}
                              sessionId={sessionId}
                              onTimestampClick={(timeMs) => {
                                setCurrentTime(timeMs);
                                waveformRef.current?.seekTo(timeMs);
                                waveformRef.current?.play();
                              }}
                            />
                          </div>
                        </div>
                      ) : (
                        // 历史对话列表
                        <ConversationList
                          sessionId={sessionId}
                          onSelect={(conv) => setSelectedHistoryConversation(conv)}
                          showSearch={true}
                          maxHeight="100%"
                        />
                      )
                    ) : (
                      // 当前困惑点对话
                      <AITutor
                        breakpoint={selectedBreakpoint}
                        segments={segments}
                        isLoading={false}
                        onResolve={handleResolveAnchor}
                        onActionItemsUpdate={handleActionItemsUpdate}
                        sessionId={sessionId}
                        initialQuestion={mobileAIQuestion}
                        isMobile={true}
                        onSeek={(timeMs) => {
                          setCurrentTime(timeMs);
                          waveformRef.current?.seekTo(timeMs);
                          waveformRef.current?.play();
                        }}
                      />
                    )}
                  </div>
                </div>
              )}

              {/* 移动端精选页面 */}
              {mobileSubPage === 'highlights' && (
                <div className="flex-1 min-h-0 flex flex-col bg-white">
                  <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
                    <button
                      onClick={() => setMobileSubPage(null)}
                      className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100"
                    >
                      <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                    <span className="font-medium text-gray-900">精选片段</span>
                  </div>
                  <div className="flex-1 min-h-0 overflow-hidden">
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
                  </div>
                </div>
              )}

              {/* 移动端摘要页面 */}
              {mobileSubPage === 'summary' && (
                <div className="flex-1 min-h-0 flex flex-col bg-white">
                  <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
                    <button
                      onClick={() => setMobileSubPage(null)}
                      className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100"
                    >
                      <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                    <span className="font-medium text-gray-900">课堂摘要</span>
                  </div>
                  <div className="flex-1 min-h-0 overflow-hidden">
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
                  </div>
                </div>
              )}

              {/* 移动端笔记页面 */}
              {mobileSubPage === 'notes' && (
                <div className="flex-1 min-h-0 flex flex-col bg-white">
                  <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
                    <button
                      onClick={() => setMobileSubPage(null)}
                      className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100"
                    >
                      <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                    <span className="font-medium text-gray-900">我的笔记</span>
                  </div>
                  <div className="flex-1 min-h-0 overflow-hidden">
                    <NotesPanel
                      notes={notes}
                      onAddNote={handleAddNote}
                      onUpdateNote={handleUpdateNote}
                      onDeleteNote={handleDeleteNote}
                      onSeek={handleTimelineClick}
                    />
                  </div>
                </div>
              )}

              {/* 移动端任务页面 */}
              {mobileSubPage === 'tasks' && (
                <div className="flex-1 min-h-0 flex flex-col bg-white">
                  <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
                    <button
                      onClick={() => setMobileSubPage(null)}
                      className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100"
                    >
                      <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                    <span className="font-medium text-gray-900">今日任务</span>
                  </div>
                  <div className="flex-1 min-h-0 overflow-hidden">
                    <ActionList
                      items={actionItems}
                      onComplete={handleActionComplete}
                    />
                  </div>
                </div>
              )}

              {/* 右侧菜单 */}
              <DedaoMenu
                isOpen={isMenuOpen}
                onClose={() => setIsMenuOpen(false)}
                onNavigate={(page) => setMobileSubPage(page)}
                badges={{
                  highlights: highlightTopics.length,
                  notes: notes.length,
                  tasks: actionItems.filter(i => !i.completed).length,
                }}
              />
            </div>
          )}
        </>
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
