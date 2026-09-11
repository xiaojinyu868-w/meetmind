/**
 * local-workspace-migration — 登录后把本机 IndexedDB 里的课堂历史推到账号（/api/workspace/local-migration）。
 *
 * 2026-09-11 从 useAuth.tsx 抽出并改成"只推变过的"：
 *   - 此前每次页面加载把本机全部 audioSessions 全量重推（一个用户一天 8 轮、每轮 2-3 批全量转录，
 *     服务端每轮重新正规化证据）——这是事实上唯一的"重试"通道，代价极高。
 *   - 现在每节课算一个证据签名（转录 / 锚点 / 摘要 / 精选 / 笔记 / 对话的数量与最后更新时刻 +
 *     会话元数据），推送成功后记在 audioSessions.migrationSignature；下次只推签名变了的课。
 *     课后新增的笔记 / 锚点会让签名变化，所以它们仍能跟着上去——这是"只按 syncState 过滤"做不到的。
 *   - 正在录的课（status='recording'）不推：内容还在变，归录课检查点负责。
 *   - 服务端按 metadata.sessionId 复用已有行（live:{uid}:{sid} / local-session:{uid}:{sid} 同一节课只留一行）。
 *
 * 纯 service：不依赖 React；useAuth 只负责在登录态就绪时调一次 runLocalWorkspaceMigration。
 */

import { db, ANONYMOUS_USER_ID, markSessionsMigrated } from '@/lib/db';
import type { AudioSession } from '@/lib/db/schema';
import { createLogger } from '@/lib/logger';
import { runMemoryMigration } from '@/lib/services/memory-migration';

const log = createLogger('local-migration');
import type {
  LocalWorkspaceMigrationPayload,
  LocalWorkspaceSessionMigrationItem,
} from '@/lib/services/workspace-context-types';

const MIGRATION_ENDPOINT = '/api/workspace/local-migration';
/** 每批 session 数：体积一般稳在 2-4MB 内（服务端上限 8MB / 50 sessions） */
const BATCH_SIZE = 20;
/** 413（单批仍太大）时降级到的批大小 */
const FALLBACK_BATCH_SIZE = 5;

