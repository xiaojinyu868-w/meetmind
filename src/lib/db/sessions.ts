/**
 * 音频会话 (AudioSession) 数据库操作
 * Owner: 录音模块开发者
 */

import { db, type AudioSession } from './schema';

/** 默认用户ID（未登录时使用） */
export const ANONYMOUS_USER_ID = 'anonymous';

/**
 * 保存音频会话（upsert 语义）
 *
 * ⚠️ 修复 2026-04-18：原实现总是走 db.audioSessions.add(...)，加上 classroomDataService
 * 在录音开始时（status='recording'，无 blob）也会 add 一条空壳，
 * 导致**同一个 sessionId 在 audioSessions 表里被写成 2 条记录**——
 * 课堂列表就会看到"同一节课出现两张卡"，点进去 `.first()` 拿到的是最早
 * 那条（可能是空壳 / 可能残留前次状态），UI 就串台了。
 *
 * 现在改为 upsert：
 *   - 按 sessionId 查是否已有记录
 *   - 有：部分字段 update（只覆盖本次显式传入的字段，避免把旧 blob/videoUrl 丢了）
 *   - 没有：按原逻辑 add
 *
 * 返回的 number：update 时返回 existing.id，add 时返回新 id。
 */
export async function saveAudioSession(
  blob: Blob | null,
  sessionId: string,
  userId: string,
  options: {
    subject?: string;
    topic?: string;
    duration?: number;
    sourceType?: AudioSession['sourceType'];
    mediaUrl?: string;
    videoUrl?: string;
    videoEmbedUrl?: string;
    videoProvider?: string;
    thumbnailUrl?: string;
    importSourceMode?: AudioSession['importSourceMode'];
    importTrace?: AudioSession['importTrace'];
    mimeType?: string;
  } = {}
): Promise<number> {
  const existing = await db.audioSessions
    .where('sessionId')
    .equals(sessionId)
    .first();

  if (existing && existing.id != null) {
    // 构造局部 update：只覆盖本次显式给出的字段。
    // 特别地：blob 和 mediaUrl / videoUrl 只有这次有值才覆盖，否则保留旧的
    //（一次录音结束带 blob 过来，不应覆盖已经写好的 videoUrl，反之亦然）。
    const patch: Partial<AudioSession> = {
      updatedAt: new Date(),
    };
    if (blob) {
      patch.blob = blob;
      patch.mimeType = options.mimeType || blob.type || existing.mimeType || 'audio/webm';
    } else if (options.mimeType) {
      patch.mimeType = options.mimeType;
    }
    if (options.duration != null && options.duration > 0) patch.duration = options.duration;
    if (options.subject !== undefined) patch.subject = options.subject;
    if (options.topic !== undefined && options.topic !== '') patch.topic = options.topic;
    if (options.sourceType) patch.sourceType = options.sourceType;
    if (options.mediaUrl !== undefined) patch.mediaUrl = options.mediaUrl;
    if (options.videoUrl !== undefined) patch.videoUrl = options.videoUrl;
    if (options.videoEmbedUrl !== undefined) patch.videoEmbedUrl = options.videoEmbedUrl;
    if (options.videoProvider !== undefined) patch.videoProvider = options.videoProvider;
    if (options.thumbnailUrl !== undefined) patch.thumbnailUrl = options.thumbnailUrl;
    if (options.importSourceMode !== undefined) patch.importSourceMode = options.importSourceMode;
    if (options.importTrace !== undefined) patch.importTrace = options.importTrace;
    // 录音进行中写进来的通常是 'recording'，结束时这里写 'completed' 才对
    // —— 由 saveAudioSession 的语义保证：本函数只在"有内容要落"的时刻被调用
    patch.status = 'completed';

    await db.audioSessions.update(existing.id, patch);
    return existing.id;
  }

  return db.audioSessions.add({
    sessionId,
    userId: userId || ANONYMOUS_USER_ID,
    ...(blob ? { blob } : {}),
    mimeType: options.mimeType || blob?.type || 'audio/webm',
    duration: options.duration ?? 0,
    subject: options.subject,
    topic: options.topic,
    sourceType: options.sourceType || 'recording',
    mediaUrl: options.mediaUrl,
    videoUrl: options.videoUrl,
    videoEmbedUrl: options.videoEmbedUrl,
    videoProvider: options.videoProvider,
    thumbnailUrl: options.thumbnailUrl,
    importSourceMode: options.importSourceMode,
    importTrace: options.importTrace,
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

/** 更新会话标题/主题 */
export async function updateSessionTopic(
  sessionId: string,
  topic: string
): Promise<void> {
  await db.audioSessions
    .where('sessionId')
    .equals(sessionId)
    .modify({ topic, updatedAt: new Date() });
}

/** 获取今日会话（按用户） */
export async function getTodaySessions(userId: string): Promise<AudioSession[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  return db.audioSessions
    .where('userId')
    .equals(userId || ANONYMOUS_USER_ID)
    .and(session => session.createdAt >= today)
    .toArray();
}

/**
 * 去重：同一 sessionId 在 audioSessions 表中只保留"信息量最多的一条"。
 *
 * 背景（2026-04-18）：早期 saveAudioSession 总是 add，加上 classroomDataService
 * 在录音开始时就 add 了一条空壳（status='recording'、无 blob），
 * 历史数据里有用户的 audioSessions 表按同一 sessionId 残留了多行。
 *
 * 幂等。在课堂列表挂载时调用一次就能把历史脏数据清理掉；后续 saveAudioSession
 * 已经改为 upsert，不会再产生新的重复。
 *
 * 策略：
 *   1. 按 sessionId 分组
 *   2. 如果一组里只有 1 行：跳过
 *   3. 如果 >1 行：合并字段（"更好的"覆盖"更弱的"）：
 *      - blob：任一有则保留
 *      - videoUrl / mediaUrl / thumbnailUrl 等：任一有则保留
 *      - sourceType：video-* > upload > recording（视频信息优先）
 *      - duration：取最大
 *      - createdAt：取最早
 *      - updatedAt：取最新
 *      - status：如果有任何一条是 completed/archived，就用 completed
 *   4. 把合并结果 put 回"最小 id"那条，其余 delete
 *
 * 返回 { scanned, merged, deleted }。
 */
export async function dedupeAudioSessions(): Promise<{
  scanned: number;
  merged: number;
  deleted: number;
}> {
  const all = await db.audioSessions.toArray();

  // 按 sessionId 分组
  const groups = new Map<string, AudioSession[]>();
  for (const row of all) {
    if (!row.sessionId) continue; // 防御：数据损坏
    const arr = groups.get(row.sessionId) ?? [];
    arr.push(row);
    groups.set(row.sessionId, arr);
  }

  let merged = 0;
  let deleted = 0;

  for (const [, rows] of groups) {
    if (rows.length <= 1) continue;

    // 按 primary key 升序，保留 id 最小的那条作为基座
    rows.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
    const base = rows[0];
    if (base.id == null) continue;

    // 合并：遍历其余行，把"更完整/更新"的字段搬到 base 上
    let hasChange = false;
    for (let i = 1; i < rows.length; i += 1) {
      const r = rows[i];

      if (!base.blob && r.blob) { base.blob = r.blob; hasChange = true; }
      if (!base.mediaUrl && r.mediaUrl) { base.mediaUrl = r.mediaUrl; hasChange = true; }
      if (!base.videoUrl && r.videoUrl) { base.videoUrl = r.videoUrl; hasChange = true; }
      if (!base.videoEmbedUrl && r.videoEmbedUrl) { base.videoEmbedUrl = r.videoEmbedUrl; hasChange = true; }
      if (!base.videoProvider && r.videoProvider) { base.videoProvider = r.videoProvider; hasChange = true; }
      if (!base.thumbnailUrl && r.thumbnailUrl) { base.thumbnailUrl = r.thumbnailUrl; hasChange = true; }
      if (!base.importSourceMode && r.importSourceMode) { base.importSourceMode = r.importSourceMode; hasChange = true; }
      if (!base.importTrace && r.importTrace) { base.importTrace = r.importTrace; hasChange = true; }
      if (!base.topic && r.topic) { base.topic = r.topic; hasChange = true; }
      if (!base.subject && r.subject) { base.subject = r.subject; hasChange = true; }

      // sourceType 优先级：video-* > upload > recording（有 videoUrl 就该标为 video-link）
      const rank = (t?: AudioSession['sourceType']) =>
        t === 'video-link' ? 4 : t === 'video-file' ? 3 : t === 'upload' ? 2 : 1;
      if (rank(r.sourceType) > rank(base.sourceType)) {
        base.sourceType = r.sourceType;
        hasChange = true;
      }

      // duration 取最大
      if ((r.duration || 0) > (base.duration || 0)) {
        base.duration = r.duration;
        hasChange = true;
      }

      // createdAt 取最早
      const rCreated = r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt);
      const bCreated = base.createdAt instanceof Date ? base.createdAt : new Date(base.createdAt);
      if (rCreated.getTime() < bCreated.getTime()) {
        base.createdAt = rCreated;
        hasChange = true;
      }

      // updatedAt 取最新
      const rUpdated = r.updatedAt instanceof Date ? r.updatedAt : new Date(r.updatedAt);
      const bUpdated = base.updatedAt instanceof Date ? base.updatedAt : new Date(base.updatedAt);
      if (rUpdated.getTime() > bUpdated.getTime()) {
        base.updatedAt = rUpdated;
        hasChange = true;
      }

      // status：任一 completed/archived 都升级到 completed
      if (r.status === 'completed' || r.status === 'archived') {
        if (base.status !== 'completed' && base.status !== 'archived') {
          base.status = 'completed';
          hasChange = true;
        }
      }
    }

    // 把合并后的 base 写回（如果真的变了）
    if (hasChange) {
      const { id, ...patch } = base;
      void id; // 不参与 update 的 patch
      await db.audioSessions.update(base.id, patch);
      merged += 1;
    }

    // 删除其余
    const toDelete = rows.slice(1)
      .map(r => r.id)
      .filter((v): v is number => typeof v === 'number');
    if (toDelete.length > 0) {
      await db.audioSessions.bulkDelete(toDelete);
      deleted += toDelete.length;
    }
  }

  return { scanned: all.length, merged, deleted };
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

/** 获取所有会话列表（按创建时间倒序，按用户过滤） */
export async function getAllSessions(userId: string): Promise<AudioSession[]> {
  return db.audioSessions
    .where('userId')
    .equals(userId || ANONYMOUS_USER_ID)
    .reverse()
    .sortBy('createdAt');
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
