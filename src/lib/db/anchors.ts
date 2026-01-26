/**
 * 困惑点/锚点 (Anchor) 数据库操作
 * Owner: 录音模块开发者
 */

import { db, type Anchor } from './schema';

/** 添加困惑点 */
export async function addAnchor(
  sessionId: string,
  userId: string,
  timestamp: number,
  type: Anchor['type'] = 'confusion',
  note?: string
): Promise<number> {
  return db.anchors.add({
    sessionId,
    userId,
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

/** 获取会话的所有困惑点（按用户过滤） */
export async function getSessionAnchors(
  sessionId: string,
  userId: string
): Promise<Anchor[]> {
  return db.anchors
    .where('[userId+sessionId]')
    .equals([userId, sessionId])
    .sortBy('timestamp');
}

/** 获取用户的所有困惑点 */
export async function getUserAnchors(
  userId: string,
  options: { limit?: number; status?: Anchor['status'] } = {}
): Promise<Anchor[]> {
  let collection = db.anchors.where('userId').equals(userId);
  
  if (options.status) {
    collection = collection.filter(a => a.status === options.status);
  }
  
  let result = collection.reverse();
  
  if (options.limit) {
    result = result.limit(options.limit);
  }
  
  return result.toArray();
}

/** 删除会话的所有困惑点 */
export async function deleteSessionAnchors(
  sessionId: string,
  userId: string
): Promise<number> {
  return db.anchors
    .where('[userId+sessionId]')
    .equals([userId, sessionId])
    .delete();
}
