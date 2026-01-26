/**
 * 音频会话 (AudioSession) 数据库操作
 * Owner: 录音模块开发者
 */

import { db, type AudioSession } from './schema';

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

/** 获取今日会话 */
export async function getTodaySessions(): Promise<AudioSession[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  return db.audioSessions
    .where('createdAt')
    .aboveOrEqual(today)
    .toArray();
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

/** 获取所有会话列表（按创建时间倒序） */
export async function getAllSessions(): Promise<AudioSession[]> {
  return db.audioSessions
    .orderBy('createdAt')
    .reverse()
    .toArray();
}

/** 根据 sessionId 获取单个会话 */
export async function getSessionById(sessionId: string): Promise<AudioSession | undefined> {
  return db.audioSessions
    .where('sessionId')
    .equals(sessionId)
    .first();
}

/** 删除会话及其关联数据 */
export async function deleteSession(sessionId: string): Promise<void> {
  await Promise.all([
    db.transcripts.where('sessionId').equals(sessionId).delete(),
    db.anchors.where('sessionId').equals(sessionId).delete(),
    db.highlightTopics.where('sessionId').equals(sessionId).delete(),
    db.classSummaries.where('sessionId').equals(sessionId).delete(),
    db.notes.where('sessionId').equals(sessionId).delete(),
    db.tutorResponseCache.where('sessionId').equals(sessionId).delete(),
    db.conversationHistory.where('sessionId').equals(sessionId).delete(),
  ]);
  await db.audioSessions.where('sessionId').equals(sessionId).delete();
}
