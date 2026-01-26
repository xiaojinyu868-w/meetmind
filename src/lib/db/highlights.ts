/**
 * 精选片段 (HighlightTopic) 数据库操作
 * Owner: 笔记内容模块开发者
 */

import { db, type HighlightTopic } from './schema';

/** 保存精选片段 */
export async function saveHighlightTopics(
  sessionId: string,
  userId: string,
  topics: Omit<HighlightTopic, 'id' | 'sessionId' | 'userId' | 'createdAt' | 'updatedAt'>[]
): Promise<number[]> {
  const now = new Date();
  const records = topics.map(t => ({
    ...t,
    sessionId,
    userId,
    createdAt: now,
    updatedAt: now
  }));
  return db.highlightTopics.bulkAdd(records);
}

/** 获取会话的精选片段（按用户过滤） */
export async function getSessionHighlightTopics(
  sessionId: string,
  userId: string
): Promise<HighlightTopic[]> {
  return db.highlightTopics
    .where('[userId+sessionId]')
    .equals([userId, sessionId])
    .sortBy('createdAt');
}

/** 获取用户的所有精选片段 */
export async function getUserHighlightTopics(
  userId: string,
  options: { limit?: number } = {}
): Promise<HighlightTopic[]> {
  let collection = db.highlightTopics.where('userId').equals(userId).reverse();
  
  if (options.limit) {
    collection = collection.limit(options.limit);
  }
  
  return collection.toArray();
}

/** 删除会话的所有精选片段 */
export async function deleteSessionHighlightTopics(
  sessionId: string,
  userId: string
): Promise<number> {
  return db.highlightTopics
    .where('[userId+sessionId]')
    .equals([userId, sessionId])
    .delete();
}

/** 更新精选片段 */
export async function updateHighlightTopic(
  topicId: string,
  updates: Partial<Omit<HighlightTopic, 'id' | 'topicId' | 'sessionId' | 'userId' | 'createdAt'>>
): Promise<number> {
  return db.highlightTopics
    .where('topicId')
    .equals(topicId)
    .modify({ ...updates, updatedAt: new Date() });
}
