import { db } from '@/lib/db';
import type { Anchor, AnchorType } from '@/types';

export type { Anchor, AnchorType } from '@/types';

const LEGACY_STORAGE_KEY = 'meetmind_anchors';
const sessionAnchorCache = new Map<string, Anchor[]>();

function cloneAnchors(anchors: Anchor[]): Anchor[] {
  return anchors.map((anchor) => ({ ...anchor }));
}

function loadLegacyAnchors(sessionId: string): Anchor[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(`${LEGACY_STORAGE_KEY}_${sessionId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Anchor[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toDbStatus(anchor: Anchor): 'active' | 'resolved' {
  return anchor.resolved ? 'resolved' : 'active';
}

async function flushSessionToDb(sessionId: string): Promise<void> {
  const anchors = sessionAnchorCache.get(sessionId) || [];
  await db.transaction('rw', db.anchors, async () => {
    await db.anchors.where('sessionId').equals(sessionId).delete();
    if (anchors.length === 0) return;
    await db.anchors.bulkAdd(
      anchors
        .filter((anchor) => !anchor.cancelled)
        .map((anchor) => ({
          sessionId,
          timestamp: anchor.timestamp,
          type: anchor.type,
          status: toDbStatus(anchor),
          note: anchor.note,
          aiExplanation: anchor.aiExplanation,
          createdAt: new Date(anchor.createdAt),
          resolvedAt: anchor.resolvedAt ? new Date(anchor.resolvedAt) : undefined,
        }))
    );
  });
}

function warmSessionFromDb(sessionId: string): void {
  if (typeof window === 'undefined') return;
  void db.anchors
    .where('sessionId')
    .equals(sessionId)
    .sortBy('timestamp')
    .then((rows) => {
      const current = sessionAnchorCache.get(sessionId) || [];
      if (current.length > 0) return;
      const mapped: Anchor[] = rows.map((row, index) => ({
        id: `db-anchor-${row.id ?? index + 1}`,
        sessionId,
        studentId: 'local-student',
        timestamp: row.timestamp,
        type: row.type,
        cancelled: false,
        resolved: row.status === 'resolved',
        createdAt: row.createdAt.toISOString(),
        resolvedAt: row.resolvedAt?.toISOString(),
        note: row.note,
        aiExplanation: row.aiExplanation,
      }));
      sessionAnchorCache.set(sessionId, mapped);
    })
    .catch(() => undefined);
}

function ensureSessionCache(sessionId: string): Anchor[] {
  const cached = sessionAnchorCache.get(sessionId);
  if (cached) return cached;
  const legacy = loadLegacyAnchors(sessionId);
  sessionAnchorCache.set(sessionId, legacy);
  warmSessionFromDb(sessionId);
  return legacy;
}

function saveSessionCache(sessionId: string, anchors: Anchor[]): void {
  sessionAnchorCache.set(sessionId, cloneAnchors(anchors));
  void flushSessionToDb(sessionId).catch(() => undefined);
}

export const anchorService = {
  mark(
    sessionId: string,
    studentId: string,
    timestamp: number,
    type: AnchorType = 'confusion'
  ): Anchor {
    const anchor: Anchor = {
      id: `anchor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sessionId,
      studentId,
      timestamp,
      type,
      cancelled: false,
      resolved: false,
      createdAt: new Date().toISOString(),
    };

    const anchors = ensureSessionCache(sessionId);
    anchors.push(anchor);
    saveSessionCache(sessionId, anchors);
    return anchor;
  },

  cancel(anchorId: string, sessionId: string): boolean {
    const anchors = ensureSessionCache(sessionId);
    const anchor = anchors.find((item) => item.id === anchorId);
    if (!anchor) return false;
    const elapsed = Date.now() - new Date(anchor.createdAt).getTime();
    if (elapsed > 5000) return false;
    anchor.cancelled = true;
    saveSessionCache(sessionId, anchors);
    return true;
  },

  resolve(anchorId: string, sessionId: string): void {
    const anchors = ensureSessionCache(sessionId);
    const anchor = anchors.find((item) => item.id === anchorId);
    if (!anchor) return;
    anchor.resolved = true;
    anchor.resolvedAt = new Date().toISOString();
    saveSessionCache(sessionId, anchors);
  },

  getAll(sessionId: string): Anchor[] {
    return cloneAnchors(ensureSessionCache(sessionId));
  },

  getActive(sessionId: string): Anchor[] {
    return this.getAll(sessionId).filter((anchor) => !anchor.cancelled);
  },

  getUnresolved(sessionId: string): Anchor[] {
    return this.getActive(sessionId).filter((anchor) => !anchor.resolved);
  },

  saveAll(sessionId: string, anchors: Anchor[]): void {
    saveSessionCache(sessionId, anchors);
  },

  clear(sessionId: string): void {
    sessionAnchorCache.set(sessionId, []);
    void db.anchors.where('sessionId').equals(sessionId).delete().catch(() => undefined);
  },

  addNote(anchorId: string, sessionId: string, note: string): void {
    const anchors = ensureSessionCache(sessionId);
    const anchor = anchors.find((item) => item.id === anchorId);
    if (!anchor) return;
    anchor.note = note;
    saveSessionCache(sessionId, anchors);
  },
};
