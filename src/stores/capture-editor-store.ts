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

/**
 * Recorder 音频来源：
 * - 'mic'      — 只录麦克风（默认，备忘录/线下课堂）
 * - 'system'   — 只录电脑发出的声音（通过 getDisplayMedia，适合在家听网课）
 * - 'mixed'    — 麦克风 + 电脑声音 合并成一路（线上课 + 自己会开口提问时）
 *
 * 这个字段由课堂页的「录音源选择器」写入，收集页不消费（收集页一律麦克风）。
 */
export type RecorderAudioSource = 'mic' | 'system' | 'mixed';

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
  /**
   * 当前选择的录音来源。默认 'mic'。
   * 课堂页的 Recorder 会消费它来决定 getUserMedia 还是 getDisplayMedia，
   * 或者两路合并。收集页不消费（备忘录始终麦克风）。
   */
  recorderAudioSource: RecorderAudioSource;
  /**
   * 课堂页是否启用说话人分离（多人会议模式）。
   * 启用后 Recorder 切换到腾讯云 16k_zh_en_speaker 引擎，实时返回 speaker_id。
   */
  recorderSpeakerDiarization: boolean;
  /**
   * 流式 ASR 中，当前还未落定为 final segment 的「跟读」文本。
   * 由 Recorder 的 onInterim 写入，课堂录课视图订阅后显示在顶部，
   * 让用户感知到"AI 真的在听"，体验上抹平批量转写的割裂感。
   */
  liveInterimText: string;
  /**
   * 课堂场景的 ASR 热词/上下文提示。
   * 由 ClassroomView 根据当天的预习材料标题等聚合后写入，
   * page.tsx 的 liveASRContextHint 合入后传给 Recorder 的 contextHint，
   * 专门解决课堂录课时 ASR 拿不到课程专名的问题。
   */
  classroomASRContextHint: string;
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
  setRecorderAudioSource: (source: RecorderAudioSource) => void;
  setRecorderSpeakerDiarization: (enabled: boolean) => void;
  setLiveInterimText: (text: string) => void;
  setClassroomASRContextHint: (hint: string) => void;

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
  recorderAudioSource: 'mic',
  recorderSpeakerDiarization: false,
  liveInterimText: '',
  classroomASRContextHint: '',
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
        setRecorderAudioSource: (source) => set({ recorderAudioSource: source }, false, 'setRecorderAudioSource'),
        setRecorderSpeakerDiarization: (enabled) => set({ recorderSpeakerDiarization: enabled }, false, 'setRecorderSpeakerDiarization'),
        setLiveInterimText: (text) => set({ liveInterimText: text }, false, 'setLiveInterimText'),
        setClassroomASRContextHint: (hint) => set({ classroomASRContextHint: hint }, false, 'setClassroomASRContextHint'),

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
export const useRecorderAudioSource = () => useCaptureEditorStore((s) => s.recorderAudioSource);
export const useRecorderSpeakerDiarization = () => useCaptureEditorStore((s) => s.recorderSpeakerDiarization);
export const useLiveInterimText = () => useCaptureEditorStore((s) => s.liveInterimText);
export const useClassroomASRContextHint = () => useCaptureEditorStore((s) => s.classroomASRContextHint);
export const useCaptureEditorActions = () => useCaptureEditorStore((s) => s.actions);

export default useCaptureEditorStore;
