/**
 * backfill-captures-to-indexeddb
 *
 * 档位1（跨设备带走数据）：登录新设备时，把服务端 capture 里的转录段
 * 回填到本地 IndexedDB（db.audioSessions + db.transcripts），
 * 让「课堂 tab」也能显示在另一台设备录的课 + 完整转录。
 *
 * 背景：课堂列表 useClassroomLessons 读 db.audioSessions；
 * 而登录拉回的 capture 只进了 sourceItems（材料 feed），没回填 IndexedDB。
 * 结果：换设备后课堂 tab 空、点开看不到转录。这里补上「下行回填」。
 *
 * 纯函数 pickBackfillable 可单测；orchestration 顺序写 IndexedDB（幂等）。
 */

import { db, addTranscripts } from '@/lib/db';
import { createLogger } from '@/lib/logger';
import type { WorkspaceCaptureMessage } from '@/types/page-types';

const logger = createLogger('backfill');

export interface BackfillSegment {
  id?: string;
  text: string;
  startMs: number;
  endMs: number;
  speakerId?: string;
  confidence: number;
  isFinal: boolean;
}

export interface BackfillAnchor {
  timestamp: number;
  type: 'confusion' | 'important' | 'question';
  status: 'active' | 'resolved';
  note?: string;
  aiExplanation?: string;
  createdAt?: string;
  resolvedAt?: string;
}

export interface BackfillClassSummary {
  summaryId: string;
  overview: string;
  takeaways: Array<{ label: string; insight: string; timestamps: string[] }>;
  keyDifficulties: string[];
  structure: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface BackfillHighlight {
  topicId: string;
  title: string;
  description?: string;
  importance: 'high' | 'medium' | 'low';
  duration: number;
  segments: Array<{
    start: number;
    end: number;
    text: string;
    startSegmentIdx?: number;
    endSegmentIdx?: number;
    confidence?: number;
  }>;
  keywords?: string[];
  quote?: { timestamp: string; text: string };
  createdAt?: string;
  updatedAt?: string;
}

export interface BackfillNote {
  noteId: string;
  source: 'chat' | 'takeaways' | 'transcript' | 'custom' | 'anchor';
  sourceId?: string;
  text: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface BackfillCandidate {
  sessionId: string;
  title: string;
  mediaUrl?: string;
  durationMs: number;
  occurredAt: string;
  segments: BackfillSegment[];
  anchors: BackfillAnchor[];
  summary?: BackfillClassSummary;
  highlights: BackfillHighlight[];
  notes: BackfillNote[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    : [];
}

function parseAnchors(value: unknown): BackfillAnchor[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const anchor = asRecord(item);
    if (!anchor || typeof anchor.timestamp !== 'number') return [];
    const type = anchor.type === 'important' || anchor.type === 'question' ? anchor.type : 'confusion';
    return [{
      timestamp: Math.max(0, anchor.timestamp),
      type,
      status: anchor.status === 'resolved' ? 'resolved' : 'active',
      note: optionalString(anchor.note),
      aiExplanation: optionalString(anchor.aiExplanation),
      createdAt: optionalString(anchor.createdAt),
      resolvedAt: optionalString(anchor.resolvedAt),
    }];
  });
}

function parseSummary(value: unknown): BackfillClassSummary | undefined {
  const summary = asRecord(value);
  const summaryId = optionalString(summary?.summaryId);
  const overview = optionalString(summary?.overview);
  if (!summary || !summaryId || !overview) return undefined;
  const takeaways = Array.isArray(summary.takeaways)
    ? summary.takeaways.flatMap((item) => {
        const takeaway = asRecord(item);
        const label = optionalString(takeaway?.label);
        const insight = optionalString(takeaway?.insight);
        return label && insight ? [{ label, insight, timestamps: stringArray(takeaway?.timestamps) }] : [];
      })
    : [];
  return {
    summaryId,
    overview,
    takeaways,
    keyDifficulties: stringArray(summary.keyDifficulties),
    structure: stringArray(summary.structure),
    createdAt: optionalString(summary.createdAt),
    updatedAt: optionalString(summary.updatedAt),
  };
}

function parseHighlights(value: unknown): BackfillHighlight[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const highlight = asRecord(item);
    const topicId = optionalString(highlight?.topicId);
    const title = optionalString(highlight?.title);
    if (!highlight || !topicId || !title) return [];
    const segments = Array.isArray(highlight.segments)
      ? highlight.segments.flatMap((rawSegment) => {
          const segment = asRecord(rawSegment);
          if (!segment || typeof segment.start !== 'number' || typeof segment.end !== 'number') return [];
          return [{
            start: segment.start,
            end: segment.end,
            text: optionalString(segment.text) || '',
            startSegmentIdx: typeof segment.startSegmentIdx === 'number' ? segment.startSegmentIdx : undefined,
            endSegmentIdx: typeof segment.endSegmentIdx === 'number' ? segment.endSegmentIdx : undefined,
            confidence: typeof segment.confidence === 'number' ? segment.confidence : undefined,
          }];
        })
      : [];
    const quote = asRecord(highlight.quote);
    const quoteTimestamp = optionalString(quote?.timestamp);
    const quoteText = optionalString(quote?.text);
    return [{
      topicId,
      title,
      description: optionalString(highlight.description),
      importance: highlight.importance === 'high' || highlight.importance === 'low' ? highlight.importance : 'medium',
      duration: typeof highlight.duration === 'number' ? highlight.duration : 0,
      segments,
      keywords: stringArray(highlight.keywords),
      quote: quoteTimestamp && quoteText ? { timestamp: quoteTimestamp, text: quoteText } : undefined,
      createdAt: optionalString(highlight.createdAt),
      updatedAt: optionalString(highlight.updatedAt),
    }];
  });
}

