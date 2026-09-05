'use client';

/**
 * ClassroomView — 课堂页入口（v2 分栏版 · 真实数据 + 真 Tutor + 录课实时概念）
 *
 * 这是课堂 Tab 的顶层视图。负责：
 *   1. 组装左右分栏（ClassroomLayout）
 *   2. 管理左侧面板的视图态（list ↔ recording）
 *   3. 从 IndexedDB 拉真实 Lesson 数据（含 hasEcho / reviewed / linkedMaterials）
 *   4. 通过 useClassroomCompanion 接入真实 /api/tutor 流式对话
 *   5. 录课中通过 useLiveConcepts 客户端启发式抽取关键概念
 *   6. onOpenLesson 后 markReviewed 自动打标
 *
 * 复用现有能力的接入点：
 *   - onOpenLesson：交给 page.tsx → restoreReviewSession + setViewMode('review')
 *   - onStartRecording / onStopRecording：交给 page.tsx → useRecording
 *   - 右侧对话：useClassroomCompanion → /api/tutor
 *
 * 设计系统 (v7)：
 *   - 95% 克制（米白纸感 + 双签名色 + 极淡 1px ring + shadow-soft/card）
 *   - 5% 仪式时刻情绪化（Course Hero shadow-ai-glow + ai-breath、录音 RecordingHero、
 *     Echo 生成柔光扫过、Tab 切换流式字符浮现）
 *   - "AI 在场"必须可见：不是装饰，是产品 DNA。课中第一眼应该让学生
 *     感到"这个 AI 真的懂我在学什么"。视觉为这个目标服务。
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import {
  ClassroomLayout,
  ClassroomLeftPanel,
  ClassroomCompanionPanel,
} from './classroom';
import type {
  ClassroomPaneState,
} from './classroom';
import type { CompanionMode } from './classroom';
import { useClassroomLessons } from '@/hooks/useClassroomLessons';
import { useClassroomCompanion } from '@/hooks/useClassroomCompanion';
import { useClassroomForesight } from '@/hooks/useClassroomForesight';
import { useClassroomFlow } from '@/hooks/useClassroomFlow';
import { usePersistClassroomFlow } from '@/hooks/usePersistedClassroomFlow';
import { useLiveConcepts } from '@/hooks/useLiveConcepts';
import { useCaptureEditorStore } from '@/stores/capture-editor-store';
import { useSessionStore } from '@/stores/session-store';
import { useCollectionStore } from '@/stores/collection-store';
import {
  isDemoLessonLoaded,
  loadDemoLesson,
  selectDemoLiveSegments,
} from './classroom/DemoLessonLoader';
import {
  resolveClassroomPaneState,
  resolveIsDemoSession,
  shouldOpenDemoReviewOnStop,
  shouldShowClassroomCompanion,
} from './ClassroomView.model';
import { buildGuestDemoFlashcardsResult } from './classroom/guest-demo-entry';
import { writeCachedAppResult, writeCachedTaskState } from '@/components/apps/hooks/useAppExecution';
import { DEMO_AUDIO_URL, DEMO_SEGMENTS, DEMO_SESSION_ID } from '@/fixtures/demo-data';
import { buildDemoClassroomFlow } from './classroom/demo-classroom-flow';
import type { ForesightBubble } from './classroom/ClassroomCompanionPanel';
import type { WorkshopAppKey } from '@/lib/ai-native/app-catalog';

export interface ClassroomViewProps {
  /** 点击"开始录一节课"——由 page.tsx 转发到 useRecording.startRecording */
  onStartRecording: () => void;
  /** 进入某节课的详情（复习）——由 page.tsx 转发到 restoreReviewSession + setViewMode('review') */
  onOpenLesson?: (lessonId: string) => void;
  /** 外部真实录音状态：当 Recorder 在录时，课堂左侧切到 recording 态 */
  isRecording?: boolean;
  /** 外部真实录音时长（秒） */
  recordingSeconds?: number;
  /** 停止录音。lessonId 可选——如果传入且 Recorder 实际没在录，说明点的是"幽灵 pill"，需要降级清理。 */
  onStopRecording?: (lessonId?: string) => void;
  /**
   * 打开 AI 工坊中的一个 App（闪卡 / 测验 / 思维导图 / 学习报告 / 考试速查表）。
   * 由 page.tsx 的 safeOpenWorkshopWindow 提供——同一个入口既被 AI 工坊应用矩阵使用，
   * 也被课堂同桌的 skill chip 使用，保证同一套执行链不分家。
   */
  onOpenApp?: (appKey: WorkshopAppKey) => void;
  /** 访客试听入口：直接灌入 demo 课堂，而不是停在二次选择 hero */
  autoLoadDemo?: boolean;
  /** 访客试听入口默认打开的可见应用产物 */
  autoOpenDemoAppKey?: WorkshopAppKey;
  /** 试听课结束后进入既有课后复习页 / 应用矩阵 */
  onOpenDemoReview?: () => void;
  /** 重命名课程标题（调 IndexedDB updateSessionTopic） */
  onRenameLesson?: (id: string, title: string) => void;
  /** 课中拍照：透传到 ClassroomRecordingView */
  onQuickPhoto?: (capturedAtMs: number) => void;
  /** 课中「截取这一页」：透传到 ClassroomRecordingView（屏幕流帧源存在时由 page.tsx 传入） */
  onCaptureFrame?: (capturedAtMs: number) => void;
  /** 首页“放入学习材料”——由 page.tsx 打开收集文件入口 */
  onAddMaterial?: () => void;
  /** 首页“找到并继续问”——由 page.tsx 打开全局搜索 */
  onSearch?: () => void;
}

