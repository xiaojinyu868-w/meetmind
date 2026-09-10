import Dexie, { Table } from 'dexie';

export interface AudioSession {
  id?: number;
  sessionId: string;
  userId: string;
  blob?: Blob;
  mimeType: string;
  duration: number;
  subject?: string;
  topic?: string;
  /** 用户手动改过标题后为 true：自动标题系统（lesson-title）永远不再覆盖 */
  topicLocked?: boolean;
  sourceType?: 'recording' | 'upload' | 'video-link' | 'video-file';
  mediaUrl?: string;
  videoUrl?: string;
  videoEmbedUrl?: string;
  videoProvider?: string;
  thumbnailUrl?: string;
  importSourceMode?: 'bili-native' | 'bili-subtitle' | 'yt-dlp' | 'direct';
  importTrace?: Array<{
    stage: string;
    ok: boolean;
    code?: string;
    detail?: string;
  }>;
  transcriptionStatus?: 'pending' | 'completed' | 'failed';
  transcriptionError?: string;
  transcriptionUpdatedAt?: Date;
  /** 波形峰值缓存（800 点）：wavesurfer 首次解码后写入，下次进复习页跳过整段解码 */
  waveformPeaks?: number[];
  waveformPeaksDurationSec?: number;
  status: 'recording' | 'completed' | 'archived';
  createdAt: Date;
  updatedAt: Date;
  /**
   * 录课检查点（2026-09-10 起）：录音期间每隔几秒把已定稿字幕 / 音频分片落盘时顺手写这两个字段，
   * 忘记结束再回来时靠它们判断「已录 N 分钟」与是否超过自动收尾时限（>6h）。
   */
  checkpointAt?: Date;
  lastCheckpointDurationMs?: number;
  /**
   * 这节课的服务端 capture 同步状态（仅登录用户；访客与旧数据为 undefined）。
   * pending = 结束后还没成功写到服务端；failed = 上次尝试失败（syncError 记原因）；synced = 已到服务端。
   * pending / failed 会被 sync-pending-recordings 在进课堂 / 恢复联网 / 页面回前台时补传，绝不静默丢。
   */
  syncState?: 'pending' | 'synced' | 'failed';
  syncError?: string;
  syncedAt?: Date;
  /**
   * 另一台设备正在录这节课（服务端 capture metadata.recordingState 回填）：
   * 列表显示「录制中 · 已 N 分钟」而不是「正在整理」；服务端翻成 completed 后清掉。
   */
  remoteRecordingState?: 'recording' | 'completed';
  remoteCheckpointAt?: Date;
}

/**
 * 录课期间的音频分片（MediaRecorder timeslice 产物，按 seq 递增）。
 * 正常结束后由最终完整 blob 取代并删除；页面被关掉 / 崩溃时靠它把已录部分拼回一整段原声。
 * 同一 MediaRecorder 的分片按顺序 new Blob([...]) 即是合法 webm，首片带容器头。
 */
export interface RecordingChunk {
  id?: number;
  sessionId: string;
  seq: number;
  blob: Blob;
  mimeType: string;
  createdAt: Date;
}

export interface Anchor {
  id?: number;
  sessionId: string;
  timestamp: number;
  type: 'confusion' | 'important' | 'question';
  status: 'active' | 'resolved';
  note?: string;
  aiExplanation?: string;
  createdAt: Date;
  resolvedAt?: Date;
}

/**
 * 课中主动截图的关键帧（「截取这一页」）。
 * 用户按下截图那一刻 = 他认定"这页值得留下"——主动意图锚点，
 * 与转录段共用录音时间轴（timestampMs）。blob 课后上传服务端
 * WorkspaceCaptureArtifact(kind='keyframe')，成功后写回 mediaUrl/uploaded。
 */
export interface KeyframeRecord {
  id?: number;
  sessionId: string;
  /** 录音时间轴毫秒（与 TranscriptSegment.startMs 同根） */
  timestampMs: number;
  /** 本地 JPEG 原图（本机截取的帧才有；云端回填的帧只有 mediaUrl） */
  blob?: Blob;
  uploaded?: boolean;
  /** 上传成功后的服务端图片地址（/api/workspace/images/...） */
  mediaUrl?: string;
  createdAt: Date;
}