function parseNotes(value: unknown): BackfillNote[] {
  if (!Array.isArray(value)) return [];
  const allowedSources = new Set<BackfillNote['source']>(['chat', 'takeaways', 'transcript', 'custom', 'anchor']);
  return value.flatMap((item) => {
    const note = asRecord(item);
    const noteId = optionalString(note?.noteId);
    const text = optionalString(note?.text);
    const source = optionalString(note?.source) as BackfillNote['source'] | undefined;
    if (!note || !noteId || !text || !source || !allowedSources.has(source)) return [];
    return [{
      noteId,
      source,
      sourceId: optionalString(note.sourceId),
      text,
      metadata: asRecord(note.metadata) || undefined,
      createdAt: optionalString(note.createdAt),
      updatedAt: optionalString(note.updatedAt),
    }];
  });
}

/** 从一条 capture 提取可回填的课堂证据（结构化分段优先，旧版汇总转录兜底）。 */
export function extractBackfillCandidate(
  capture: WorkspaceCaptureMessage,
): BackfillCandidate | null {
  if ((capture.status || 'active') !== 'active') return null;
  const meta = capture.metadata && typeof capture.metadata === 'object'
    ? (capture.metadata as Record<string, unknown>)
    : null;
  if (!meta) return null;

  const sessionId = typeof meta.sessionId === 'string'
    ? meta.sessionId.trim()
    : typeof meta.localSessionId === 'string'
      ? meta.localSessionId.trim()
      : '';
  if (!sessionId) return null;

  const rawSegments = Array.isArray(meta.transcriptSegments) ? meta.transcriptSegments : null;
  const segments: BackfillSegment[] = [];
  for (const s of rawSegments || []) {
    if (!s || typeof s !== 'object') continue;
    const seg = s as Record<string, unknown>;
    const text = typeof seg.text === 'string' ? seg.text : '';
    if (!text.trim()) continue;
    segments.push({
      id: typeof seg.id === 'string' ? seg.id : undefined,
      text,
      startMs: typeof seg.startMs === 'number' ? seg.startMs : 0,
      endMs: typeof seg.endMs === 'number' ? seg.endMs : 0,
      speakerId: optionalString(seg.speakerId),
      confidence: typeof seg.confidence === 'number' ? seg.confidence : 0.95,
      isFinal: seg.isFinal !== false,
    });
  }

  const durationMs =
    typeof meta.duration === 'number' ? meta.duration
      : typeof meta.durationSec === 'number' ? meta.durationSec * 1000
        : segments[segments.length - 1]?.endMs || 0;

  // 兼容已经同步到服务端、但来自旧 migration-v1 的课堂：至少把汇总转录恢复成一段，
  // 用户换设备后仍能阅读和追问，不显示空课堂。
  if (segments.length === 0 && capture.normalizedText?.trim()) {
    segments.push({
      text: capture.normalizedText.trim(),
      startMs: 0,
      endMs: Math.max(durationMs, 1),
      confidence: 0.8,
      isFinal: true,
    });
  }
  if (segments.length === 0) return null;

  return {
    sessionId,
    title: capture.title || '课堂录音',
    mediaUrl: capture.mediaUrl || undefined,
    durationMs,
    occurredAt: capture.occurredAt || capture.createdAt,
    segments,
    anchors: parseAnchors(meta.anchors),
    summary: parseSummary(meta.classSummary),
    highlights: parseHighlights(meta.highlightTopics),
    notes: parseNotes(meta.notes),
  };
}

