// Dexie.js 数据库定义
// 复用 Dexie.js (13.9k stars) 实现 IndexedDB 封装

import Dexie, { Table } from 'dexie';

// ============ 数据模型 ============

/** 音频会话 */
export interface AudioSession {
  id?: number;
  sessionId: string;           // UUID
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

class MeetMindDB extends Dexie {
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
  }
}

// 单例导出
export const db = new MeetMindDB();

// ============ 辅助函数 ============

/** 生成 UUID */
export function generateSessionId(): string {
  return crypto.randomUUID();
}

/** 保存音频会话 */
export async function saveAudioSession(
  blob: Blob,
  sessionId: string,
  options: { subject?: string; topic?: string; duration?: number } = {}
): Promise<number> {
  return db.audioSessions.add({
    sessionId,
    blob,
    mimeType: blob.type || 'audio/webm',
    duration: options.duration ?? 0,
    subject: options.subject,
    topic: options.topic,
    status: 'completed',
    createdAt: new Date(),
    updatedAt: new Date()
  });
}

/** 更新会话状态 */
export async function updateSessionStatus(
  sessionId: string,
  status: AudioSession['status']
): Promise<void> {
  await db.audioSessions
    .where('sessionId')
    .equals(sessionId)
    .modify({ status, updatedAt: new Date() });
}

/** 添加困惑点 */
export async function addAnchor(
  sessionId: string,
  timestamp: number,
  type: Anchor['type'] = 'confusion',
  note?: string
): Promise<number> {
  return db.anchors.add({
    sessionId,
    timestamp,
    type,
    status: 'active',
    note,
    createdAt: new Date()
  });
}

/** 标记困惑点已解决 */
export async function resolveAnchor(
  anchorId: number,
  aiExplanation?: string
): Promise<void> {
  await db.anchors.update(anchorId, {
    status: 'resolved',
    aiExplanation,
    resolvedAt: new Date()
  });
}

/** 添加转录片段 */
export async function addTranscript(
  sessionId: string,
  text: string,
  startMs: number,
  endMs: number,
  options: { speakerId?: string; confidence?: number; isFinal?: boolean } = {}
): Promise<number> {
  return db.transcripts.add({
    sessionId,
    text,
    startMs,
    endMs,
    speakerId: options.speakerId,
    confidence: options.confidence ?? 1.0,
    isFinal: options.isFinal ?? true
  });
}

/** 获取会话的所有转录 */
export async function getSessionTranscripts(sessionId: string): Promise<TranscriptSegment[]> {
  return db.transcripts
    .where('sessionId')
    .equals(sessionId)
    .sortBy('startMs');
}

/** 获取会话的所有困惑点 */
export async function getSessionAnchors(sessionId: string): Promise<Anchor[]> {
  return db.anchors
    .where('sessionId')
    .equals(sessionId)
    .sortBy('timestamp');
}

/** 获取今日会话 */
export async function getTodaySessions(): Promise<AudioSession[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  return db.audioSessions
    .where('createdAt')
    .aboveOrEqual(today)
    .toArray();
}

/** 获取用户偏好 */
export async function getPreference<T>(key: string, defaultValue: T): Promise<T> {
  const pref = await db.preferences.get(key);
  return pref?.value ?? defaultValue;
}

/** 设置用户偏好 */
export async function setPreference<T>(key: string, value: T): Promise<void> {
  await db.preferences.put({ key, value });
}

/** 清理旧数据（保留最近 N 天） */
export async function cleanOldData(daysToKeep: number = 30): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysToKeep);
  
  // 获取要删除的会话
  const oldSessions = await db.audioSessions
    .where('createdAt')
    .below(cutoff)
    .toArray();
  
  const sessionIds = oldSessions.map(s => s.sessionId);
  
  // 删除相关数据
  await db.transcripts.where('sessionId').anyOf(sessionIds).delete();
  await db.anchors.where('sessionId').anyOf(sessionIds).delete();
  const deleted = await db.audioSessions.where('createdAt').below(cutoff).delete();
  
  return deleted;
}

