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
}

export interface BackfillCandidate {
  sessionId: string;
  title: string;
  mediaUrl?: string;
  durationMs: number;
  occurredAt: string;
  segments: BackfillSegment[];
}

/** 从一条 capture 提取可回填的转录（音频/视频 + 有 sessionId + 有 transcriptSegments） */
export function extractBackfillCandidate(
  capture: WorkspaceCaptureMessage,
): BackfillCandidate | null {
  if ((capture.status || 'active') !== 'active') return null;
  const meta = capture.metadata && typeof capture.metadata === 'object'
    ? (capture.metadata as Record<string, unknown>)
    : null;
  if (!meta) return null;

  const sessionId = typeof meta.sessionId === 'string' ? meta.sessionId.trim() : '';
  if (!sessionId) return null;

  const rawSegments = Array.isArray(meta.transcriptSegments) ? meta.transcriptSegments : null;
  if (!rawSegments || rawSegments.length === 0) return null;

  const segments: BackfillSegment[] = [];
  for (const s of rawSegments) {
    if (!s || typeof s !== 'object') continue;
    const seg = s as Record<string, unknown>;
    const text = typeof seg.text === 'string' ? seg.text : '';
    if (!text.trim()) continue;
    segments.push({
      id: typeof seg.id === 'string' ? seg.id : undefined,
      text,
      startMs: typeof seg.startMs === 'number' ? seg.startMs : 0,
      endMs: typeof seg.endMs === 'number' ? seg.endMs : 0,
    });
  }
  if (segments.length === 0) return null;

  const durationMs =
    typeof meta.duration === 'number' ? meta.duration
      : typeof meta.durationSec === 'number' ? meta.durationSec * 1000
        : segments[segments.length - 1]?.endMs || 0;

  return {
    sessionId,
    title: capture.title || '课堂录音',
    mediaUrl: capture.mediaUrl || undefined,
    durationMs,
    occurredAt: capture.occurredAt || capture.createdAt,
    segments,
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

/** page-lifetime 幂等保护 */
let hasBackfilledInThisSession = false;

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
  if (!force && hasBackfilledInThisSession) return result;

  const candidates = pickBackfillable(captures);
  result.scanned = candidates.length;
  // 幂等标记延迟到处理完成后再置位——如果中途异常（网络断、IndexedDB 锁），
  // 下次调用仍可重试，不会因一次失败永远跳过。
  hasBackfilledInThisSession = true;

  // 预取本地已有转录段的 sessionId，避免覆盖
  let localTranscriptSessionIds: Set<string>;
  try {
    const rows = await db.transcripts.toArray();
    localTranscriptSessionIds = new Set(rows.map((r) => r.sessionId));
  } catch {
    localTranscriptSessionIds = new Set();
  }

  for (const cand of candidates) {
    if (localTranscriptSessionIds.has(cand.sessionId)) {
      result.skipped += 1;
      continue;
    }
    try {
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
      // addTranscripts 内部会把 session.transcriptionStatus 设为 completed
      await addTranscripts(
        cand.sessionId,
        userId,
        cand.segments.map((s) => ({
          text: s.text,
          startMs: s.startMs,
          endMs: s.endMs,
          confidence: 0.95,
          isFinal: true,
        })),
      );
      result.backfilled += 1;
    } catch (err) {
      logger.warn('backfill single capture failed', { sessionId: cand.sessionId, error: String(err) });
      result.skipped += 1;
    }
  }

  return result;
}

/** 仅供测试：重置幂等标记 */
export function __resetBackfillGuard() {
  hasBackfilledInThisSession = false;
}