export function ClassroomView({
  onStartRecording,
  onOpenLesson,
  isRecording = false,
  recordingSeconds = 0,
  onStopRecording,
  onOpenApp,
  autoLoadDemo = false,
  autoOpenDemoAppKey,
  onOpenDemoReview,
  onRenameLesson,
  onQuickPhoto,
  onCaptureFrame,
  onAddMaterial,
  onSearch,
}: ClassroomViewProps) {
  // ── 真实数据：Lesson[] + markReviewed ──
  const { lessons, markReviewed } = useClassroomLessons();
  const captureActions = useCaptureEditorStore((s) => s.actions);
  const segments = useCaptureEditorStore((s) => s.segments);
  const activeSessionId = useSessionStore((s) => s.sessionId);
  const sessionActions = useSessionStore((s) => s.actions);

  // 左侧面板视图态：list ↔ recording
  // - isRecording=true 时优先走 recording
  // - 用户在录音中也可以手动"返回列表"（localPaneState='list'）去翻其他课
  const [localPaneState, setLocalPaneState] = useState<ClassroomPaneState>(() => (
    resolveClassroomPaneState({ isRecording, autoLoadDemo })
  ));
  const paneState: ClassroomPaneState = isRecording && localPaneState === 'recording'
    ? 'recording'
    : isRecording && localPaneState === 'list'
      ? 'list'
      : localPaneState;
  const demoSessionActive = resolveIsDemoSession({
    autoLoadDemo,
    isRecording,
    isDemoLessonLoaded: isDemoLessonLoaded(segments),
  });
  const companionIsRecording = isRecording || (demoSessionActive && paneState === 'recording');

  // ── 真 AI 同桌 ──
  const {
    messages,
    streamingMessage,
    isThinking,
    send: sendToTutor,
    markListening,
    retryInlineApp,
    handleInlineAppInteraction,
    adminInspector,
  } = useClassroomCompanion({ lessons, isRecording: companionIsRecording, onOpenApp });

  // 真实录音或显式访客试听入口 → 自动进入 recording 全屏态。
  // autoLoadDemo 必须参与同步，避免 Strict Mode 重放 effect 后落回课堂空态。
  // 试听入口被消费（autoLoadDemo true→false）时回落到列表态，并暂停示例课音频。
  useEffect(() => {
    const nextPane = resolveClassroomPaneState({ isRecording, autoLoadDemo });
    if (nextPane === 'list') {
      demoAudioRef.current?.pause();
      setDemoAudioPlaying(false);
    }
    setLocalPaneState(nextPane);
  }, [isRecording, autoLoadDemo]);

  // ── AI 同桌的展开策略 ──
  // 没有课堂上下文时不展示同桌入口；只有真实录课 / 示例课正在播放时才出现。
  const [companionOpen, setCompanionOpen] = useState(false);
  const hasBootstrappedGuestDemoRef = useRef(false);
  const companionAvailable = shouldShowClassroomCompanion({
    paneState,
    isRecording,
    autoLoadDemo: demoSessionActive,
  });
  useEffect(() => {
    if (companionAvailable) {
      setCompanionOpen(true);
    } else {
      setCompanionOpen(false);
    }
  }, [companionAvailable]);

  useEffect(() => {
    if (!autoLoadDemo) return;
    if (hasBootstrappedGuestDemoRef.current) return;
    hasBootstrappedGuestDemoRef.current = true;

    const demoDuration = DEMO_SEGMENTS[DEMO_SEGMENTS.length - 1]?.endMs ?? 0;
    sessionActions.setSessionId(DEMO_SESSION_ID);
    sessionActions.setDataSource('demo');
    sessionActions.setSessionMediaDurationMs(demoDuration);
    sessionActions.setSelectedAnchor(null);
    loadDemoLesson({ actions: captureActions });

    if (autoOpenDemoAppKey === 'flashcards') {
      writeCachedAppResult(DEMO_SESSION_ID, autoOpenDemoAppKey, buildGuestDemoFlashcardsResult());
      writeCachedTaskState(DEMO_SESSION_ID, autoOpenDemoAppKey, { status: 'success', updatedAt: Date.now() });
    }

    setLocalPaneState('recording');
    setCompanionOpen(true);
    if (autoOpenDemoAppKey && onOpenApp) {
      window.setTimeout(() => onOpenApp(autoOpenDemoAppKey), 420);
    }
  }, [autoLoadDemo, autoOpenDemoAppKey, captureActions, onOpenApp, sessionActions]);

  // ── 录课中关键概念（客户端启发式） ──
  const liveConcepts = useLiveConcepts({ enabled: paneState === 'recording' });

  const isDemoRecordingPane = demoSessionActive && paneState === 'recording' && !isRecording;

  // ── 录课计时：真实录音走本地 tick；试听课走 audio.currentTime ──
  const [localRecordingSeconds, setLocalRecordingSeconds] = useState(0);
  const [recordingStartAt, setRecordingStartAt] = useState<number | null>(null);
  useEffect(() => {
    if (paneState !== 'recording') {
      setLocalRecordingSeconds(0);
      setRecordingStartAt(null);
      return;
    }
    if (isDemoRecordingPane) {
      setLocalRecordingSeconds(0);
      setRecordingStartAt(null);
      return;
    }
    const startAt = Date.now();
    setRecordingStartAt(startAt);
    setLocalRecordingSeconds(0);
    const t = setInterval(() => {
      setLocalRecordingSeconds(Math.floor((Date.now() - startAt) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, [paneState, isDemoRecordingPane]);

  // ── 录课中实时转录：订阅 segments，只在录课态订阅 + 拼接 ──
  const liveInterimText = useCaptureEditorStore((s) => s.liveInterimText);

  // ── 试听课音频：demo 不是无声假课。自动播放如果被浏览器拦截，UI 会露出“播放声音”。
  const demoAudioRef = useRef<HTMLAudioElement | null>(null);
  const demoAutoplayAttemptedRef = useRef(false);
  const [demoAudioPlaying, setDemoAudioPlaying] = useState(false);
  const [demoAudioNeedsGesture, setDemoAudioNeedsGesture] = useState(false);
  const [demoComplete, setDemoComplete] = useState(false);

  const playDemoAudio = useCallback(async () => {
    const audio = demoAudioRef.current;
    if (!audio) return;
    try {
      await audio.play();
      setDemoAudioPlaying(true);
      setDemoAudioNeedsGesture(false);
    } catch {
      setDemoAudioPlaying(false);
      setDemoAudioNeedsGesture(true);
    }
  }, []);

  const handleToggleDemoAudio = useCallback(() => {
    const audio = demoAudioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void playDemoAudio();
    } else {
      audio.pause();
      setDemoAudioPlaying(false);
    }
  }, [playDemoAudio]);

  useEffect(() => {
    if (!isDemoRecordingPane) {
      demoAutoplayAttemptedRef.current = false;
      demoAudioRef.current?.pause();
      setDemoAudioPlaying(false);
      setDemoAudioNeedsGesture(false);
      setDemoComplete(false);
      return;
    }
    if (demoAutoplayAttemptedRef.current) return;
    demoAutoplayAttemptedRef.current = true;
    if (demoAudioRef.current) {
      demoAudioRef.current.currentTime = 0;
      setLocalRecordingSeconds(0);
      setDemoComplete(false);
    }
    const timer = window.setTimeout(() => {
      void playDemoAudio();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [isDemoRecordingPane, playDemoAudio]);

  // 自动播放被浏览器拦截（无手势禁音策略）时，借用户首次任意交互续播一次，
  // 避免首屏三栏干等、还要自己找「播放声音」按钮。
  useEffect(() => {
    if (!isDemoRecordingPane || !demoAudioNeedsGesture || demoComplete) return;
    const resume = () => {
      const audio = demoAudioRef.current;
      if (audio && audio.paused) void playDemoAudio();
    };
    window.addEventListener('pointerdown', resume, { once: true });
    window.addEventListener('keydown', resume, { once: true });
    return () => {
      window.removeEventListener('pointerdown', resume);
      window.removeEventListener('keydown', resume);
    };
  }, [isDemoRecordingPane, demoAudioNeedsGesture, demoComplete, playDemoAudio]);

  const handleReplayDemo = useCallback(() => {
    const audio = demoAudioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    setLocalRecordingSeconds(0);
    setDemoComplete(false);
    void playDemoAudio();
  }, [playDemoAudio]);

  const handleOpenDemoReview = useCallback(() => {
    writeCachedAppResult(DEMO_SESSION_ID, 'flashcards', buildGuestDemoFlashcardsResult());
    writeCachedTaskState(DEMO_SESSION_ID, 'flashcards', { status: 'success', updatedAt: Date.now() });
    demoAudioRef.current?.pause();
    setDemoAudioPlaying(false);
    onOpenDemoReview?.();
  }, [onOpenDemoReview]);

  const demoVisibleSegments = useMemo(
    () => (isDemoRecordingPane ? selectDemoLiveSegments(localRecordingSeconds) : []),
    [isDemoRecordingPane, localRecordingSeconds],
  );
  const activeRecordingSegments = isDemoRecordingPane ? demoVisibleSegments : segments;

  const liveTranscriptText = useMemo(() => {
    if (paneState !== 'recording') return undefined;
    if (activeRecordingSegments.length === 0) return '';
    return activeRecordingSegments
      .map((s) => s.text)
      .filter(Boolean)
      .join(' ')
      .trim();
  }, [paneState, activeRecordingSegments]);

  // 录课态下真正用来喂 TranscriptFlowView 的 segments——其他时候不传，
  // 避免 ClassroomRecordingView 在列表态里拿到陈旧的上节课 segments。
  const recordingSegments = useMemo(
    () => (paneState === 'recording' ? activeRecordingSegments : undefined),
    [paneState, activeRecordingSegments],
  );

  /**
   * 用户点 AI 气泡里的内联动作（典型：停止录音那条气泡的 [整速查表] / [看转录]）。
   * 不同 kind 分别走不同响应：
   *   open_app → 打开对应 WorkshopWindow
   *   focus_transcript → 切到 recording 态，让转录抽屉可见
   *   say → 把文本作为新的用户消息发给同学
   */
  const handleInlineAction = useCallback(
    (action: { kind: string; payload?: string }) => {
      if (action.kind === 'open_app' && action.payload && onOpenApp) {
        // payload 是 appKey——WorkshopAppKey 的合法性由下游 open 函数自己 guard
        onOpenApp(action.payload as WorkshopAppKey);
        return;
      }
      if (action.kind === 'focus_transcript') {
        if (paneState !== 'recording') setLocalPaneState('recording');
        return;
      }
      if (action.kind === 'say' && action.payload) {
        void sendToTutor(action.payload);
      }
    },
    [onOpenApp, paneState, sendToTutor],
  );

  // 最近 N 句已落定句子（用于 UnderstandingCanvas 的"刚才讲到"区）。
  // 只保留最近 4 条，避免干扰焦点。
  const recentLines = useMemo(() => {
    if (paneState !== 'recording') return [];
    const lastFew = activeRecordingSegments.slice(-4).filter((s) => s.text?.trim());
    return lastFew.map((s) => ({
      id: String(s.id ?? `${s.startMs}-${s.text.slice(0, 6)}`),
      text: s.text,
      startMs: s.startMs,
    }));
  }, [paneState, activeRecordingSegments]);

  // 优先使用外部传入的秒数；其次 segments 折算；兜底用本地 tick
  const effectiveRecordingSeconds = useMemo(() => {
    if (paneState !== 'recording') return 0;
    if (isDemoRecordingPane) return localRecordingSeconds;
    if (recordingSeconds > 0) return recordingSeconds;
    if (segments.length > 0) {
      const last = segments[segments.length - 1];
      const fromSegs = Math.floor((last.endMs || last.startMs || 0) / 1000);
      if (fromSegs > 0) return fromSegs;
    }
    return localRecordingSeconds;
  }, [recordingSeconds, paneState, isDemoRecordingPane, segments, localRecordingSeconds]);

  // 同桌 mode 跟随左侧状态
  const companionMode: CompanionMode = paneState === 'recording' ? 'listening' : 'idle';
  const companionMood = isThinking
    ? 'thinking'
    : companionMode === 'listening'
      ? 'listening'
      : messages.length > 0
        ? 'happy'
        : 'idle';

  // 切到录课态时，同桌自动说一句
  useEffect(() => {
    if (paneState === 'recording') {
      markListening();
    }
  }, [paneState, markListening]);

  // Store 订阅：预习材料列表 + classroom ASR 热词 action（供下方多个 effect 使用）
  const sourceItems = useCollectionStore((s) => s.sourceItems);
  const setClassroomASRContextHint = useCaptureEditorStore(
    (s) => s.actions.setClassroomASRContextHint,
  );

  // ── 录音来源（麦克风 / 电脑声音 / 两路都录）──
  // 放在 store 里而不是 ClassroomView 局部 state 的原因：
  //   Recorder 挂载点在 page.tsx 而不是 ClassroomView，它需要从 store 读同一个值，
  //   否则 ClassroomView 选的"电脑声音"和实际录音时的 audioSource 会分家。
  const recorderAudioSource = useCaptureEditorStore((s) => s.recorderAudioSource);
  const setRecorderAudioSource = useCaptureEditorStore(
    (s) => s.actions.setRecorderAudioSource,
  );

  // ── 预知气泡：AI 同桌的"主动性"，只在录课中工作 ──
  // M14: foresight 引擎复用 —— 输出从"折叠药丸"形态升级为 composer 上方的动态 chip 行
  const { foresights, dismiss: dismissForesight } = useClassroomForesight({
    enabled: paneState === 'recording',
    recentText: liveTranscriptText,
  });
  // M14: foresight → 动态 chip（最多 2 个，AI 写多长由模型决定）
  const dynamicChips = useMemo(
    () => foresights.slice(0, 2).map((f) => ({ id: f.id, text: f.text })),
    [foresights],
  );

  // ── 课堂脉络：模型自主判断当前讲解、近期推进和课后保留点 ──
  // 前端只提供转录、课程标题和附近材料，不用关键词替模型切主题。
  const classroomFlowImportedHints = useMemo(() => {
    const todayDate = new Date().toISOString().split('T')[0];
    return sourceItems
      .filter((item) => (item.addedAt || '').startsWith(todayDate))
      .map((item) => item.title || '')
      .filter((t) => t.length > 1 && t.length < 60)
      .slice(0, 12);
  }, [sourceItems]);

  const activeRecordingLessonTitle = useMemo(() => {
    const active = lessons.find((lesson) => lesson.status === 'recording');
    const title = active?.title?.trim();
    if (!title || /^正在录|^课堂$|^新课堂/.test(title)) return undefined;
    return title;
  }, [lessons]);

  const {
    flow: generatedClassroomFlow,
    newItemIds: generatedClassroomFlowNewIds,
    isUnderstanding: isUnderstandingClassroomFlow,
  } = useClassroomFlow({
    enabled: paneState === 'recording' && !isDemoRecordingPane,
    sessionId: activeSessionId,
    segments: recordingSegments ?? [],
    recordingStartAt,
    lessonTitle: activeRecordingLessonTitle,
    importedHints: classroomFlowImportedHints,
  });

  const demoClassroomFlow = useMemo(
    () => buildDemoClassroomFlow(effectiveRecordingSeconds),
    [effectiveRecordingSeconds],
  );
  usePersistClassroomFlow(DEMO_SESSION_ID, demoClassroomFlow.flow, isDemoRecordingPane);
  const classroomFlow = isDemoRecordingPane ? demoClassroomFlow.flow : generatedClassroomFlow;
  const classroomFlowNewIds = isDemoRecordingPane
    ? demoClassroomFlow.newItemIds
    : generatedClassroomFlowNewIds;

  // ── ASR 热词注入：课堂场景下，从预习材料 + 课程标题聚合专名 ──
  // ASR 专名识别差的根源是 page.tsx 里 asrContextHint 恒为 ''。
  // 课堂场景能拿到的确定信号：
  //   1) 当天（今天）的 sourceItems 标题 —— 用户课前丢进"收集"的链接/文件/笔记
  //   2) 最近三节课的 title —— 跨课程的重复术语
  // 写进 capture-editor-store.classroomASRContextHint，page.tsx 的 liveASRContextHint
  // 会把它合入最终传给 Recorder 的 contextHint。
  useEffect(() => {
    const todayDate = new Date().toISOString().split('T')[0];
    const todaysTitles = sourceItems
      .filter((item) => (item.addedAt || '').startsWith(todayDate))
      .map((item) => item.title || '')
      .filter((t) => t && t.length > 1 && t.length < 80);

    const recentLessonTitles = lessons
      .slice(0, 6)
      .map((l) => l.title)
      .filter((t): t is string => typeof t === 'string' && t.length > 1 && t.length < 60);

    const uniq = Array.from(new Set([...todaysTitles, ...recentLessonTitles])).slice(0, 20);
    const hint = uniq.length > 0 ? `课堂相关主题与材料：${uniq.join('，')}` : '';
    setClassroomASRContextHint(hint);

    return () => {
      // 离开课堂页/组件卸载时清空，避免污染别的 tab 的录音
      setClassroomASRContextHint('');
    };
  }, [sourceItems, lessons, setClassroomASRContextHint]);

  // 用户点"就这个·问下去"——把预感 text 当作问题发给 tutor，并本地划掉气泡
  const handleForesightAccept = useCallback(
    (f: ForesightBubble) => {
      dismissForesight(f.id);
      void sendToTutor(f.text);
    },
    [dismissForesight, sendToTutor],
  );

  /**
   * M14: 「记一下」——课中给当前转录瞬间打标，下课带回看。
   * 形态目前是 toast 提示 + 暂存到内存（M14.5 持久化到 IndexedDB + 复习态左栏 marked moments 列表）。
   * 不发对话，纯客户端动作；目的是让学生在被点名/听到关键点时一秒按下，不打断听课。
   */
  const markedMomentsRef = useRef<Array<{ timeMs: number; nearbyText: string }>>([]);
  const handleMarkMoment = useCallback(() => {
    const lastSeg = activeRecordingSegments[activeRecordingSegments.length - 1];
    const timeMs = lastSeg?.endMs ?? lastSeg?.startMs ?? Math.floor(effectiveRecordingSeconds * 1000);
    const nearby = activeRecordingSegments.slice(-3).map((s) => s.text).filter(Boolean).join(' ').trim().slice(-200);
    markedMomentsRef.current.push({ timeMs, nearbyText: nearby });

    const mins = Math.floor(timeMs / 60000);
    const secs = Math.floor((timeMs % 60000) / 1000);
    const stamp = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    toast.success(`已记下 ${stamp}`, {
      description: '下课进入复习时带你回看这一段',
      duration: 1800,
    });
  }, [activeRecordingSegments, effectiveRecordingSeconds]);

  const handleOpenLesson = useCallback((id: string) => {
    const lesson = lessons.find((l) => l.id === id);
    // 只有"已理解"的课才能进入详情（复习）
    if (lesson?.status !== 'ready') return;
    // 打标"已复习"——本地立刻更新，持久化 fire-and-forget
    markReviewed(id);
    onOpenLesson?.(id);
  }, [lessons, markReviewed, onOpenLesson]);

  const handleStartRecording = useCallback(() => {
    if (!onStopRecording) {
      setLocalPaneState('recording');
    }
    onStartRecording();
  }, [onStartRecording, onStopRecording]);

  const handleStopRecording = useCallback((lessonId?: string) => {
    if (shouldOpenDemoReviewOnStop({ autoLoadDemo: demoSessionActive, isRecording, paneState })) {
      handleOpenDemoReview();
      return;
    }
    if (onStopRecording) {
      onStopRecording(lessonId);
    } else {
      setLocalPaneState('list');
    }
  }, [demoSessionActive, isRecording, paneState, handleOpenDemoReview, onStopRecording]);

  // 返回课程列表（录课入口页）：试听课先暂停音频；真实录音在后台继续，
  // 由列表顶部的活动条承接，随时可以回到录课态。
  const handleBackToList = useCallback(() => {
    demoAudioRef.current?.pause();
    setDemoAudioPlaying(false);
    setLocalPaneState('list');
  }, []);

  const handleSend = useCallback((text: string) => {
    void sendToTutor(text);
  }, [sendToTutor]);

  const leftPanel = useMemo(
    () => (
      <ClassroomLeftPanel
        state={paneState}
        lessons={lessons}
        onOpenLesson={handleOpenLesson}
        onStartRecording={handleStartRecording}
        onStopRecording={handleStopRecording}
        recordingSeconds={effectiveRecordingSeconds}
        liveConcepts={liveConcepts}
        transcriptText={liveTranscriptText}
        segments={recordingSegments}
        interimText={paneState === 'recording' ? liveInterimText : undefined}
        recentLines={recentLines}
        classroomFlow={classroomFlow}
        classroomFlowNewIds={classroomFlowNewIds}
        isUnderstandingClassroomFlow={isUnderstandingClassroomFlow}
        onFocusRecording={() => setLocalPaneState('recording')}
        onBackToList={handleBackToList}
        isDemoPlayback={isDemoRecordingPane}
        demoAudioPlaying={demoAudioPlaying}
        demoAudioNeedsGesture={demoAudioNeedsGesture}
        onToggleDemoAudio={handleToggleDemoAudio}
        defaultTranslationMode={isDemoRecordingPane ? 'en-zh' : undefined}
        isDemoComplete={demoComplete}
        onReplayDemo={handleReplayDemo}
        onFinishDemo={handleOpenDemoReview}
        audioSource={recorderAudioSource}
        onChangeAudioSource={setRecorderAudioSource}
        onOpenApp={onOpenApp}
        onRenameLesson={onRenameLesson}
        onQuickPhoto={onQuickPhoto}
        onCaptureFrame={onCaptureFrame}
        onAddMaterial={onAddMaterial}
        onSearch={onSearch}
      />
    ),
    [paneState, lessons, handleOpenLesson, handleStartRecording, handleStopRecording, handleBackToList, effectiveRecordingSeconds, liveConcepts, liveTranscriptText, recordingSegments, liveInterimText, recentLines, classroomFlow, classroomFlowNewIds, isUnderstandingClassroomFlow, isDemoRecordingPane, demoAudioPlaying, demoAudioNeedsGesture, handleToggleDemoAudio, demoComplete, handleReplayDemo, handleOpenDemoReview, recorderAudioSource, setRecorderAudioSource, onOpenApp, onRenameLesson, onQuickPhoto, onCaptureFrame, onAddMaterial, onSearch],
  );

  const demoSuggestedPrompts = useMemo(
    () => demoComplete
      ? [
          '结束这节课，去复习',
          '课后可以练什么？',
          '先帮我复盘一下',
        ]
      : [
          'up in the air 是什么意思？',
          '这段听力在问什么？',
          '帮我抓答案线索',
        ],
    [demoComplete],
  );

  const rightPanel = useMemo(
    () => (
      <ClassroomCompanionPanel
        mode={companionMode}
        messages={messages}
        streamingMessage={streamingMessage}
        isThinking={isThinking}
        onSend={handleSend}
        onOpenApp={onOpenApp}
        foresights={foresights}
        onForesightAccept={handleForesightAccept}
        onForesightDismiss={dismissForesight}
        onInlineAction={handleInlineAction}
        onInlineAppInteraction={handleInlineAppInteraction}
        onInlineAppRetry={retryInlineApp}
        suggestedPrompts={isDemoRecordingPane ? demoSuggestedPrompts : undefined}
        afterClass={isDemoRecordingPane && demoComplete}
        onAfterClassAction={handleOpenDemoReview}
        onMarkMoment={handleMarkMoment}
        dynamicChips={dynamicChips}
        adminInspector={adminInspector}
      />
    ),
    [companionMode, messages, streamingMessage, isThinking, handleSend, onOpenApp, foresights, handleForesightAccept, dismissForesight, handleInlineAction, handleInlineAppInteraction, retryInlineApp, isDemoRecordingPane, demoSuggestedPrompts, demoComplete, handleOpenDemoReview, handleMarkMoment, dynamicChips, adminInspector],
  );

  return (
    <>
      {isDemoRecordingPane ? (
        <audio
          ref={demoAudioRef}
          src={DEMO_AUDIO_URL}
          preload="auto"
          onPlay={() => {
            setDemoAudioPlaying(true);
            setDemoAudioNeedsGesture(false);
          }}
          onPause={() => setDemoAudioPlaying(false)}
          onEnded={(event) => {
            setDemoAudioPlaying(false);
            setDemoComplete(true);
            setCompanionOpen(true);
            setLocalRecordingSeconds(Math.floor(event.currentTarget.duration || 93));
          }}
          onTimeUpdate={(event) => {
            setLocalRecordingSeconds(Math.floor(event.currentTarget.currentTime));
          }}
        />
      ) : null}
      <ClassroomLayout
        left={leftPanel}
        right={rightPanel}
        companionOpen={companionOpen}
        onCompanionOpenChange={setCompanionOpen}
        companionMood={companionMood}
        companionAvailable={companionAvailable}
      />
    </>
  );
}

export default ClassroomView;