/** 从一批 capture 中挑出所有可回填项 */
export function pickBackfillable(captures: WorkspaceCaptureMessage[]): BackfillCandidate[] {
  const out: BackfillCandidate[] = [];
  for (const c of captures) {
    const cand = extractBackfillCandidate(c);
    if (cand) out.push(cand);
  }
  return out;
}

/** page-lifetime 幂等保护：按课堂记录，允许同一页面生命周期后来到达的新 capture 继续回填。 */
const processedSessionIds = new Set<string>();

export interface BackfillResult {
  scanned: number;
  backfilled: number;
  skipped: number;
}

/**
 * 把服务端 captures 的转录回填到 IndexedDB。
 *
 * 规则（幂等）：
 *   - 本地已有该 sessionId 的转录段 → 跳过（不覆盖本地，可能更新）
 *   - 本地没有 → 写 audioSession 占位（completed + transcriptionStatus=completed
 *     + mediaUrl，但**无 blob**——音频还在原设备，档位2 才解决）+ bulkPut transcripts
 */
export async function backfillCapturesToIndexedDB(
  captures: WorkspaceCaptureMessage[],
  userId: string,
  force = false,
): Promise<BackfillResult> {
  const result: BackfillResult = { scanned: 0, backfilled: 0, skipped: 0 };

  const candidates = pickBackfillable(captures);
  result.scanned = candidates.length;

  // 预取本地已有数据的 sessionId，逐类补缺，不覆盖这台设备上更近的编辑。
  let localTranscriptSessionIds: Set<string>;
  let localAnchorSessionIds: Set<string>;
  let localSummarySessionIds: Set<string>;
  let localHighlightSessionIds: Set<string>;
  let localNoteSessionIds: Set<string>;
  try {
    const [transcripts, anchors, summaries, highlights, notes] = await Promise.all([
      db.transcripts.toArray(),
      db.anchors.toArray(),
      db.classSummaries.toArray(),
      db.highlightTopics.toArray(),
      db.notes.toArray(),
    ]);
    localTranscriptSessionIds = new Set(transcripts.map((row) => row.sessionId));
    localAnchorSessionIds = new Set(anchors.map((row) => row.sessionId));
    localSummarySessionIds = new Set(summaries.map((row) => row.sessionId));
    localHighlightSessionIds = new Set(highlights.map((row) => row.sessionId));
    localNoteSessionIds = new Set(notes.map((row) => row.sessionId));
  } catch {
    localTranscriptSessionIds = new Set();
    localAnchorSessionIds = new Set();
    localSummarySessionIds = new Set();
    localHighlightSessionIds = new Set();
    localNoteSessionIds = new Set();
  }

  for (const cand of candidates) {
    if (!force && processedSessionIds.has(cand.sessionId)) {
      result.skipped += 1;
      continue;
    }
    try {
      let wroteAnything = false;
      const existing = await db.audioSessions.where('sessionId').equals(cand.sessionId).first();
      if (!existing) {
        // 写占位 session（无 blob：音频仍在原设备，档位2 上云后才跨设备可播）
        await db.audioSessions.add({
          sessionId: cand.sessionId,
          userId,
          mimeType: 'audio/webm',
          duration: cand.durationMs,
          topic: cand.title,
          sourceType: 'recording',
          mediaUrl: cand.mediaUrl,
          transcriptionStatus: 'completed',
          transcriptionUpdatedAt: new Date(),
          status: 'completed',
          createdAt: new Date(cand.occurredAt),
          updatedAt: new Date(),
        });
      }
      if (!localTranscriptSessionIds.has(cand.sessionId)) {
        // addTranscripts 内部会把 session.transcriptionStatus 设为 completed
        await addTranscripts(
          cand.sessionId,
          userId,
          cand.segments.map((segment) => ({
            text: segment.text,
            startMs: segment.startMs,
            endMs: segment.endMs,
            speakerId: segment.speakerId,
            confidence: segment.confidence,
            isFinal: segment.isFinal,
          })),
        );
        localTranscriptSessionIds.add(cand.sessionId);
        wroteAnything = true;
      }

      if (!localAnchorSessionIds.has(cand.sessionId) && cand.anchors.length > 0) {
        await db.anchors.bulkAdd(cand.anchors.map((anchor) => ({
          sessionId: cand.sessionId,
          timestamp: anchor.timestamp,
          type: anchor.type,
          status: anchor.status,
          note: anchor.note,
          aiExplanation: anchor.aiExplanation,
          createdAt: parsePortableDate(anchor.createdAt, cand.occurredAt),
          resolvedAt: anchor.resolvedAt ? parsePortableDate(anchor.resolvedAt, cand.occurredAt) : undefined,
        })));
        localAnchorSessionIds.add(cand.sessionId);
        wroteAnything = true;
      }

      if (!localSummarySessionIds.has(cand.sessionId) && cand.summary) {
        await db.classSummaries.add({
          summaryId: cand.summary.summaryId,
          sessionId: cand.sessionId,
          overview: cand.summary.overview,
          takeaways: cand.summary.takeaways,
          keyDifficulties: cand.summary.keyDifficulties,
          structure: cand.summary.structure,
          createdAt: parsePortableDate(cand.summary.createdAt, cand.occurredAt),
          updatedAt: parsePortableDate(cand.summary.updatedAt, cand.occurredAt),
        });
        localSummarySessionIds.add(cand.sessionId);
        wroteAnything = true;
      }

      if (!localHighlightSessionIds.has(cand.sessionId) && cand.highlights.length > 0) {
        await db.highlightTopics.bulkAdd(cand.highlights.map((highlight) => ({
          topicId: highlight.topicId,
          sessionId: cand.sessionId,
          title: highlight.title,
          description: highlight.description,
          importance: highlight.importance,
          duration: highlight.duration,
          segments: highlight.segments,
          keywords: highlight.keywords,
          quote: highlight.quote,
          createdAt: parsePortableDate(highlight.createdAt, cand.occurredAt),
          updatedAt: parsePortableDate(highlight.updatedAt, cand.occurredAt),
        })));
        localHighlightSessionIds.add(cand.sessionId);
        wroteAnything = true;
      }

      if (!localNoteSessionIds.has(cand.sessionId) && cand.notes.length > 0) {
        await db.notes.bulkAdd(cand.notes.map((note) => ({
          noteId: note.noteId,
          sessionId: cand.sessionId,
          studentId: userId,
          source: note.source,
          sourceId: note.sourceId,
          text: note.text,
          metadata: note.metadata,
          createdAt: parsePortableDate(note.createdAt, cand.occurredAt),
          updatedAt: parsePortableDate(note.updatedAt, cand.occurredAt),
        })));
        localNoteSessionIds.add(cand.sessionId);
        wroteAnything = true;
      }

      processedSessionIds.add(cand.sessionId);
      if (wroteAnything) result.backfilled += 1;
      else result.skipped += 1;
    } catch (err) {
      logger.warn('backfill single capture failed', { sessionId: cand.sessionId, error: String(err) });
      result.skipped += 1;
    }
  }

  return result;
}

/** 仅供测试：重置幂等标记 */
export function __resetBackfillGuard() {
  processedSessionIds.clear();
}

function parsePortableDate(value: string | undefined, fallback: string): Date {
  const parsed = new Date(value || fallback);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}