/** 获取存储空间使用情况 */
export async function getStorageUsage(): Promise<{ sessions: number; anchors: number; transcripts: number }> {
  const [sessions, anchors, transcripts] = await Promise.all([
    db.audioSessions.count(),
    db.anchors.count(),
    db.transcripts.count()
  ]);
  return { sessions, anchors, transcripts };
}

// ============ 精选片段 (Highlight Topics) 操作 ============

/** 保存精选片段 */
export async function saveHighlightTopics(
  sessionId: string,
  topics: Omit<HighlightTopic, 'id' | 'createdAt' | 'updatedAt'>[]
): Promise<number[]> {
  const now = new Date();
  const records = topics.map(t => ({
    ...t,
    sessionId,
    createdAt: now,
    updatedAt: now
  }));
  return db.highlightTopics.bulkAdd(records);
}

/** 获取会话的精选片段 */
export async function getSessionHighlightTopics(sessionId: string): Promise<HighlightTopic[]> {
  return db.highlightTopics
    .where('sessionId')
    .equals(sessionId)
    .sortBy('createdAt');
}

/** 删除会话的所有精选片段 */
export async function deleteSessionHighlightTopics(sessionId: string): Promise<number> {
  return db.highlightTopics
    .where('sessionId')
    .equals(sessionId)
    .delete();
}

/** 更新精选片段 */
export async function updateHighlightTopic(
  topicId: string,
  updates: Partial<Omit<HighlightTopic, 'id' | 'topicId' | 'sessionId' | 'createdAt'>>
): Promise<number> {
  return db.highlightTopics
    .where('topicId')
    .equals(topicId)
    .modify({ ...updates, updatedAt: new Date() });
}

// ============ 课堂摘要 (Class Summary) 操作 ============

/** 保存课堂摘要 */
export async function saveClassSummary(
  summary: Omit<ClassSummary, 'id' | 'createdAt' | 'updatedAt'>
): Promise<number> {
  const now = new Date();
  return db.classSummaries.add({
    ...summary,
    createdAt: now,
    updatedAt: now
  });
}

/** 获取会话的课堂摘要 */
export async function getSessionSummary(sessionId: string): Promise<ClassSummary | undefined> {
  return db.classSummaries
    .where('sessionId')
    .equals(sessionId)
    .first();
}

/** 删除会话的摘要 */
export async function deleteSessionSummary(sessionId: string): Promise<number> {
  return db.classSummaries
    .where('sessionId')
    .equals(sessionId)
    .delete();
}

/** 更新课堂摘要 */
export async function updateClassSummary(
  summaryId: string,
  updates: Partial<Omit<ClassSummary, 'id' | 'summaryId' | 'sessionId' | 'createdAt'>>
): Promise<number> {
  return db.classSummaries
    .where('summaryId')
    .equals(summaryId)
    .modify({ ...updates, updatedAt: new Date() });
}

// ============ 个人笔记 (Notes) 操作 ============

/** 添加笔记 */
export async function addNote(
  note: Omit<Note, 'id' | 'createdAt' | 'updatedAt'>
): Promise<number> {
  const now = new Date();
  return db.notes.add({
    ...note,
    createdAt: now,
    updatedAt: now
  });
}

/** 获取会话的所有笔记 */
export async function getSessionNotes(sessionId: string): Promise<Note[]> {
  return db.notes
    .where('sessionId')
    .equals(sessionId)
    .sortBy('createdAt');
}

/** 获取学生的所有笔记 */
export async function getStudentNotes(studentId: string): Promise<Note[]> {
  return db.notes
    .where('studentId')
    .equals(studentId)
    .reverse()
    .sortBy('createdAt');
}

/** 获取所有笔记（带分页） */
export async function getAllNotes(options: {
  offset?: number;
  limit?: number;
  studentId?: string;
} = {}): Promise<Note[]> {
  let query = db.notes.orderBy('createdAt').reverse();
  
  if (options.studentId) {
    query = db.notes.where('studentId').equals(options.studentId).reverse();
  }
  
  if (options.offset) {
    query = query.offset(options.offset);
  }
  
  if (options.limit) {
    query = query.limit(options.limit);
  }
  
  return query.toArray();
}

