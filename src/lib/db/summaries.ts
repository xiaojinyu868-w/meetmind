/**
 * 课堂摘要 (ClassSummary) 数据库操作
 * Owner: 笔记内容模块开发者
 */

import { db, type ClassSummary } from './schema';

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
