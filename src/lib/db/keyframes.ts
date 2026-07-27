/**
 * 课中关键帧（「截取这一页」）数据库操作
 * 与转录段共用录音时间轴；课后上传服务端后回写 mediaUrl/uploaded。
 */

import { db, type KeyframeRecord } from './schema';

/** 存一帧（课中按下截图时） */
export async function addKeyframe(
  sessionId: string,
  timestampMs: number,
  blob: Blob,
): Promise<number> {
  return db.keyframes.add({
    sessionId,
    timestampMs,
    blob,
    uploaded: false,
    createdAt: new Date(),
  });
}

/** 取某节课的全部关键帧（按时间轴排序） */
export async function getSessionKeyframes(sessionId: string): Promise<KeyframeRecord[]> {
  return db.keyframes.where('sessionId').equals(sessionId).sortBy('timestampMs');
}

/** 取尚未上传的关键帧（课后上传/重试用） */
export async function getPendingKeyframes(sessionId: string): Promise<KeyframeRecord[]> {
  const frames = await getSessionKeyframes(sessionId);
  return frames.filter((frame) => !frame.uploaded);
}

/** 上传成功后回写 */
export async function markKeyframeUploaded(id: number, mediaUrl: string): Promise<void> {
  await db.keyframes.update(id, { uploaded: true, mediaUrl });
}

/** 删除某节课的全部关键帧（清理/隐私） */
export async function deleteSessionKeyframes(sessionId: string): Promise<void> {
  await db.keyframes.where('sessionId').equals(sessionId).delete();
}
