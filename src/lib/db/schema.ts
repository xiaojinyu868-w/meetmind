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
}

export interface Anchor {
  id?: number;
  /** 跨设备稳定锚点 ID；不是 Dexie 主键，旧行可为空。 */
  sourceAnchorId?: string;
  sessionId: string;
  timestamp: number;
  type: 'confusion' | 'important' | 'question';
  status: 'active' | 'resolved';
  note?: string;
  aiExplanation?: string;
  createdAt: Date;
  resolvedAt?: Date;
  updatedAt?: Date;
  /** 最近一次已应用的云端 mutation，用于同毫秒冲突决胜。 */
  sourceMutationId?: string;
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
  /** 最近一次已应用的云端 mutation，用于同毫秒冲突决胜。 */
  sourceMutationId?: string;
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
  sourceMutationId?: string;
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
  transcripts!: Table<TranscriptSegment>;
  transcriptLexicon!: Table<TranscriptLexiconEntry>;
  transcriptEditDiffs!: Table<TranscriptEditDiff>;
  preferences!: Table<Preference>;
  highlightTopics!: Table<HighlightTopic>;
  classSummaries!: Table<ClassSummary>;
  notes!: Table<Note>;
  tutorResponseCache!: Table<TutorResponseCache>;
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
  }
}

export const db = new MeetMindDB();

export function generateSessionId(): string {
  return crypto.randomUUID();
}
