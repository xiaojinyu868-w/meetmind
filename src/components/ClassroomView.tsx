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
 * 设计系统：零渐变、零阴影、纯平涂
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
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
import { useClassroomMindMap } from '@/hooks/useClassroomMindMap';
import { useLiveConcepts } from '@/hooks/useLiveConcepts';
import { useCaptureEditorStore } from '@/stores/capture-editor-store';
import { useCollectionStore } from '@/stores/collection-store';
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
}

export function ClassroomView({
  onStartRecording,
  onOpenLesson,
  isRecording = false,
  recordingSeconds = 0,
  onStopRecording,
  onOpenApp,
}: ClassroomViewProps) {
  // ── 真实数据：Lesson[] + markReviewed ──
  const { lessons, markReviewed } = useClassroomLessons();

  // ── 真 AI 同桌 ──
  const {
    messages,
    streamingMessage,
    isThinking,
    send: sendToTutor,
    markListening,
  } = useClassroomCompanion({ lessons, isRecording });

  // 左侧面板视图态：list ↔ recording
  // - isRecording=true 时优先走 recording
  // - 用户在录音中也可以手动"返回列表"（localPaneState='list'）去翻其他课
  const [localPaneState, setLocalPaneState] = useState<ClassroomPaneState>('list');
  const paneState: ClassroomPaneState = isRecording && localPaneState === 'recording'
    ? 'recording'
    : isRecording && localPaneState === 'list'
      ? 'list'
      : localPaneState;

  // 录音开启 → 自动进入 recording 全屏态（第一次）
  useEffect(() => {
    if (isRecording) {
      setLocalPaneState('recording');
    } else {
      setLocalPaneState('list');
    }
  }, [isRecording]);

  // ── AI 同桌的展开策略 ──
  // 默认收起；录课态自动展开（此时 AI 同桌真的在听课，有存在感）；
  // 用户在列表态也可手动召唤。
  const [companionOpen, setCompanionOpen] = useState(false);
  useEffect(() => {
    if (paneState === 'recording') {
      setCompanionOpen(true);
    }
  }, [paneState]);

  // ── 录课中关键概念（客户端启发式） ──
  const liveConcepts = useLiveConcepts({ enabled: paneState === 'recording' });

  // ── 录课中实时转录：订阅 segments，只在录课态订阅 + 拼接 ──
  const segments = useCaptureEditorStore((s) => s.segments);
  const liveInterimText = useCaptureEditorStore((s) => s.liveInterimText);
  const liveTranscriptText = useMemo(() => {
    if (paneState !== 'recording') return undefined;
    if (segments.length === 0) return '';
    return segments
      .map((s) => s.text)
      .filter(Boolean)
      .join(' ')
      .trim();
  }, [paneState, segments]);

  // 录课态下真正用来喂 TranscriptFlowView 的 segments——其他时候不传，
  // 避免 ClassroomRecordingView 在列表态里拿到陈旧的上节课 segments。
  const recordingSegments = useMemo(
    () => (paneState === 'recording' ? segments : undefined),
    [paneState, segments],
  );

  // MindMap → 转录段落跳转：记住最近一次点击的 ms + 一个自增 nonce，
  // ClassroomRecordingView 内部用 nonce 决定"要不要重滚"。连续点同一个节点也能生效。
  const [mindMapScrollTarget, setMindMapScrollTarget] = useState<{ ms: number; nonce: number } | null>(null);
  const handleMindMapAnchorClick = useCallback((ms: number) => {
    setMindMapScrollTarget((prev) => ({ ms, nonce: (prev?.nonce ?? 0) + 1 }));
  }, []);

  // 最近 N 句已落定句子（用于 UnderstandingCanvas 的"刚才讲到"区）。
  // 只保留最近 4 条，避免干扰焦点。
  const recentLines = useMemo(() => {
    if (paneState !== 'recording') return [];
    const lastFew = segments.slice(-4).filter((s) => s.isFinal && s.text?.trim());
    return lastFew.map((s) => ({
      id: String(s.id ?? `${s.startMs}-${s.text.slice(0, 6)}`),
      text: s.text,
      startMs: s.startMs,
    }));
  }, [paneState, segments]);

  // ── 录课计时：isRecording 变 true 时开始，true→false 时停止。每秒 tick。 ──
  const [localRecordingSeconds, setLocalRecordingSeconds] = useState(0);
  const [recordingStartAt, setRecordingStartAt] = useState<number | null>(null);
  useEffect(() => {
    if (paneState !== 'recording') {
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
  }, [paneState]);

  // 优先使用外部传入的秒数；其次 segments 折算；兜底用本地 tick
  const effectiveRecordingSeconds = useMemo(() => {
    if (recordingSeconds > 0) return recordingSeconds;
    if (paneState !== 'recording') return 0;
    if (segments.length > 0) {
      const last = segments[segments.length - 1];
      const fromSegs = Math.floor((last.endMs || last.startMs || 0) / 1000);
      if (fromSegs > 0) return fromSegs;
    }
    return localRecordingSeconds;
  }, [recordingSeconds, paneState, segments, localRecordingSeconds]);

  // 同桌 mode 跟随左侧状态
  const companionMode: CompanionMode = paneState === 'recording' ? 'listening' : 'idle';

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
  const { foresights, dismiss: dismissForesight } = useClassroomForesight({
    enabled: paneState === 'recording',
    recentText: liveTranscriptText,
  });

  // ── 思维导图：生长中的理解结构（主画面的核心）──
  //   - 每 ~45s 拉一次，或命中"接下来/那/下一个"等主题切换词时提前拉。
  //   - 预热 60-90s（hook + 后端双保险），避免开场寒暄污染节点。
  //   - 课前预习材料标题作为 importedHints，帮模型识别专名。
  const mindMapImportedHints = useMemo(() => {
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

  const { tree: mindMapTree, newNodeIds: mindMapNewIds } = useClassroomMindMap({
    enabled: paneState === 'recording',
    transcriptText: liveTranscriptText,
    interimText: paneState === 'recording' ? liveInterimText : undefined,
    recordingStartAt,
    lessonTitle: activeRecordingLessonTitle,
    importedHints: mindMapImportedHints,
  });

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
    if (onStopRecording) {
      onStopRecording(lessonId);
    } else {
      setLocalPaneState('list');
    }
  }, [onStopRecording]);

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
        mindMapTree={mindMapTree}
        mindMapNewIds={mindMapNewIds}
        onMindMapAnchorClick={handleMindMapAnchorClick}
        scrollTarget={paneState === 'recording' ? mindMapScrollTarget : null}
        onFocusRecording={() => setLocalPaneState('recording')}
        audioSource={recorderAudioSource}
        onChangeAudioSource={setRecorderAudioSource}
      />
    ),
    [paneState, lessons, handleOpenLesson, handleStartRecording, handleStopRecording, effectiveRecordingSeconds, liveConcepts, liveTranscriptText, recordingSegments, liveInterimText, recentLines, mindMapTree, mindMapNewIds, handleMindMapAnchorClick, mindMapScrollTarget, recorderAudioSource, setRecorderAudioSource],
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
      />
    ),
    [companionMode, messages, streamingMessage, isThinking, handleSend, onOpenApp, foresights, handleForesightAccept, dismissForesight],
  );

  return (
    <ClassroomLayout
      left={leftPanel}
      right={rightPanel}
      companionOpen={companionOpen}
      onCompanionOpenChange={setCompanionOpen}
    />
  );
}

export default ClassroomView;