function normalizeText(value: string | null | undefined, limit?: number): string | undefined {
  const normalized = (value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  if (typeof limit === 'number' && normalized.length > limit) {
    return `${normalized.slice(0, Math.max(0, limit - 3))}...`;
  }
  return normalized;
}

function inferLocalCaptureContentType(session: {
  sourceType?: string;
  mimeType?: string;
  videoUrl?: string;
  videoEmbedUrl?: string;
  videoProvider?: string;
}): string {
  if (session.videoUrl || session.videoEmbedUrl || session.videoProvider) return 'video';
  if (session.sourceType === 'video-link' || session.sourceType === 'video-file') return 'video';
  if (session.mimeType?.startsWith('audio/')) return 'audio';
  if (session.sourceType === 'recording' || session.sourceType === 'upload') return 'audio';
  return 'text';
}

function buildLocalSessionTitle(session: {
  topic?: string;
  subject?: string;
  sourceType?: string;
}): string {
  return (
    normalizeText(session.topic, 80) ||
    normalizeText(session.subject, 80) ||
    (session.sourceType === 'video-link' || session.sourceType === 'video-file'
      ? '导入课堂视频'
      : session.sourceType === 'upload'
        ? '导入课堂音频'
        : '课堂录音')
  );
}

function toTime(value: Date | string | undefined | null): number {
  if (!value) return 0;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

/** FNV-1a 32 位：签名只要短且对输入敏感，不需要密码学强度 */
export function hashSignatureInput(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

export interface MigrationEvidenceCounts {
  transcripts: { count: number; lastEndMs: number; textLength: number };
  anchors: { count: number; lastUpdatedAt: number };
  summaryUpdatedAt: number;
  highlights: { count: number; lastUpdatedAt: number };
  notes: { count: number; lastUpdatedAt: number };
  conversations: { count: number; lastUpdatedAt: number };
}

/**
 * 一节课的证据签名：任何会进推送 payload 的内容变了，签名就变。
 * 不含 updatedAt / checkpointAt 这类每次心跳都会动的字段，否则等于没签名。
 */
export function buildMigrationSignature(
  userId: string,
  session: Pick<AudioSession, 'sessionId' | 'duration' | 'topic' | 'subject' | 'sourceType' | 'mimeType' | 'mediaUrl' | 'videoUrl' | 'videoEmbedUrl' | 'thumbnailUrl' | 'importSourceMode' | 'status'>,
  evidence: MigrationEvidenceCounts,
): string {
  const parts = [
    'v1',
    userId,
    session.sessionId,
    session.status,
    session.duration ?? 0,
    session.topic ?? '',
    session.subject ?? '',
    session.sourceType ?? '',
    session.mimeType ?? '',
    session.mediaUrl ?? '',
    session.videoUrl ?? '',
    session.videoEmbedUrl ?? '',
    session.thumbnailUrl ?? '',
    session.importSourceMode ?? '',
    evidence.transcripts.count,
    evidence.transcripts.lastEndMs,
    evidence.transcripts.textLength,
    evidence.anchors.count,
    evidence.anchors.lastUpdatedAt,
    evidence.summaryUpdatedAt,
    evidence.highlights.count,
    evidence.highlights.lastUpdatedAt,
    evidence.notes.count,
    evidence.notes.lastUpdatedAt,
    evidence.conversations.count,
    evidence.conversations.lastUpdatedAt,
  ];
  return hashSignatureInput(parts.join('|'));
}

/** 这节课这次要不要推：签名和上次成功推送时不同（从没推过 = undefined ≠ 任何签名） */
export function needsMigration(session: Pick<AudioSession, 'migrationSignature' | 'status'>, signature: string): boolean {
  if (session.status === 'recording') return false;
  return session.migrationSignature !== signature;
}

export interface LocalWorkspaceMigrationPlan {
  payload: LocalWorkspaceMigrationPayload;
  /** sessionId → 本次推送内容的签名（推成功后写回） */
  signatureBySession: Map<string, string>;
  /** 本机属于该用户 / 访客的课总数（含签名没变、跳过的） */
  candidateCount: number;
}

export async function buildLocalWorkspaceMigrationPlan(userId: string): Promise<LocalWorkspaceMigrationPlan | null> {
  await runMemoryMigration();

  const [allSessions, allTranscripts, allAnchors, allSummaries, allHighlights, allNotes, allConversations] = await Promise.all([
    db.audioSessions.toArray(),
    db.transcripts.toArray(),
    db.anchors.toArray(),
    db.classSummaries.toArray(),
    db.highlightTopics.toArray(),
    db.notes.toArray(),
    db.conversationHistory.toArray(),
  ]);

  const sessions = allSessions
    .filter((item) => !item.userId || item.userId === ANONYMOUS_USER_ID || item.userId === userId)
    .sort((a, b) => toTime(b.updatedAt) - toTime(a.updatedAt));

  if (sessions.length === 0) {
    return null;
  }

  const sessionIds = new Set(sessions.map((item) => item.sessionId));
  const transcriptBySession = new Map<string, typeof allTranscripts>();
  const anchorBySession = new Map<string, typeof allAnchors>();
  const summaryBySession = new Map<string, (typeof allSummaries)[number]>();
  const highlightBySession = new Map<string, typeof allHighlights>();
  const noteBySession = new Map<string, typeof allNotes>();
  const conversationBySession = new Map<string, typeof allConversations>();

  for (const transcript of allTranscripts) {
    if (!sessionIds.has(transcript.sessionId)) continue;
    const bucket = transcriptBySession.get(transcript.sessionId) || [];
    bucket.push(transcript);
    transcriptBySession.set(transcript.sessionId, bucket);
  }

  for (const anchor of allAnchors) {
    if (!sessionIds.has(anchor.sessionId)) continue;
    const bucket = anchorBySession.get(anchor.sessionId) || [];
    bucket.push(anchor);
    anchorBySession.set(anchor.sessionId, bucket);
  }

  for (const summary of allSummaries) {
    if (!sessionIds.has(summary.sessionId)) continue;
    summaryBySession.set(summary.sessionId, summary);
  }

  for (const highlight of allHighlights) {
    if (!sessionIds.has(highlight.sessionId)) continue;
    const bucket = highlightBySession.get(highlight.sessionId) || [];
    bucket.push(highlight);
    highlightBySession.set(highlight.sessionId, bucket);
  }

  for (const note of allNotes) {
    if (!sessionIds.has(note.sessionId)) continue;
    if (note.studentId && note.studentId !== ANONYMOUS_USER_ID && note.studentId !== userId) continue;
    const bucket = noteBySession.get(note.sessionId) || [];
    bucket.push(note);
    noteBySession.set(note.sessionId, bucket);
  }

  for (const conversation of allConversations) {
    if (!conversation.sessionId || !sessionIds.has(conversation.sessionId)) continue;
    if (conversation.userId && conversation.userId !== ANONYMOUS_USER_ID && conversation.userId !== userId) continue;
    const bucket = conversationBySession.get(conversation.sessionId) || [];
    bucket.push(conversation);
    conversationBySession.set(conversation.sessionId, bucket);
  }

  const signatureBySession = new Map<string, string>();
  const migratedSessions: LocalWorkspaceSessionMigrationItem[] = [];

  for (const session of sessions) {
    const transcripts = (transcriptBySession.get(session.sessionId) || []).sort((a, b) => a.startMs - b.startMs);
    const anchors = (anchorBySession.get(session.sessionId) || []).sort((a, b) => a.timestamp - b.timestamp);
    const summary = summaryBySession.get(session.sessionId);
    const highlights = (highlightBySession.get(session.sessionId) || []).sort(
      (a, b) => toTime(b.updatedAt) - toTime(a.updatedAt),
    );
    const notes = (noteBySession.get(session.sessionId) || []).sort((a, b) => toTime(b.updatedAt) - toTime(a.updatedAt));
    const conversations = (conversationBySession.get(session.sessionId) || []).sort(
      (a, b) => toTime(b.updatedAt) - toTime(a.updatedAt),
    );

    const signature = buildMigrationSignature(userId, session, {
      transcripts: {
        count: transcripts.length,
        lastEndMs: transcripts[transcripts.length - 1]?.endMs ?? 0,
        textLength: transcripts.reduce((sum, item) => sum + (item.text?.length ?? 0), 0),
      },
      anchors: {
        count: anchors.length,
        lastUpdatedAt: anchors.reduce((max, item) => Math.max(max, toTime(item.resolvedAt), toTime(item.createdAt)), 0),
      },
      summaryUpdatedAt: toTime(summary?.updatedAt),
      highlights: { count: highlights.length, lastUpdatedAt: toTime(highlights[0]?.updatedAt) },
      notes: { count: notes.length, lastUpdatedAt: toTime(notes[0]?.updatedAt) },
      conversations: { count: conversations.length, lastUpdatedAt: toTime(conversations[0]?.updatedAt) },
    });
    if (!needsMigration(session, signature)) continue;

    const transcriptText = normalizeText(
      transcripts
        .map((item) => item.text)
        .filter(Boolean)
        .join(' '),
      8000,
    );
    const highlightText = normalizeText(
      highlights
        .map((item) => [item.title, item.description, item.quote?.text].filter(Boolean).join('：'))
        .filter(Boolean)
        .join('；'),
      2000,
    );
    const noteText = normalizeText(notes.map((item) => item.text).filter(Boolean).join('；'), 2000);
    const anchorText = normalizeText(
      anchors
        .map((item) => item.note || item.aiExplanation)
        .filter(Boolean)
        .join('；'),
      1200,
    );
    const conversationText = normalizeText(
      conversations
        .map((item) => item.lastMessage || item.title)
        .filter(Boolean)
        .join('；'),
      1000,
    );

    const summaryTakeaways = summary?.takeaways
      ?.map((item) => `${item.label}：${item.insight}`)
      .filter(Boolean)
      .join('；');
    const summaryStructure = summary?.structure?.filter(Boolean).join('、');
    const summaryDifficulty = summary?.keyDifficulties?.filter(Boolean).join('；');

    const tutorContext = normalizeText(
      [
        summary?.overview ? `课堂概览：${summary.overview}` : '',
        summaryTakeaways ? `关键收获：${summaryTakeaways}` : '',
        summaryDifficulty ? `主要难点：${summaryDifficulty}` : '',
        summaryStructure ? `课堂结构：${summaryStructure}` : '',
        highlightText ? `精选片段：${highlightText}` : '',
        anchorText ? `困惑锚点：${anchorText}` : '',
        noteText ? `我的笔记：${noteText}` : '',
        conversationText ? `同学对话：${conversationText}` : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
      12000,
    );

    const previewText =
      normalizeText(summary?.overview, 220) ||
      noteText ||
      highlightText ||
      transcriptText ||
      anchorText;

    const title = buildLocalSessionTitle(session);

    if (!previewText && !tutorContext && !transcriptText && !session.mediaUrl && !session.videoUrl) {
      // 什么都没有的空壳：不推，也不标——以后有内容了签名自然不同
      continue;
    }

    signatureBySession.set(session.sessionId, signature);
    migratedSessions.push({
      sessionId: session.sessionId,
      title,
      contentType: inferLocalCaptureContentType(session),
      role: 'primary',
      previewText,
      normalizedText: transcriptText,
      tutorContext,
      sourceUrl: session.videoUrl || undefined,
      mediaUrl: session.mediaUrl || session.videoEmbedUrl || undefined,
      occurredAt: session.createdAt.toISOString(),
      metadata: {
        sessionId: session.sessionId,
        sourceType: session.sourceType || 'recording',
        mimeType: session.mimeType,
        duration: session.duration,
        topic: session.topic,
        subject: session.subject,
        transcriptCount: transcripts.length,
        anchorCount: anchors.length,
        highlightCount: highlights.length,
        noteCount: notes.length,
        conversationCount: conversations.length,
        importSourceMode: session.importSourceMode,
        thumbnailUrl: session.thumbnailUrl,
        // 跨设备可恢复包：保留课堂证据的结构，不再只上传 8000 字拼接文本。
        // 上送按 session 分批（20/批，413 自动降级到 5/批，服务端上限 8MB/50 sessions），
        // 单 session 内不再硬截断证据：transcriptSegments 上限 10000（与服务端证据表
        // 防呆上限一致，句级密度约 12 段/分钟 ≈ 13 小时课，实际不会触顶）。
        transcriptSegments: transcripts.slice(0, 10000).map((item) => ({
          text: item.text,
          startMs: item.startMs,
          endMs: item.endMs,
          speakerId: item.speakerId,
          confidence: item.confidence,
          isFinal: item.isFinal,
        })),
        anchors: anchors.slice(0, 1000).map((item) => ({
          timestamp: item.timestamp,
          type: item.type,
          status: item.status,
          note: item.note,
          aiExplanation: item.aiExplanation,
          createdAt: item.createdAt.toISOString(),
          resolvedAt: item.resolvedAt?.toISOString(),
        })),
        classSummary: summary ? {
          summaryId: summary.summaryId,
          overview: summary.overview,
          takeaways: summary.takeaways,
          keyDifficulties: summary.keyDifficulties,
          structure: summary.structure,
          createdAt: summary.createdAt.toISOString(),
          updatedAt: summary.updatedAt.toISOString(),
        } : undefined,
        highlightTopics: highlights.slice(0, 500).map((item) => ({
          topicId: item.topicId,
          title: item.title,
          description: item.description,
          importance: item.importance,
          duration: item.duration,
          segments: item.segments,
          keywords: item.keywords,
          quote: item.quote,
          createdAt: item.createdAt.toISOString(),
          updatedAt: item.updatedAt.toISOString(),
        })),
        notes: notes.slice(0, 200).map((item) => ({
          noteId: item.noteId,
          source: item.source,
          sourceId: item.sourceId,
          text: item.text,
          metadata: item.metadata,
          createdAt: item.createdAt.toISOString(),
          updatedAt: item.updatedAt.toISOString(),
        })),
      },
    });
  }

  if (migratedSessions.length === 0) {
    return { payload: { sessions: [] }, signatureBySession, candidateCount: sessions.length };
  }

  return {
    payload: { sessions: migratedSessions },
    signatureBySession,
    candidateCount: sessions.length,
  };
}

export interface RunLocalWorkspaceMigrationOptions {
  userId: string;
  accessToken: string;
  /** 调用方（effect cleanup）可随时取消：已发出的批不回滚，未发的不再发 */
  isCancelled?: () => boolean;
  fetchImpl?: typeof fetch;
}

export interface LocalWorkspaceMigrationResult {
  /** 本机属于该用户的课总数 */
  candidates: number;
  /** 这次真正推送的课 */
  pushed: number;
  /** 签名没变 / 空壳而跳过的课 */
  skipped: number;
  /** 推送失败（网络 / 5xx）的课，下次登录重试 */
  failed: number;
  cancelled: boolean;
}

async function postBatch(
  fetchImpl: typeof fetch,
  accessToken: string,
  batch: LocalWorkspaceSessionMigrationItem[],
): Promise<{ ok: boolean; status: number }> {
  try {
    const response = await fetchImpl(MIGRATION_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ sessions: batch }),
    });
    return { ok: response.ok, status: response.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

/**
 * 分批推送签名变过的课；每批成功立刻写回签名，单批失败不阻断后续。
 * 413（payload 过大）时该批降级为 5 节一批再试。
 */
export async function runLocalWorkspaceMigration(options: RunLocalWorkspaceMigrationOptions): Promise<LocalWorkspaceMigrationResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const isCancelled = options.isCancelled ?? (() => false);
  const plan = await buildLocalWorkspaceMigrationPlan(options.userId);
  const result: LocalWorkspaceMigrationResult = { candidates: 0, pushed: 0, skipped: 0, failed: 0, cancelled: false };
  if (!plan) return result;
  result.candidates = plan.candidateCount;
  result.skipped = plan.candidateCount - plan.payload.sessions.length;
  const sessions = plan.payload.sessions;
  if (sessions.length === 0) return result;

  const markBatch = async (batch: LocalWorkspaceSessionMigrationItem[]) => {
    await markSessionsMigrated(
      batch
        .map((item) => ({ sessionId: item.sessionId, signature: plan.signatureBySession.get(item.sessionId) || '' }))
        .filter((entry) => entry.signature),
    ).catch(() => undefined);
    result.pushed += batch.length;
  };

  for (let index = 0; index < sessions.length; index += BATCH_SIZE) {
    if (isCancelled()) {
      result.cancelled = true;
      break;
    }
    const batch = sessions.slice(index, index + BATCH_SIZE);
    const outcome = await postBatch(fetchImpl, options.accessToken, batch);
    if (outcome.ok) {
      await markBatch(batch);
      continue;
    }
    if (outcome.status === 413 && batch.length > FALLBACK_BATCH_SIZE) {
      // 单批仍然太大：拆小再试，成功的小批各自标记
      for (let inner = 0; inner < batch.length; inner += FALLBACK_BATCH_SIZE) {
        if (isCancelled()) {
          result.cancelled = true;
          break;
        }
        const smaller = batch.slice(inner, inner + FALLBACK_BATCH_SIZE);
        const smallOutcome = await postBatch(fetchImpl, options.accessToken, smaller);
        if (smallOutcome.ok) await markBatch(smaller);
        else result.failed += smaller.length;
      }
      continue;
    }
    // 其他错误：这批下次登录再来，继续下一批
    result.failed += batch.length;
  }

  if (result.pushed > 0 || result.failed > 0) {
    log.info('[local-migration] pushed changed lessons only', result);
  }
  return result;
}
