/**
 * 精选片段 (HighlightTopic) 数据库操作
 * Owner: 笔记内容模块开发者
 */

import { db, type HighlightTopic } from './schema';

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
