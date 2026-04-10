/**
 * Capture Editor Store - 管理课堂内容核心数据
 *
 * 从 page.tsx 迁移的状态覆盖：
 * - segments — 转录片段
 * - anchors — 困惑标记
 * - timeline — 课堂时间线
 * - actionItems — 待办项
 * - audioBlob / audioUrl — 音频源
 * - videoSource — 视频源
 * - notes — 课堂笔记
 * - confusionChatAnchor — 困惑对话锚点
 * - videoInsightItems / activeVideoInsightId — 视频洞察
 * - extractedTermsHint — 提取的术语提示
 * - recorderAutoStartSignal — 录音器自动启动信号
 *
 * 类型来源：@/types, @/types/page-types（single source of truth）
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type {
  TranscriptSegment,
  Anchor,
  ClassTimeline,
  Note,
  ImportedVideoSource,
} from '@/types';
import type { ActionItem } from '@/types/page-types';
import type { VideoInsightItem } from '@/components/VideoInsightTimeline';

// ==================== 类型定义 ====================

interface CaptureEditorState {
  segments: TranscriptSegment[];
  anchors: Anchor[];
  timeline: ClassTimeline | null;
  actionItems: ActionItem[];
  audioBlob: Blob | null;
  audioUrl: string | null;
  videoSource: ImportedVideoSource | null;
  notes: Note[];
  confusionChatAnchor: Anchor | null;
  videoInsightItems: VideoInsightItem[];
  activeVideoInsightId: string | null;
  extractedTermsHint: string;
  recorderAutoStartSignal: number;
}

interface CaptureEditorActions {
  setSegments: (segments: TranscriptSegment[] | ((prev: TranscriptSegment[]) => TranscriptSegment[])) => void;
  setAnchors: (anchors: Anchor[] | ((prev: Anchor[]) => Anchor[])) => void;
  setTimeline: (timeline: ClassTimeline | null | ((prev: ClassTimeline | null) => ClassTimeline | null)) => void;
  setActionItems: (items: ActionItem[] | ((prev: ActionItem[]) => ActionItem[])) => void;
  setAudioBlob: (blob: Blob | null) => void;
  setAudioUrl: (url: string | null) => void;
  setVideoSource: (source: ImportedVideoSource | null) => void;
  setNotes: (notes: Note[] | ((prev: Note[]) => Note[])) => void;
  setConfusionChatAnchor: (anchor: Anchor | null) => void;
  setVideoInsightItems: (items: VideoInsightItem[] | ((prev: VideoInsightItem[]) => VideoInsightItem[])) => void;
  setActiveVideoInsightId: (id: string | null) => void;
  setExtractedTermsHint: (hint: string) => void;
  setRecorderAutoStartSignal: (signal: number) => void;

  /** 重置全部课堂内容数据（新会话时调用） */
  resetCaptureEditorState: () => void;
}

export type CaptureEditorStore = CaptureEditorState & { actions: CaptureEditorActions };

// ==================== 初始状态 ====================

const initialState: CaptureEditorState = {
  segments: [],
  anchors: [],
  timeline: null,
  actionItems: [],
  audioBlob: null,
  audioUrl: null,
  videoSource: null,
  notes: [],
  confusionChatAnchor: null,
  videoInsightItems: [],
  activeVideoInsightId: null,
  extractedTermsHint: '',
  recorderAutoStartSignal: 0,
};

// ==================== 辅助函数 ====================

function resolveUpdate<T>(next: T | ((prev: T) => T), prev: T): T {
  return typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
}

// ==================== Store 实现 ====================

export const useCaptureEditorStore = create<CaptureEditorStore>()(
  devtools(
    (set) => ({
      ...initialState,

      actions: {
        setSegments: (next) => set((s) => ({ segments: resolveUpdate(next, s.segments) }), false, 'setSegments'),
        setAnchors: (next) => set((s) => ({ anchors: resolveUpdate(next, s.anchors) }), false, 'setAnchors'),
        setTimeline: (next) => set((s) => ({ timeline: resolveUpdate(next, s.timeline) }), false, 'setTimeline'),
        setActionItems: (next) => set((s) => ({ actionItems: resolveUpdate(next, s.actionItems) }), false, 'setActionItems'),
        setAudioBlob: (blob) => set({ audioBlob: blob }, false, 'setAudioBlob'),
        setAudioUrl: (url) => set({ audioUrl: url }, false, 'setAudioUrl'),
        setVideoSource: (source) => set({ videoSource: source }, false, 'setVideoSource'),
        setNotes: (next) => set((s) => ({ notes: resolveUpdate(next, s.notes) }), false, 'setNotes'),
        setConfusionChatAnchor: (anchor) => set({ confusionChatAnchor: anchor }, false, 'setConfusionChatAnchor'),
        setVideoInsightItems: (next) => set((s) => ({ videoInsightItems: resolveUpdate(next, s.videoInsightItems) }), false, 'setVideoInsightItems'),
        setActiveVideoInsightId: (id) => set({ activeVideoInsightId: id }, false, 'setActiveVideoInsightId'),
        setExtractedTermsHint: (hint) => set({ extractedTermsHint: hint }, false, 'setExtractedTermsHint'),
        setRecorderAutoStartSignal: (signal) => set({ recorderAutoStartSignal: signal }, false, 'setRecorderAutoStartSignal'),

        resetCaptureEditorState: () => set(initialState, false, 'resetCaptureEditorState'),
      },
    }),
    { name: 'capture-editor-store' }
  )
);

// ==================== Selector Hooks ====================

export const useSegments = () => useCaptureEditorStore((s) => s.segments);
export const useAnchors = () => useCaptureEditorStore((s) => s.anchors);
export const useTimeline = () => useCaptureEditorStore((s) => s.timeline);
export const useActionItems = () => useCaptureEditorStore((s) => s.actionItems);
export const useAudioBlob = () => useCaptureEditorStore((s) => s.audioBlob);
export const useAudioUrl = () => useCaptureEditorStore((s) => s.audioUrl);
export const useVideoSource = () => useCaptureEditorStore((s) => s.videoSource);
export const useNotes = () => useCaptureEditorStore((s) => s.notes);
export const useConfusionChatAnchor = () => useCaptureEditorStore((s) => s.confusionChatAnchor);
export const useVideoInsightItems = () => useCaptureEditorStore((s) => s.videoInsightItems);
export const useActiveVideoInsightId = () => useCaptureEditorStore((s) => s.activeVideoInsightId);
export const useExtractedTermsHint = () => useCaptureEditorStore((s) => s.extractedTermsHint);
export const useRecorderAutoStartSignal = () => useCaptureEditorStore((s) => s.recorderAutoStartSignal);
export const useCaptureEditorActions = () => useCaptureEditorStore((s) => s.actions);

export default useCaptureEditorStore;
