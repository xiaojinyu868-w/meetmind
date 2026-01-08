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

// ============ 数据库定义 ============

class MeetMindDB extends Dexie {
  audioSessions!: Table<AudioSession>;
  anchors!: Table<Anchor>;
  transcripts!: Table<TranscriptSegment>;
  preferences!: Table<Preference>;

  constructor() {
    super('MeetMindDB');
    this.version(1).stores({
      audioSessions: '++id, sessionId, status, createdAt',
      anchors: '++id, sessionId, timestamp, status, type',
      transcripts: '++id, sessionId, startMs, isFinal',
      preferences: 'key'
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