export interface TranscriptSegment {
  id?: number;
  sessionId: string;
  userId: string;
  text: string;
  startMs: number;
  endMs: number;
  speakerId?: string;
  confidence: number;
  isFinal: boolean;
}

export interface TranscriptLexiconEntry {
  id?: number;
  term: string;
  canonical: string;
  aliases: string[];
  scope: 'classroom' | 'meeting' | 'global';
  status: 'pending' | 'active' | 'disabled';
  source: 'seed' | 'manual' | 'auto';
  hitCount: number;
  promotedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface TranscriptEditDiff {
  id?: number;
  originalText: string;
  correctedText: string;
  scope: 'classroom' | 'meeting' | 'global';
  hitCount: number;
  promoted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Preference {
  key: string;
  value: unknown;
}

export interface HighlightTopic {
  id?: number;
  topicId: string;
  sessionId: string;
  title: string;
  description?: string;
  importance: 'high' | 'medium' | 'low';
  duration: number;
  segments: Array<{
    start: number;
    end: number;
    text: string;
    startSegmentIdx?: number;
    endSegmentIdx?: number;
    confidence?: number;
  }>;
  keywords?: string[];
  quote?: {
    timestamp: string;
    text: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface ClassSummary {
  id?: number;
  summaryId: string;
  sessionId: string;
  overview: string;
  takeaways: Array<{
    label: string;
    insight: string;
    timestamps: string[];
  }>;
  keyDifficulties: string[];
  structure: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface Note {
  id?: number;
  noteId: string;
  sessionId: string;
  studentId: string;
  source: 'chat' | 'takeaways' | 'transcript' | 'custom' | 'anchor';
  sourceId?: string;
  text: string;
  metadata?: {
    transcript?: {
      start: number;
      end?: number;
      segmentIndex?: number;
      topicId?: string;
    };
    chat?: {
      messageId: string;
      role: 'user' | 'assistant';
      timestamp?: string;
    };
    selectedText?: string;
    selectionContext?: string;
    timestampLabel?: string;
    extra?: Record<string, unknown>;
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface TutorResponseCache {
  id?: number;
  anchorId: string;
  sessionId: string;
  timestamp: number;
  response: string;
  chatHistory: string;
  conversationId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationHistoryRecord {
  id?: number;
  conversationId: string;
  userId: string;
  type: 'tutor' | 'chat' | 'global-chat';
  title: string;
  sessionId?: string;
  anchorId?: string;
  anchorTimestamp?: number;
  messageCount: number;
  lastMessage?: string;
  model?: string;
  metadata?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 课堂笔记（LessonDigest）缓存：按 sessionId 一份。
 * signature 是内容签名（转录段数 + 末段 endMs + 图片 id 集合），
 * 签名一致时直接复用缓存，不再请求 LLM。
 * digest 的结构见 lib/services/lesson-digest-service 的 LessonDigest，
 * db 层只做透明存储，不依赖 services 类型。
 */
export interface LessonDigestRecord {
  id?: number;
  sessionId: string;
  signature: string;
  digest: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationMessageRecord {
  id?: number;
  messageId: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachments?: string;
  createdAt: Date;
}

export class MeetMindDB extends Dexie {
  audioSessions!: Table<AudioSession>;
  anchors!: Table<Anchor>;
  keyframes!: Table<KeyframeRecord>;
  recordingChunks!: Table<RecordingChunk>;
  transcripts!: Table<TranscriptSegment>;
  transcriptLexicon!: Table<TranscriptLexiconEntry>;
  transcriptEditDiffs!: Table<TranscriptEditDiff>;
  preferences!: Table<Preference>;
  highlightTopics!: Table<HighlightTopic>;
  classSummaries!: Table<ClassSummary>;
  notes!: Table<Note>;
  tutorResponseCache!: Table<TutorResponseCache>;
  lessonDigests!: Table<LessonDigestRecord>;
  conversationHistory!: Table<ConversationHistoryRecord>;
  conversationMessages!: Table<ConversationMessageRecord>;

  constructor() {
    super('MeetMindDB');

    this.version(1).stores({
      audioSessions: '++id, sessionId, status, createdAt',
      anchors: '++id, sessionId, timestamp, status, type',
      transcripts: '++id, sessionId, startMs, isFinal',
      preferences: 'key',
    });

    this.version(2).stores({
      audioSessions: '++id, sessionId, status, createdAt',
      anchors: '++id, sessionId, timestamp, status, type',
      transcripts: '++id, sessionId, startMs, isFinal',
      preferences: 'key',
      highlightTopics: '++id, topicId, sessionId, importance, createdAt',
      classSummaries: '++id, summaryId, sessionId, createdAt',
      notes: '++id, noteId, sessionId, studentId, source, createdAt',
    });

    this.version(3).stores({
      audioSessions: '++id, sessionId, status, createdAt',
      anchors: '++id, sessionId, timestamp, status, type',
      transcripts: '++id, sessionId, startMs, isFinal',
      preferences: 'key',
      highlightTopics: '++id, topicId, sessionId, importance, createdAt',
      classSummaries: '++id, summaryId, sessionId, createdAt',
      notes: '++id, noteId, sessionId, studentId, source, createdAt',
      tutorResponseCache: '++id, anchorId, sessionId, timestamp, createdAt',
    });

    this.version(4).stores({
      audioSessions: '++id, sessionId, status, createdAt',
      anchors: '++id, sessionId, timestamp, status, type',
      transcripts: '++id, sessionId, startMs, isFinal',
      preferences: 'key',
      highlightTopics: '++id, topicId, sessionId, importance, createdAt',
      classSummaries: '++id, summaryId, sessionId, createdAt',
      notes: '++id, noteId, sessionId, studentId, source, createdAt',
      tutorResponseCache: '++id, anchorId, sessionId, timestamp, createdAt',
      conversationHistory: '++id, conversationId, userId, type, sessionId, anchorId, [userId+type], [userId+updatedAt], updatedAt',
      conversationMessages: '++id, messageId, conversationId, createdAt',
    });

    this.version(5).stores({
      audioSessions: '++id, sessionId, status, createdAt',
      anchors: '++id, sessionId, timestamp, status, type',
      transcripts: '++id, sessionId, startMs, isFinal',
      preferences: 'key',
      highlightTopics: '++id, topicId, sessionId, importance, createdAt',
      classSummaries: '++id, summaryId, sessionId, createdAt',
      notes: '++id, noteId, sessionId, studentId, source, createdAt',
      tutorResponseCache: '++id, anchorId, sessionId, timestamp, createdAt',
      conversationHistory: '++id, conversationId, userId, type, sessionId, anchorId, [userId+type], updatedAt',
      conversationMessages: '++id, messageId, conversationId, createdAt',
    });

    this.version(6).stores({
      audioSessions: '++id, sessionId, userId, status, createdAt, [userId+createdAt]',
      anchors: '++id, sessionId, timestamp, status, type',
      transcripts: '++id, sessionId, userId, startMs, isFinal',
      preferences: 'key',
      highlightTopics: '++id, topicId, sessionId, importance, createdAt',
      classSummaries: '++id, summaryId, sessionId, createdAt',
      notes: '++id, noteId, sessionId, studentId, source, createdAt',
      tutorResponseCache: '++id, anchorId, sessionId, timestamp, createdAt',
      conversationHistory: '++id, conversationId, userId, type, sessionId, anchorId, [userId+type], updatedAt',
      conversationMessages: '++id, messageId, conversationId, createdAt',
    }).upgrade((tx) => {
      return Promise.all([
        tx.table('audioSessions').toCollection().modify((session) => {
          if (!session.userId) {
            session.userId = 'anonymous';
          }
        }),
        tx.table('transcripts').toCollection().modify((transcript) => {
          if (!transcript.userId) {
            transcript.userId = 'anonymous';
          }
        }),
      ]);
    });

    this.version(7).stores({
      audioSessions: '++id, sessionId, userId, status, createdAt, [userId+createdAt]',
      anchors: '++id, sessionId, timestamp, status, type',
      transcripts: '++id, sessionId, userId, startMs, isFinal',
      transcriptLexicon: '++id, term, canonical, scope, status, hitCount, updatedAt, [scope+status], [scope+term]',
      transcriptEditDiffs: '++id, originalText, correctedText, scope, hitCount, promoted, updatedAt, [scope+promoted], [scope+originalText+correctedText]',
      preferences: 'key',
      highlightTopics: '++id, topicId, sessionId, importance, createdAt',
      classSummaries: '++id, summaryId, sessionId, createdAt',
      notes: '++id, noteId, sessionId, studentId, source, createdAt',
      tutorResponseCache: '++id, anchorId, sessionId, timestamp, createdAt',
      conversationHistory: '++id, conversationId, userId, type, sessionId, anchorId, [userId+type], updatedAt',
      conversationMessages: '++id, messageId, conversationId, createdAt',
    });

    this.version(8).stores({
      audioSessions: '++id, sessionId, userId, status, createdAt, [userId+createdAt]',
      anchors: '++id, sessionId, timestamp, status, type',
      keyframes: '++id, sessionId, timestampMs',
      transcripts: '++id, sessionId, userId, startMs, isFinal',
      transcriptLexicon: '++id, term, canonical, scope, status, hitCount, updatedAt, [scope+status], [scope+term]',
      transcriptEditDiffs: '++id, originalText, correctedText, scope, hitCount, promoted, updatedAt, [scope+promoted], [scope+originalText+correctedText]',
      preferences: 'key',
      highlightTopics: '++id, topicId, sessionId, importance, createdAt',
      classSummaries: '++id, summaryId, sessionId, createdAt',
      notes: '++id, noteId, sessionId, studentId, source, createdAt',
      tutorResponseCache: '++id, anchorId, sessionId, timestamp, createdAt',
      conversationHistory: '++id, conversationId, userId, type, sessionId, anchorId, [userId+type], updatedAt',
      conversationMessages: '++id, messageId, conversationId, createdAt',
    });

    this.version(9).stores({
      audioSessions: '++id, sessionId, userId, status, createdAt, [userId+createdAt]',
      anchors: '++id, sessionId, timestamp, status, type',
      keyframes: '++id, sessionId, timestampMs',
      transcripts: '++id, sessionId, userId, startMs, isFinal',
      transcriptLexicon: '++id, term, canonical, scope, status, hitCount, updatedAt, [scope+status], [scope+term]',
      transcriptEditDiffs: '++id, originalText, correctedText, scope, hitCount, promoted, updatedAt, [scope+promoted], [scope+originalText+correctedText]',
      preferences: 'key',
      highlightTopics: '++id, topicId, sessionId, importance, createdAt',
      classSummaries: '++id, summaryId, sessionId, createdAt',
      notes: '++id, noteId, sessionId, studentId, source, createdAt',
      tutorResponseCache: '++id, anchorId, sessionId, timestamp, createdAt',
      lessonDigests: '++id, sessionId, updatedAt',
      conversationHistory: '++id, conversationId, userId, type, sessionId, anchorId, [userId+type], updatedAt',
      conversationMessages: '++id, messageId, conversationId, createdAt',
    });

    // v10（2026-09-10 录课不丢）：新增 recordingChunks（录课中音频分片，按 sessionId+seq 取回拼原声）。
    // audioSessions 新增的 checkpointAt / syncState / remoteRecordingState 等是非索引字段，不需要迁移；
    // 旧行缺这些字段 = 「没有检查点 / 未知同步态」，消费方按 undefined 处理。
    this.version(10).stores({
      audioSessions: '++id, sessionId, userId, status, createdAt, [userId+createdAt]',
      anchors: '++id, sessionId, timestamp, status, type',
      keyframes: '++id, sessionId, timestampMs',
      recordingChunks: '++id, sessionId, [sessionId+seq]',
      transcripts: '++id, sessionId, userId, startMs, isFinal',
      transcriptLexicon: '++id, term, canonical, scope, status, hitCount, updatedAt, [scope+status], [scope+term]',
      transcriptEditDiffs: '++id, originalText, correctedText, scope, hitCount, promoted, updatedAt, [scope+promoted], [scope+originalText+correctedText]',
      preferences: 'key',
      highlightTopics: '++id, topicId, sessionId, importance, createdAt',
      classSummaries: '++id, summaryId, sessionId, createdAt',
      notes: '++id, noteId, sessionId, studentId, source, createdAt',
      tutorResponseCache: '++id, anchorId, sessionId, timestamp, createdAt',
      lessonDigests: '++id, sessionId, updatedAt',
      conversationHistory: '++id, conversationId, userId, type, sessionId, anchorId, [userId+type], updatedAt',
      conversationMessages: '++id, messageId, conversationId, createdAt',
    });
  }
}

export const db = new MeetMindDB();

export function generateSessionId(): string {
  return crypto.randomUUID();
}
