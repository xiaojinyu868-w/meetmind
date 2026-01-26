// Dexie.js 数据库定义
// 复用 Dexie.js (13.9k stars) 实现 IndexedDB 封装

import Dexie, { Table } from 'dexie';

// ============ 数据模型 ============

/** 音频会话 */
export interface AudioSession {
  id?: number;
  sessionId: string;           // UUID
  userId: string;              // 用户ID，用于数据隔离
  blob: Blob;                  // 音频数据
  mimeType: string;            // 'audio/webm'
  duration: number;            // 毫秒
  subject?: string;            // 学科
  topic?: string;              // 主题
  status: 'recording' | 'completed' | 'archived';
  createdAt: Date;
  updatedAt: Date;
}

/** 困惑点/锚点 */
export interface Anchor {
  id?: number;
  sessionId: string;
  userId: string;              // 用户ID，用于数据隔离
  timestamp: number;           // 毫秒
  type: 'confusion' | 'important' | 'question';
  status: 'active' | 'resolved';
  note?: string;
  aiExplanation?: string;      // AI 生成的解释
  createdAt: Date;
  resolvedAt?: Date;
}

/** 转录片段 */
export interface TranscriptSegment {
  id?: number;
  sessionId: string;
  userId: string;              // 用户ID，用于数据隔离
  text: string;
  startMs: number;
  endMs: number;
  speakerId?: string;
  confidence: number;
  isFinal: boolean;
}

/** 用户偏好 */
export interface Preference {
  key: string;
  value: any;
}

/** AI 精选片段 */
export interface HighlightTopic {
  id?: number;
  topicId: string;           // UUID
  sessionId: string;
  userId: string;            // 用户ID，用于数据隔离
  title: string;
  description?: string;
  importance: 'high' | 'medium' | 'low';
  duration: number;          // 毫秒
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

/** 课堂摘要 */
export interface ClassSummary {
  id?: number;
  summaryId: string;         // UUID
  sessionId: string;
  userId: string;            // 用户ID，用于数据隔离
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

/** 个人笔记 */
export interface Note {
  id?: number;
  noteId: string;            // UUID
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

/** AI 家教响应缓存 */
export interface TutorResponseCache {
  id?: number;
  anchorId: string;           // 困惑点ID
  sessionId: string;
  userId: string;             // 用户ID，用于数据隔离
  timestamp: number;          // 困惑点时间戳
  response: string;           // JSON 序列化的完整响应
  chatHistory: string;        // JSON 序列化的对话历史
  conversationId?: string;    // Dify 会话ID
  createdAt: Date;
  updatedAt: Date;
}

/** 对话历史记录 */
export interface ConversationHistoryRecord {
  id?: number;
  conversationId: string;      // UUID
  userId: string;              // 用户ID，用于数据隔离
  type: 'tutor' | 'chat';      // 对话类型
  title: string;               // 对话标题
  sessionId?: string;          // 关联的音频会话ID
  anchorId?: string;           // 关联的困惑点ID
  anchorTimestamp?: number;    // 困惑点时间戳
  messageCount: number;        // 消息数量
  lastMessage?: string;        // 最后一条消息预览
  model?: string;              // 使用的AI模型
  metadata?: string;           // JSON序列化的扩展元数据
  createdAt: Date;
  updatedAt: Date;
}

/** 对话消息记录 */
export interface ConversationMessageRecord {
  id?: number;
  messageId: string;           // UUID
  conversationId: string;      // 关联对话ID
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachments?: string;        // JSON序列化的附件数组
  createdAt: Date;
}

// ============ 数据库定义 ============

export class MeetMindDB extends Dexie {
  audioSessions!: Table<AudioSession>;
  anchors!: Table<Anchor>;
  transcripts!: Table<TranscriptSegment>;
  preferences!: Table<Preference>;
  highlightTopics!: Table<HighlightTopic>;
  classSummaries!: Table<ClassSummary>;
  notes!: Table<Note>;
  tutorResponseCache!: Table<TutorResponseCache>;
  conversationHistory!: Table<ConversationHistoryRecord>;
  conversationMessages!: Table<ConversationMessageRecord>;

