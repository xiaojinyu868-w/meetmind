/**
 * AI 家教响应缓存 (TutorResponseCache) 数据库操作
 * Owner: AI家教模块开发者
 */

import { db, type TutorResponseCache } from './schema';

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

/** 获取困惑点的 AI 家教响应缓存（按用户过滤） */
export async function getTutorResponseCache(
  anchorId: string,
  userId: string
): Promise<TutorResponseCache | undefined> {
  const cache = await db.tutorResponseCache
    .where('anchorId')
    .equals(anchorId)
    .first();
  
  // 验证用户权限
  if (cache && cache.userId !== userId && cache.userId !== 'anonymous') {
    return undefined;
  }
  
  return cache;
}

/** 获取会话的所有 AI 家教响应缓存（按用户过滤） */
export async function getSessionTutorCaches(
  sessionId: string,
  userId: string
): Promise<TutorResponseCache[]> {
  return db.tutorResponseCache
    .where('[userId+sessionId]')
    .equals([userId, sessionId])
    .sortBy('timestamp');
}

/** 更新 AI 家教响应缓存 */
export async function updateTutorResponseCache(
  anchorId: string,
  updates: Partial<Omit<TutorResponseCache, 'id' | 'anchorId' | 'sessionId' | 'userId' | 'createdAt'>>
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
export async function deleteSessionTutorCaches(
  sessionId: string,
  userId: string
): Promise<number> {
  return db.tutorResponseCache
    .where('[userId+sessionId]')
    .equals([userId, sessionId])
    .delete();
}

/** 删除用户的所有 AI 家教响应缓存 */
export async function deleteUserTutorCaches(userId: string): Promise<number> {
  return db.tutorResponseCache
    .where('userId')
    .equals(userId)
    .delete();
}
