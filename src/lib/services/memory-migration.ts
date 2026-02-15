import { ANONYMOUS_USER_ID, db, setPreference } from '@/lib/db';
import type { Anchor, ClassTimeline, StudentAnchor, TranscriptSegment } from '@/types';

const MIGRATION_DONE_KEY = 'memory_migration_v1_done';
const MIGRATION_BACKUP_KEY = 'memory_migration_v1_backup';
const LEGACY_ANCHOR_PREFIX = 'meetmind_anchors_';
const LEGACY_TIMELINE_PREFIX = 'meetmind_timeline_';
const LEGACY_CLASSROOM_ANCHORS_KEY = 'meetmind_classroom_anchors';
const LEGACY_CLASSROOM_SESSIONS_KEY = 'meetmind_classroom_sessions';

function safeJsonParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function isDone(): boolean {
  if (typeof window === 'undefined') return true;
  return window.localStorage.getItem(MIGRATION_DONE_KEY) === '1';
}

function markDone(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(MIGRATION_DONE_KEY, '1');
}

function normalizeAnchor(sessionId: string, item: Anchor | StudentAnchor): {
  sessionId: string;
  timestamp: number;
  type: 'confusion' | 'important' | 'question';
  status: 'active' | 'resolved';
  note?: string;
  aiExplanation?: string;
  createdAt: Date;
  resolvedAt?: Date;
} | null {
  if (!item || typeof item.timestamp !== 'number' || !Number.isFinite(item.timestamp)) return null;
  const type = item.type === 'important' || item.type === 'question' ? item.type : 'confusion';
  const createdAt = item.createdAt ? new Date(item.createdAt) : new Date();
  return {
    sessionId,
    timestamp: Math.max(0, Math.floor(item.timestamp)),
    type,
    status: item.resolved ? 'resolved' : 'active',
    note: typeof item.note === 'string' ? item.note : undefined,
    aiExplanation: typeof item.aiExplanation === 'string' ? item.aiExplanation : undefined,
    createdAt: Number.isNaN(createdAt.getTime()) ? new Date() : createdAt,
    resolvedAt: item.resolvedAt ? new Date(item.resolvedAt) : undefined,
  };
}

function normalizeSegment(sessionId: string, item: TranscriptSegment) {
  if (!item || typeof item.text !== 'string') return null;
  if (!Number.isFinite(item.startMs) || !Number.isFinite(item.endMs)) return null;
  return {
    sessionId,
    userId: ANONYMOUS_USER_ID,
    text: item.text,
    startMs: Math.max(0, Math.floor(item.startMs)),
    endMs: Math.max(Math.floor(item.startMs), Math.floor(item.endMs)),
    speakerId: item.speakerId,
    confidence: Number.isFinite(item.confidence) ? item.confidence : 1,
    isFinal: item.isFinal !== false,
  };
}

async function migrateLegacyAnchors(): Promise<number> {
  if (typeof window === 'undefined') return 0;
  const seen = new Set<string>();
  let inserted = 0;

  const upsertAnchors = async (sessionId: string, rawAnchors: Array<Anchor | StudentAnchor>) => {
    const existing = await db.anchors.where('sessionId').equals(sessionId).toArray();
    const existingSignatures = new Set(existing.map((row) => `${row.timestamp}:${row.type}:${row.createdAt.toISOString()}`));
    const rows = rawAnchors
      .map((anchor) => normalizeAnchor(sessionId, anchor))
      .filter((row): row is NonNullable<ReturnType<typeof normalizeAnchor>> => Boolean(row))
      .filter((row) => {
        const signature = `${row.timestamp}:${row.type}:${row.createdAt.toISOString()}`;
        if (existingSignatures.has(signature) || seen.has(signature)) return false;
        seen.add(signature);
        return true;
      });
    if (rows.length > 0) {
      await db.anchors.bulkAdd(rows);
      inserted += rows.length;
    }
  };

  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key || !key.startsWith(LEGACY_ANCHOR_PREFIX)) continue;
    const sessionId = key.slice(LEGACY_ANCHOR_PREFIX.length);
    if (!sessionId) continue;
    const anchors = safeJsonParse<Array<Anchor | StudentAnchor>>(window.localStorage.getItem(key));
    if (!Array.isArray(anchors) || anchors.length === 0) continue;
    await upsertAnchors(sessionId, anchors);
  }

  const classroomAnchors = safeJsonParse<StudentAnchor[]>(window.localStorage.getItem(LEGACY_CLASSROOM_ANCHORS_KEY));
  if (Array.isArray(classroomAnchors) && classroomAnchors.length > 0) {
    const grouped = new Map<string, StudentAnchor[]>();
    for (const anchor of classroomAnchors) {
      if (!anchor?.sessionId) continue;
      const bucket = grouped.get(anchor.sessionId) || [];
      bucket.push(anchor);
      grouped.set(anchor.sessionId, bucket);
    }
    for (const [sessionId, anchors] of grouped.entries()) {
      await upsertAnchors(sessionId, anchors);
    }
  }

  return inserted;
}

