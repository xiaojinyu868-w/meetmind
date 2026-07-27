/**
 * 音频会话 (AudioSession) 数据库操作
 * Owner: 录音模块开发者
 */

import { db, type AudioSession } from './schema';

/** 默认用户ID（未登录时使用） */
export const ANONYMOUS_USER_ID = 'anonymous';

/**
 * 已知的默认占位 topic。
 *
 * 背景：早期代码里所有录音路径都会传 `topic: '课堂录音'`（UIConfig.defaultLessonTitle），
 * 而视频导入路径则会写入真实视频标题（如"一口气搞懂强化学习"）。当用户
 * 在视频上继续录音，upsert 就会把真实标题覆盖成占位，导致卡片看起来都
 * 一样。这里用一个小黑名单防守：遇到已知占位值就不盖已有具体内容。
 *
 * 这个列表保持小而精——只列真正的"默认占位"，不列用户可能合法输入的词。
 */
const PLACEHOLDER_TOPICS = new Set<string>([
  '课堂录音',
  '课堂回顾',
  '视频复习',
]);

function isPlaceholderTopic(topic: string | undefined | null): boolean {
  if (!topic) return true;
  const trimmed = topic.trim();
  if (trimmed === '') return true;
  return PLACEHOLDER_TOPICS.has(trimmed);
}

function isValidSessionIdKey(sessionId: unknown): sessionId is string {
  return typeof sessionId === 'string' && sessionId.trim().length > 0;
}

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
    transcriptionStatus?: AudioSession['transcriptionStatus'];
    transcriptionError?: string;
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
    // ── 身份冲突判定（2026-04-20）──
    //
    // 铁律：一条 audioSessions row 只承载一个身份。
    //
    // 场景：用户先导入了一条 B 站视频（"小猪佩奇"），sessionId=S1，写进来
    // sourceType='video-link', topic='小猪佩奇', videoUrl=pig.bili, thumbnailUrl=pig.jpg。
    // 然后用户在同一个 S1 上系统内录了一段"强化学习"，upsert 带 blob + sourceType='recording'
    // 进来。旧逻辑只改 sourceType，videoUrl/topic/thumbnailUrl 全部保留——结果卡片
    // 标题和封面还是小猪佩奇，但放的音是强化学习，用户体感"点强化学习卡片跳到
    // 小猪佩奇"。
    //
    // 解法：识别到"录音夺舍"（新身份是 recording，旧身份是 video-link），
    // 就在这一刻把视频身份字段全部清掉——此时用户的意图已经是"为这节课留录音"，
    // 视频链接只是当时的参考资料，不该再占用这节课的身份。
    //
    // 判定条件（三个都满足才触发夺舍）：
    //   1. 本次带 blob 进来（确认是录音路径）
    //   2. 本次显式标了 sourceType='recording'（确认是录音路径）
    //   3. 旧行是视频身份（sourceType === 'video-link' 或者有 videoUrl 但没 blob）
    const isRecordingTakeover =
      !!blob
      && options.sourceType === 'recording'
      && (existing.sourceType === 'video-link' || (!!existing.videoUrl && !existing.blob));

    // topic 覆盖策略：
    //   - 非空才覆盖（避免把已有标题清空）
    //   - 如果旧值已经是具体内容（不是我们已知的几个默认占位字符串），
    //     且新值正好是默认占位，就**别盖**——保护视频导入写入的真实标题
    //     在后续录音 upsert 时被"课堂录音"这种占位覆盖。
    //   - 但"录音夺舍"场景例外：旧 topic 是视频标题、不再代表这节课，
    //     主动清掉（置空 → undefined），让下游 adapter 兜底到"X 月 X 日的课"。
    if (isRecordingTakeover) {
      patch.topic = undefined;
    } else if (options.topic !== undefined && options.topic !== '') {
      const incomingIsPlaceholder = isPlaceholderTopic(options.topic);
      const existingIsMeaningful = !!existing.topic && !isPlaceholderTopic(existing.topic);
      if (!(incomingIsPlaceholder && existingIsMeaningful)) {
        patch.topic = options.topic;
      }
    }
    if (options.sourceType) patch.sourceType = options.sourceType;
    if (options.mediaUrl !== undefined) patch.mediaUrl = options.mediaUrl;
    if (options.videoUrl !== undefined) patch.videoUrl = options.videoUrl;
    if (options.videoEmbedUrl !== undefined) patch.videoEmbedUrl = options.videoEmbedUrl;
    if (options.videoProvider !== undefined) patch.videoProvider = options.videoProvider;
    if (options.thumbnailUrl !== undefined) patch.thumbnailUrl = options.thumbnailUrl;
    if (options.importSourceMode !== undefined) patch.importSourceMode = options.importSourceMode;
    if (options.importTrace !== undefined) patch.importTrace = options.importTrace;
    if (options.transcriptionStatus !== undefined) {
      patch.transcriptionStatus = options.transcriptionStatus;
      patch.transcriptionUpdatedAt = new Date();
    }
    if (options.transcriptionError !== undefined) patch.transcriptionError = options.transcriptionError;

    // 录音夺舍：本次未显式传视频字段时，把旧行的视频身份字段清空，避免串台
    if (isRecordingTakeover) {
      if (options.videoUrl === undefined) patch.videoUrl = undefined;
      if (options.videoEmbedUrl === undefined) patch.videoEmbedUrl = undefined;
      if (options.videoProvider === undefined) patch.videoProvider = undefined;
      if (options.thumbnailUrl === undefined) patch.thumbnailUrl = undefined;
      if (options.importSourceMode === undefined) patch.importSourceMode = undefined;
      if (options.importTrace === undefined) patch.importTrace = undefined;
    }

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
    transcriptionStatus: options.transcriptionStatus,
    transcriptionError: options.transcriptionError,
    transcriptionUpdatedAt: options.transcriptionStatus ? new Date() : undefined,
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
  if (!isValidSessionIdKey(sessionId)) return;
  await db.audioSessions
    .where('sessionId')
    .equals(sessionId)
    .modify({ status, updatedAt: new Date() });
}