  constructor() {
    super('MeetMindDB');
    
    // 版本 1: 原有表
    this.version(1).stores({
      audioSessions: '++id, sessionId, status, createdAt',
      anchors: '++id, sessionId, timestamp, status, type',
      transcripts: '++id, sessionId, startMs, isFinal',
      preferences: 'key'
    });
    
    // 版本 2: 添加精选片段、摘要、笔记表
    this.version(2).stores({
      audioSessions: '++id, sessionId, status, createdAt',
      anchors: '++id, sessionId, timestamp, status, type',
      transcripts: '++id, sessionId, startMs, isFinal',
      preferences: 'key',
      highlightTopics: '++id, topicId, sessionId, importance, createdAt',
      classSummaries: '++id, summaryId, sessionId, createdAt',
      notes: '++id, noteId, sessionId, studentId, source, createdAt'
    });
    
    // 版本 3: 添加 AI 家教响应缓存表
    this.version(3).stores({
      audioSessions: '++id, sessionId, status, createdAt',
      anchors: '++id, sessionId, timestamp, status, type',
      transcripts: '++id, sessionId, startMs, isFinal',
      preferences: 'key',
      highlightTopics: '++id, topicId, sessionId, importance, createdAt',
      classSummaries: '++id, summaryId, sessionId, createdAt',
      notes: '++id, noteId, sessionId, studentId, source, createdAt',
      tutorResponseCache: '++id, anchorId, sessionId, timestamp, createdAt'
    });
    
    // 版本 4: 添加对话历史表
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
      conversationMessages: '++id, messageId, conversationId, createdAt'
    });
    
    // 版本 5: 修复复合索引问题
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
      conversationMessages: '++id, messageId, conversationId, createdAt'
    });
    
    // 版本 6: 添加 userId 字段索引，支持用户数据隔离
    this.version(6).stores({
      audioSessions: '++id, sessionId, userId, status, createdAt, [userId+status], [userId+createdAt]',
      anchors: '++id, sessionId, userId, timestamp, status, type, [userId+sessionId]',
      transcripts: '++id, sessionId, userId, startMs, isFinal, [userId+sessionId]',
      preferences: 'key',
      highlightTopics: '++id, topicId, sessionId, userId, importance, createdAt, [userId+sessionId]',
      classSummaries: '++id, summaryId, sessionId, userId, createdAt, [userId+sessionId]',
      notes: '++id, noteId, sessionId, studentId, source, createdAt',
      tutorResponseCache: '++id, anchorId, sessionId, userId, timestamp, createdAt, [userId+sessionId]',
      conversationHistory: '++id, conversationId, userId, type, sessionId, anchorId, [userId+type], updatedAt',
      conversationMessages: '++id, messageId, conversationId, createdAt'
    }).upgrade(tx => {
      // 迁移现有数据：为没有 userId 的记录设置默认值 'anonymous'
      const defaultUserId = 'anonymous';
      
      return Promise.all([
        tx.table('audioSessions').toCollection().modify(record => {
          if (!record.userId) record.userId = defaultUserId;
        }),
        tx.table('anchors').toCollection().modify(record => {
          if (!record.userId) record.userId = defaultUserId;
        }),
        tx.table('transcripts').toCollection().modify(record => {
          if (!record.userId) record.userId = defaultUserId;
        }),
        tx.table('highlightTopics').toCollection().modify(record => {
          if (!record.userId) record.userId = defaultUserId;
        }),
        tx.table('classSummaries').toCollection().modify(record => {
          if (!record.userId) record.userId = defaultUserId;
        }),
        tx.table('tutorResponseCache').toCollection().modify(record => {
          if (!record.userId) record.userId = defaultUserId;
        }),
      ]);
    });
  }
}

// 单例导出
export const db = new MeetMindDB();

/** 生成 UUID */
export function generateSessionId(): string {
  return crypto.randomUUID();
}