async function migrateLegacySessions(): Promise<number> {
  if (typeof window === 'undefined') return 0;
  const sessions = safeJsonParse<
    Array<{
      id: string;
      subject?: string;
      topic?: string;
      duration?: number;
      status?: 'recording' | 'completed' | 'archived';
      createdAt?: string;
      updatedAt?: string;
    }>
  >(window.localStorage.getItem(LEGACY_CLASSROOM_SESSIONS_KEY));
  if (!Array.isArray(sessions) || sessions.length === 0) return 0;

  let inserted = 0;
  for (const session of sessions) {
    if (!session?.id) continue;
    const exists = await db.audioSessions.where('sessionId').equals(session.id).count();
    if (exists > 0) continue;
    const createdAt = session.createdAt ? new Date(session.createdAt) : new Date();
    const updatedAt = session.updatedAt ? new Date(session.updatedAt) : createdAt;
    await db.audioSessions.add({
      sessionId: session.id,
      userId: ANONYMOUS_USER_ID,
      mimeType: 'audio/webm',
      duration: Number.isFinite(session.duration) ? Math.max(0, Number(session.duration)) : 0,
      subject: session.subject,
      topic: session.topic,
      sourceType: 'recording',
      status: session.status || 'completed',
      createdAt: Number.isNaN(createdAt.getTime()) ? new Date() : createdAt,
      updatedAt: Number.isNaN(updatedAt.getTime()) ? new Date() : updatedAt,
    });
    inserted += 1;
  }
  return inserted;
}

async function migrateLegacyTimelines(): Promise<{ segments: number; timelines: number }> {
  if (typeof window === 'undefined') return { segments: 0, timelines: 0 };
  let segmentInserted = 0;
  let timelineStored = 0;

  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key || !key.startsWith(LEGACY_TIMELINE_PREFIX)) continue;
    const sessionId = key.slice(LEGACY_TIMELINE_PREFIX.length);
    if (!sessionId) continue;
    const timeline = safeJsonParse<ClassTimeline>(window.localStorage.getItem(key));
    if (!timeline) continue;

    await setPreference(`timeline:${sessionId}`, timeline).catch(() => undefined);
    timelineStored += 1;

    const transcriptCount = await db.transcripts.where('sessionId').equals(sessionId).count();
    if (transcriptCount === 0 && Array.isArray(timeline.segments) && timeline.segments.length > 0) {
      const rows = timeline.segments
        .map((segment) => normalizeSegment(sessionId, segment))
        .filter((segment): segment is NonNullable<ReturnType<typeof normalizeSegment>> => Boolean(segment));
      if (rows.length > 0) {
        await db.transcripts.bulkAdd(rows);
        segmentInserted += rows.length;
      }
    }
  }

  return { segments: segmentInserted, timelines: timelineStored };
}

export interface MemoryMigrationResult {
  ok: boolean;
  migrated: boolean;
  summary?: {
    anchors: number;
    sessions: number;
    segments: number;
    timelines: number;
  };
  error?: string;
}

export async function runMemoryMigration(): Promise<MemoryMigrationResult> {
  if (typeof window === 'undefined') {
    return { ok: true, migrated: false };
  }
  if (isDone()) {
    return { ok: true, migrated: false };
  }

  try {
    const backup: Record<string, string | null> = {};
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key) continue;
      if (
        key.startsWith(LEGACY_ANCHOR_PREFIX) ||
        key.startsWith(LEGACY_TIMELINE_PREFIX) ||
        key === LEGACY_CLASSROOM_ANCHORS_KEY ||
        key === LEGACY_CLASSROOM_SESSIONS_KEY
      ) {
        backup[key] = window.localStorage.getItem(key);
      }
    }
    window.localStorage.setItem(MIGRATION_BACKUP_KEY, JSON.stringify(backup));

    const [anchors, sessions, timelineResult] = await Promise.all([
      migrateLegacyAnchors(),
      migrateLegacySessions(),
      migrateLegacyTimelines(),
    ]);

    markDone();
    return {
      ok: true,
      migrated: true,
      summary: {
        anchors,
        sessions,
        segments: timelineResult.segments,
        timelines: timelineResult.timelines,
      },
    };
  } catch (error) {
    return {
      ok: false,
      migrated: false,
      error: error instanceof Error ? error.message : 'memory migration failed',
    };
  }
}
