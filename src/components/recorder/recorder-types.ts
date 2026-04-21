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
   * 录音来源：
   * - 'mic'（默认）— 麦克风。收集页永远用这个。
   * - 'system'    — 电脑发出的声音（通过 getDisplayMedia），适合在家听网课。
   * - 'mixed'     — 麦克风 + 电脑声音 合并到一路上传 ASR（线上课 + 自己会提问）。
   *
   * 注：因浏览器限制，'system' 和 'mixed' 会弹出「选择共享屏幕/标签页」
   * 对话框，用户必须勾选"分享系统音频/标签页音频"，否则会降级回纯麦克风。
   */
  audioSource?: RecorderAudioSource;
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
export const ENABLE_AUTO_GAIN_CONTROL = String(process.env.NEXT_PUBLIC_ASR_AUTO_GAIN_CONTROL || 'true').toLowerCase() !== 'false';
export const ENABLE_ECHO_CANCELLATION = String(process.env.NEXT_PUBLIC_ASR_ECHO_CANCELLATION || 'false').toLowerCase() !== 'false';
export const ENABLE_NOISE_SUPPRESSION = String(process.env.NEXT_PUBLIC_ASR_NOISE_SUPPRESSION || 'true').toLowerCase() !== 'false';
export const CORRECTION_MODEL = process.env.NEXT_PUBLIC_TRANSCRIPT_LIGHT_MODEL || 'qwen3.5-plus';
export const CORRECTION_FALLBACK_MODEL = process.env.NEXT_PUBLIC_TRANSCRIPT_FALLBACK_MODEL || 'qwen3.5-plus';