/** 更新笔记 */
export async function updateNote(
  noteId: string,
  updates: Partial<Omit<Note, 'id' | 'noteId' | 'sessionId' | 'studentId' | 'createdAt'>>
): Promise<number> {
  return db.notes
    .where('noteId')
    .equals(noteId)
    .modify({ ...updates, updatedAt: new Date() });
}

/** 删除笔记 */
export async function deleteNote(noteId: string): Promise<number> {
  return db.notes
    .where('noteId')
    .equals(noteId)
    .delete();
}

/** 删除会话的所有笔记 */
export async function deleteSessionNotes(sessionId: string): Promise<number> {
  return db.notes
    .where('sessionId')
    .equals(sessionId)
    .delete();
}

/** 按来源获取笔记 */
export async function getNotesBySource(
  sessionId: string,
  source: Note['source']
): Promise<Note[]> {
  return db.notes
    .where(['sessionId', 'source'])
    .equals([sessionId, source])
    .sortBy('createdAt');
}

// ============ AI 家教响应缓存操作 ============

/** 保存 AI 家教响应缓存 */
export async function saveTutorResponseCache(
  cache: Omit<TutorResponseCache, 'id' | 'createdAt' | 'updatedAt'>
): Promise<number> {
  const now = new Date();
  
  // 检查是否已存在，存在则更新
  const existing = await db.tutorResponseCache
    .where('anchorId')
    .equals(cache.anchorId)
    .first();
  
  if (existing) {
    await db.tutorResponseCache.update(existing.id!, {
      ...cache,
      updatedAt: now
    });
    return existing.id!;
  }
  
  return db.tutorResponseCache.add({
    ...cache,
    createdAt: now,
    updatedAt: now
  });
}

/** 获取困惑点的 AI 家教响应缓存 */
export async function getTutorResponseCache(anchorId: string): Promise<TutorResponseCache | undefined> {
  return db.tutorResponseCache
    .where('anchorId')
    .equals(anchorId)
    .first();
}

/** 获取会话的所有 AI 家教响应缓存 */
export async function getSessionTutorCaches(sessionId: string): Promise<TutorResponseCache[]> {
  return db.tutorResponseCache
    .where('sessionId')
    .equals(sessionId)
    .sortBy('timestamp');
}

/** 更新 AI 家教响应缓存 */
export async function updateTutorResponseCache(
  anchorId: string,
  updates: Partial<Omit<TutorResponseCache, 'id' | 'anchorId' | 'sessionId' | 'createdAt'>>
): Promise<number> {
  return db.tutorResponseCache
    .where('anchorId')
    .equals(anchorId)
    .modify({ ...updates, updatedAt: new Date() });
}

/** 删除困惑点的 AI 家教响应缓存 */
export async function deleteTutorResponseCache(anchorId: string): Promise<number> {
  return db.tutorResponseCache
    .where('anchorId')
    .equals(anchorId)
    .delete();
}

/** 删除会话的所有 AI 家教响应缓存 */
export async function deleteSessionTutorCaches(sessionId: string): Promise<number> {
  return db.tutorResponseCache
    .where('sessionId')
    .equals(sessionId)
    .delete();
}

// ============ 对话历史操作 ============

/** 创建对话历史 */
export async function createConversationHistory(
  conversation: Omit<ConversationHistoryRecord, 'id' | 'createdAt' | 'updatedAt'>
): Promise<number> {
  const now = new Date();
  return db.conversationHistory.add({
    ...conversation,
    createdAt: now,
    updatedAt: now
  });
}

/** 根据 conversationId 获取对话历史 */
export async function getConversationById(conversationId: string): Promise<ConversationHistoryRecord | undefined> {
  return db.conversationHistory
    .where('conversationId')
    .equals(conversationId)
    .first();
}

/** 根据 anchorId 获取对话历史（tutor 类型） */
export async function getConversationByAnchorId(anchorId: string): Promise<ConversationHistoryRecord | undefined> {
  return db.conversationHistory
    .where('anchorId')
    .equals(anchorId)
    .first();
}

