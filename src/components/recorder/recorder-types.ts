import type { TranscriptSegment } from '@/types';
import type { RecorderAudioSource } from '@/stores/capture-editor-store';

export type { RecorderAudioSource };

export interface RecorderCallbackMeta {
  recordingId?: string;
  sessionId?: string;
  isContinuation?: boolean;
  durationMs?: number;
}

export interface RecorderProps {
  onRecordingStart?: (sessionId: string, meta?: { isContinuation?: boolean }) => void;
  onRecordingStop?: (audioBlob?: Blob, meta?: RecorderCallbackMeta) => void;
  onTranscriptionError?: (message: string, meta?: RecorderCallbackMeta) => void;
  onTranscriptUpdate?: (segments: TranscriptSegment[], meta?: RecorderCallbackMeta) => void;
  onTranscriptTextUpdate?: (segmentId: string, text: string) => void;

  onTranscriptEnhanced?: (segments: TranscriptSegment[]) => void;
  onAnchorMark?: (timestamp: number) => void;
  onTranscribing?: (isTranscribing: boolean) => void;
  disabled?: boolean;
  activeSessionId?: string;
  continueCurrentSession?: boolean;
  autoStartSignal?: number;
  compactMode?: boolean;
  /** Optional context hint (course topic, terms, references) for ASR hot-word injection */
  contextHint?: string;
  /**
   * 语种模式（Qwen 官方最佳实践）：
   * - 'auto'（默认）— 不传 language 参数，让模型自动识别。**推荐用于双语混合课堂**（如 CS/商科英文教材中文授课）。
   * - 'zh'          — 明确中文课。
   * - 'en'          — 明确英文课。
   * Qwen 文档明确说明："若音频语种不确定或包含多种语种（中英日韩混合），请勿指定 language 参数"。
   */
  languageMode?: 'auto' | 'zh' | 'en';
  /**
   * 录音来源：
   * - 'mic'（默认）— 麦克风。收集页永远用这个。
   * - 'system'    — 电脑发出的声音（通过 getDisplayMedia），适合在家听网课。
   * - 'mixed'     — 麦克风 + 电脑声音 合并到一路上传 ASR（线上课 + 自己会提问）。
   *
   * 注：因浏览器限制，'system' 和 'mixed' 会弹出「选择共享屏幕/标签页」
   * 对话框，用户必须勾选"分享系统音频/标签页音频"，否则会降级回纯麦克风。
   */
  audioSource?: RecorderAudioSource;
  /**
   * 启用说话人分离——切换到腾讯云 16k_zh_en_speaker 引擎，
   * 实时返回 speaker_id（0-9），支持最多 10 个说话人。
   * 用户在录音前选择"多人会议"时开启。
   */
  speakerDiarization?: boolean;
}

export interface RecorderHandle {
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  pauseRecording: () => void;
  resumeRecording: () => Promise<void>;
}

export type RecorderStatus = 'idle' | 'recording' | 'paused' | 'stopped' | 'transcribing';
export type ServiceStatus = 'checking' | 'available' | 'unavailable' | 'asr-ready';
export type TranscribeMode = 'batch' | 'streaming';

// --- 环境变量常量 ---
export const DEDUP_SIMILARITY = Number(process.env.NEXT_PUBLIC_ASR_DEDUP_SIMILARITY || 0.95);
export const DEDUP_GAP_MS = Number(process.env.NEXT_PUBLIC_ASR_DEDUP_GAP_MS || 1500);
// AEC/NS/AGC 开关已中心化到 src/lib/services/asr/audio-constraints.ts（M5/M6）。
// Recorder / OmniRealtimeCall 都走 buildAudioConstraints()，避免散落。
export const CORRECTION_MODEL = process.env.NEXT_PUBLIC_TRANSCRIPT_LIGHT_MODEL || 'qwen3.7-plus';
export const CORRECTION_FALLBACK_MODEL = process.env.NEXT_PUBLIC_TRANSCRIPT_FALLBACK_MODEL || 'qwen3.7-plus';
