import type { TranscriptSegment } from '@/types';

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
export const CORRECTION_MODEL = process.env.NEXT_PUBLIC_TRANSCRIPT_LIGHT_MODEL || 'qwen-turbo';
export const CORRECTION_FALLBACK_MODEL = process.env.NEXT_PUBLIC_TRANSCRIPT_FALLBACK_MODEL || 'qwen-plus';
