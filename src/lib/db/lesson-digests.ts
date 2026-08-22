/**
 * 课堂笔记 (LessonDigest) 缓存操作
 * 按 sessionId 存一份，内容签名（signature）变化时覆盖。
 */

import { db, type LessonDigestRecord } from './schema';

/** 读取会话缓存的课堂笔记 */
export async function getSessionLessonDigest(sessionId: string): Promise<LessonDigestRecord | undefined> {
  return db.lessonDigests
    .where('sessionId')
    .equals(sessionId)
    .first();
}

/** 保存（或覆盖）会话的课堂笔记缓存 */
export async function saveSessionLessonDigest(
  sessionId: string,
  signature: string,
  digest: unknown
): Promise<void> {
  const now = new Date();
  const existing = await db.lessonDigests
    .where('sessionId')
    .equals(sessionId)
    .first();
  if (existing?.id != null) {
    await db.lessonDigests.update(existing.id, { signature, digest, updatedAt: now });
    return;
  }
  await db.lessonDigests.add({ sessionId, signature, digest, createdAt: now, updatedAt: now });
}

/** 删除会话的课堂笔记缓存 */
export async function deleteSessionLessonDigest(sessionId: string): Promise<number> {
  return db.lessonDigests
    .where('sessionId')
    .equals(sessionId)
    .delete();
}