/** 更新会话标题/主题；lock=true 表示用户手动改名（自动标题系统不再覆盖） */
export async function updateSessionTopic(
  sessionId: string,
  topic: string,
  opts?: { lock?: boolean }
): Promise<void> {
  await db.audioSessions
    .where('sessionId')
    .equals(sessionId)
    .modify({
      topic,
      ...(opts?.lock ? { topicLocked: true } : {}),
      updatedAt: new Date(),
    });
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
 * 历史数据修复：把"有 blob 但身份被视频占据"的行彻底修回录音身份。
 *
 * 背景（2026-04-20）：
 *   (1) 早期录音路径在 `useRecordingLifecycle` 里调用 `saveAudioSession` 时
 *       没有显式传 `sourceType`，于是 upsert 时保留了视频导入先写进去的
 *       `sourceType='video-link'`。
 *   (2) 即便 sourceType 被刀 1 改回了 'recording'，旧行里残留的
 *       videoUrl / videoEmbedUrl / thumbnailUrl / topic（= 视频标题）
 *       依然存在——列表渲染/封面/标题读的就是这些字段，
 *       用户点"强化学习"的卡片看到的还是"小猪佩奇"。
 *
 * 识别依据：`audioSessions.blob` 存在 → 说明用户真的录了音，这条 row
 * 就不该承载视频身份。修正规则：
 *   - 有 blob 的行，无论 sourceType 原来是什么，都强制 'recording'
 *   - 有 blob 且带视频字段（videoUrl / videoEmbedUrl / thumbnailUrl / videoProvider /
 *     importSourceMode / importTrace）→ 一律清空（视频原件的归视频，录音的归录音）
 *   - 有 blob 且 topic 是典型视频标题（非空、非默认占位）→ 也清空，让下游 adapter
 *     用"X 月 X 日的课"兜底。因为我们没法区分"用户自己写的课题"和"残留的视频标题"，
 *     但结合"sourceType 曾是 video-link 或带 videoUrl"这个前提，大概率是后者。
 *     宁可兜底，也不要让用户看到"小猪佩奇"卡片里放的是强化学习的声音。
 *
 * 幂等：修好之后 sourceType='recording' 且无视频字段，重跑无命中。
 *
 * 返回修正数量。仅在课堂列表挂载时调一次即可。
 */
export async function repairMisflaggedVideoLinkRecordings(): Promise<number> {
  const all = await db.audioSessions.toArray();

  // 识别需要修复的行：有 blob，且（sourceType 是 video-link，或残留了视频身份字段）
  const needsFix = all.filter((row) => {
    if (!row.blob) return false;
    if (row.sourceType === 'video-link') return true;
    if (row.videoUrl || row.videoEmbedUrl || row.thumbnailUrl || row.videoProvider) return true;
    return false;
  });
  if (needsFix.length === 0) return 0;

  await Promise.all(
    needsFix.map((row) =>
      row.id != null
        ? db.audioSessions.update(row.id, {
            sourceType: 'recording',
            // 彻底清除视频身份字段——此行已经被录音占用
            videoUrl: undefined,
            videoEmbedUrl: undefined,
            videoProvider: undefined,
            thumbnailUrl: undefined,
            importSourceMode: undefined,
            importTrace: undefined,
            // topic 若非空且非默认占位，大概率是残留的视频标题，一并清空
            // （adapter 的 deriveTitle 会兜底到"X 月 X 日的课"）
            ...(row.topic && !isPlaceholderTopic(row.topic) ? { topic: undefined } : {}),
            updatedAt: new Date(),
          })
        : Promise.resolve(),
    ),
  );

  return needsFix.length;
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
