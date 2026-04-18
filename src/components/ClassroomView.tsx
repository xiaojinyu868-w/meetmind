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
import { useLiveConcepts } from '@/hooks/useLiveConcepts';
import { useCaptureEditorStore } from '@/stores/capture-editor-store';

export interface ClassroomViewProps {
  /** 点击"开始录一节课"——由 page.tsx 转发到 useRecording.startRecording */
  onStartRecording: () => void;
  /** 进入某节课的详情（复习）——由 page.tsx 转发到 restoreReviewSession + setViewMode('review') */
  onOpenLesson?: (lessonId: string) => void;
  /** 外部真实录音状态：当 Recorder 在录时，课堂左侧切到 recording 态 */
  isRecording?: boolean;
  /** 外部真实录音时长（秒） */
  recordingSeconds?: number;
  /** 停止录音 */
  onStopRecording?: () => void;
}

export function ClassroomView({
  onStartRecording,
  onOpenLesson,
  isRecording = false,
  recordingSeconds = 0,
  onStopRecording,
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
  const liveTranscriptText = useMemo(() => {
    if (paneState !== 'recording') return undefined;
    if (segments.length === 0) return '';
    return segments
      .map((s) => s.text)
      .filter(Boolean)
      .join(' ')
      .trim();
  }, [paneState, segments]);

  // ── 录课计时：isRecording 变 true 时开始，true→false 时停止。每秒 tick。 ──
  const [localRecordingSeconds, setLocalRecordingSeconds] = useState(0);
  useEffect(() => {
    if (paneState !== 'recording') {
      setLocalRecordingSeconds(0);
      return;
    }
    const startAt = Date.now();
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

  const handleStopRecording = useCallback(() => {
    if (onStopRecording) {
      onStopRecording();
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
        onFocusRecording={() => setLocalPaneState('recording')}
      />
    ),
    [paneState, lessons, handleOpenLesson, handleStartRecording, handleStopRecording, effectiveRecordingSeconds, liveConcepts, liveTranscriptText],
  );

  const rightPanel = useMemo(
    () => (
      <ClassroomCompanionPanel
        mode={companionMode}
        messages={messages}
        streamingMessage={streamingMessage}
        isThinking={isThinking}
        onSend={handleSend}
      />
    ),
    [companionMode, messages, streamingMessage, isThinking, handleSend],
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
