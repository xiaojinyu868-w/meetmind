/**
 * 音频会话 (AudioSession) 数据库操作
 * Owner: 录音模块开发者
 */

import { db, type AudioSession } from './schema';

/** 保存音频会话 */
export async function saveAudioSession(
  blob: Blob,
  sessionId: string,
  userId: string,
  options: { subject?: string; topic?: string; duration?: number } = {}
): Promise<number> {
  return db.audioSessions.add({
    sessionId,
    userId,
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

/** 获取今日会话（按用户过滤） */
export async function getTodaySessions(userId: string): Promise<AudioSession[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  return db.audioSessions
    .where('[userId+createdAt]')
    .between([userId, today], [userId, new Date()], true, true)
    .toArray();
}

/** 获取用户的所有会话 */
export async function getUserSessions(
  userId: string,
  options: { limit?: number; offset?: number; status?: AudioSession['status'] } = {}
): Promise<AudioSession[]> {
  let query = db.audioSessions.where('userId').equals(userId);
  
  if (options.status) {
    query = db.audioSessions.where('[userId+status]').equals([userId, options.status]);
  }
  
  let collection = query.reverse(); // 按时间倒序
  
  if (options.offset) {
    collection = collection.offset(options.offset);
  }
  
  if (options.limit) {
    collection = collection.limit(options.limit);
  }
  
  return collection.toArray();
}

/** 获取会话（验证用户权限） */
export async function getSession(
  sessionId: string,
  userId: string
): Promise<AudioSession | undefined> {
  const session = await db.audioSessions
    .where('sessionId')
    .equals(sessionId)
    .first();
  
  // 验证用户权限
  if (session && session.userId !== userId && session.userId !== 'anonymous') {
    return undefined;
  }
  
  return session;
}

/** 清理旧数据（保留最近 N 天，按用户过滤） */
export async function cleanOldData(userId: string, daysToKeep: number = 30): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysToKeep);
  
  // 获取要删除的会话
  const oldSessions = await db.audioSessions
    .where('userId')
    .equals(userId)
    .filter(s => s.createdAt < cutoff)
    .toArray();
  
  const sessionIds = oldSessions.map(s => s.sessionId);
  
  if (sessionIds.length === 0) return 0;
  
  // 删除相关数据
  await db.transcripts.where('sessionId').anyOf(sessionIds).delete();
  await db.anchors.where('sessionId').anyOf(sessionIds).delete();
  const deleted = await db.audioSessions
    .where('userId')
    .equals(userId)
    .filter(s => s.createdAt < cutoff)
    .delete();
  
  return deleted;
}

/** 获取存储空间使用情况（按用户过滤） */
export async function getStorageUsage(userId: string): Promise<{ sessions: number; anchors: number; transcripts: number }> {
  const [sessions, anchors, transcripts] = await Promise.all([
    db.audioSessions.where('userId').equals(userId).count(),
    db.anchors.where('userId').equals(userId).count(),
    db.transcripts.where('userId').equals(userId).count()
  ]);
  return { sessions, anchors, transcripts };
}

/** 删除单个会话及其所有关联数据 */
export async function deleteSession(sessionId: string, userId: string): Promise<boolean> {
  const session = await db.audioSessions
    .where('sessionId')
    .equals(sessionId)
    .first();
  
  // 验证权限：只能删除自己的会话或匿名会话
  if (!session || (session.userId !== userId && session.userId !== 'anonymous')) {
    return false;
  }
  
  // 删除所有关联数据
  await Promise.all([
    db.transcripts.where('sessionId').equals(sessionId).delete(),
    db.anchors.where('sessionId').equals(sessionId).delete(),
    db.highlightTopics.where('sessionId').equals(sessionId).delete(),
    db.classSummaries.where('sessionId').equals(sessionId).delete(),
    db.tutorResponseCache.where('sessionId').equals(sessionId).delete(),
    db.conversationHistory.where('sessionId').equals(sessionId).delete(),
    db.notes.where('sessionId').equals(sessionId).delete(),
  ]);
  
  await db.audioSessions.where('sessionId').equals(sessionId).delete();
  return true;
}

/** 删除用户的所有会话数据 */
export async function deleteUserSessions(userId: string): Promise<number> {
  const sessions = await db.audioSessions.where('userId').equals(userId).toArray();
  const sessionIds = sessions.map(s => s.sessionId);
  
  if (sessionIds.length === 0) return 0;
  
  // 删除相关数据
  await Promise.all([
    db.transcripts.where('sessionId').anyOf(sessionIds).delete(),
    db.anchors.where('sessionId').anyOf(sessionIds).delete(),
    db.highlightTopics.where('sessionId').anyOf(sessionIds).delete(),
    db.classSummaries.where('sessionId').anyOf(sessionIds).delete(),
    db.tutorResponseCache.where('sessionId').anyOf(sessionIds).delete(),
  ]);
  
  return db.audioSessions.where('userId').equals(userId).delete();
}
