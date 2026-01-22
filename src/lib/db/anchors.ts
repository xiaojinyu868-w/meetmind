/**
 * 困惑点/锚点 (Anchor) 数据库操作
 * Owner: 录音模块开发者
 */

import { db, type Anchor } from './schema';

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

/** 获取会话的所有困惑点 */
export async function getSessionAnchors(sessionId: string): Promise<Anchor[]> {
  return db.anchors
    .where('sessionId')
    .equals(sessionId)
    .sortBy('timestamp');
}