/** 获取用户的对话历史列表 */
export async function getUserConversations(
  userId: string,
  options: { type?: 'tutor' | 'chat'; sessionId?: string; limit?: number; offset?: number } = {}
): Promise<ConversationHistoryRecord[]> {
  let collection;
  
  if (options.type) {
    collection = db.conversationHistory
      .where('[userId+type]')
      .equals([userId, options.type]);
  } else {
    collection = db.conversationHistory
      .where('userId')
      .equals(userId);
  }
  
  let results = await collection.reverse().sortBy('updatedAt');
  
  // 按 sessionId 过滤
  if (options.sessionId) {
    results = results.filter(r => r.sessionId === options.sessionId);
  }
  
  // 分页
  if (options.offset) {
    results = results.slice(options.offset);
  }
  if (options.limit) {
    results = results.slice(0, options.limit);
  }
  
  return results;
}

/** 搜索用户对话历史 */
export async function searchUserConversations(
  userId: string,
  keyword: string,
  options: { type?: 'tutor' | 'chat'; limit?: number } = {}
): Promise<ConversationHistoryRecord[]> {
  const lowerKeyword = keyword.toLowerCase();
  
  let collection;
  if (options.type) {
    collection = db.conversationHistory
      .where('[userId+type]')
      .equals([userId, options.type]);
  } else {
    collection = db.conversationHistory
      .where('userId')
      .equals(userId);
  }
  
  const all = await collection.toArray();
  
  // 在标题和最后消息中搜索
  let results = all.filter(c => 
    c.title.toLowerCase().includes(lowerKeyword) ||
    (c.lastMessage && c.lastMessage.toLowerCase().includes(lowerKeyword))
  );
  
  // 按更新时间降序
  results.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  
  if (options.limit) {
    results = results.slice(0, options.limit);
  }
  
  return results;
}

/** 更新对话历史 */
export async function updateConversationHistory(
  conversationId: string,
  updates: Partial<Omit<ConversationHistoryRecord, 'id' | 'conversationId' | 'userId' | 'createdAt'>>
): Promise<number> {
  return db.conversationHistory
    .where('conversationId')
    .equals(conversationId)
    .modify({ ...updates, updatedAt: new Date() });
}

/** 删除对话历史（包括消息） */
export async function deleteConversationHistory(conversationId: string): Promise<void> {
  await db.transaction('rw', [db.conversationHistory, db.conversationMessages], async () => {
    await db.conversationMessages
      .where('conversationId')
      .equals(conversationId)
      .delete();
    await db.conversationHistory
      .where('conversationId')
      .equals(conversationId)
      .delete();
  });
}

/** 删除用户所有对话历史 */
export async function deleteUserConversations(userId: string): Promise<void> {
  const conversations = await db.conversationHistory
    .where('userId')
    .equals(userId)
    .toArray();
  
  const conversationIds = conversations.map(c => c.conversationId);
  
  await db.transaction('rw', [db.conversationHistory, db.conversationMessages], async () => {
    await db.conversationMessages
      .where('conversationId')
      .anyOf(conversationIds)
      .delete();
    await db.conversationHistory
      .where('userId')
      .equals(userId)
      .delete();
  });
}

// ============ 对话消息操作 ============

/** 添加对话消息 */
export async function addConversationMessage(
  message: Omit<ConversationMessageRecord, 'id' | 'createdAt'>
): Promise<number> {
  return db.conversationMessages.add({
    ...message,
    createdAt: new Date()
  });
}

/** 批量添加对话消息 */
export async function addConversationMessages(
  messages: Omit<ConversationMessageRecord, 'id' | 'createdAt'>[]
): Promise<number[]> {
  const now = new Date();
  const records = messages.map(m => ({
    ...m,
    createdAt: now
  }));
  return db.conversationMessages.bulkAdd(records, { allKeys: true }) as Promise<number[]>;
}

/** 获取对话的所有消息 */
export async function getConversationMessages(conversationId: string): Promise<ConversationMessageRecord[]> {
  return db.conversationMessages
    .where('conversationId')
    .equals(conversationId)
    .sortBy('createdAt');
}

/** 获取对话消息数量 */
export async function getConversationMessageCount(conversationId: string): Promise<number> {
  return db.conversationMessages
    .where('conversationId')
    .equals(conversationId)
    .count();
}

/** 删除对话的所有消息 */
export async function deleteConversationMessages(conversationId: string): Promise<number> {
  return db.conversationMessages
    .where('conversationId')
    .equals(conversationId)
    .delete();
}
