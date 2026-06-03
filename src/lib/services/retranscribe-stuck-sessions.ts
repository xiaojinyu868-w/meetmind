/**
 * retranscribe-stuck-sessions
 *
 * 自愈：把卡在「正在整理」却从没真正转写过的录音重新转写。
 *
 * 真实用户 case（2026-06-03）：手机录 1.5 小时会议，全程流式 ASR，
 * 但手机锁屏 / 切后台 / 网络抖动断了实时 WebSocket → 0 段转录。
 * 旧逻辑里录完不做兜底，blob 存了却从没送去转写，session 永远「正在整理」。
 *
 * Recorder 侧已修根因（流式 0 段 → 兜底批量转写），但**已经卡住的存量录音**
 * 需要这个 sweep 来救：进课堂时扫一遍，发现「completed + 有 blob + 0 转录段 +
 * 没成功/失败标记」的 session，就把 blob 重新送 /api/transcribe-fast 转出来。
 *
 * 不是 fallback 掩盖——是真的把音频转出来。失败也如实标 failed + 错误原因。
 */

import { db, addTranscripts } from '@/lib/db';
import type { AudioSession } from '@/lib/db/schema';

/** transcriptionStatus='pending' 但更新时间早于这个阈值 → 视为卡死，可重试 */
const STUCK_PENDING_AFTER_MS = 3 * 60 * 1000; // 3 分钟

/** blob 小于此值基本是静音/噪声，转也是空，跳过 */
const MIN_RETRANSCRIBE_BLOB_BYTES = 8 * 1024;

function getUpdatedAtMs(session: AudioSession): number {
  const raw = session.transcriptionUpdatedAt || session.updatedAt || session.createdAt;
  const d = raw instanceof Date ? raw : new Date(raw as unknown as string);
  const v = d.getTime();
  return Number.isFinite(v) ? v : 0;
}

/**
 * 纯函数：判断一条 session 是否「卡住需要重新转写」。
 *
 * 条件全部满足：
 *   - status === 'completed'（录完了，不是正在录）
 *   - 有可转写的 blob（且不是过小的静音）
 *   - 还没有任何转录段（hasTranscript=false）
 *   - transcriptionStatus 不是 'completed'/'failed'：
 *       · undefined → 从没启动过转写（典型卡死）
 *       · 'pending' 但更新时间超过 3 分钟 → 转写中途死了
 */
export function isStuckNeedingRetranscribe(
  session: AudioSession,
  hasTranscript: boolean,
  now: number = Date.now(),
): boolean {
  if (session.status !== 'completed') return false;
  if (hasTranscript) return false;
  if (!session.blob || session.blob.size < MIN_RETRANSCRIBE_BLOB_BYTES) return false;

  const ts = session.transcriptionStatus;
  if (ts === 'completed' || ts === 'failed') return false;
  if (ts === 'pending') {
    // pending 但很久没动 = 中途死了，可重试
    return now - getUpdatedAtMs(session) > STUCK_PENDING_AFTER_MS;
  }
  // undefined = 从没真正转写过
  return true;
}

interface TranscribeFastSegment {
  id?: string;
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number;
}

async function transcribeBlobViaFast(
  blob: Blob,
  language: string,
): Promise<{ ok: true; segments: TranscribeFastSegment[] } | { ok: false; error: string }> {
  try {
    const formData = new FormData();
    formData.append('audio', blob, 'recording.webm');
    formData.append('language', language);

    const resp = await fetch('/api/transcribe-fast', {
      method: 'POST',
      body: formData,
    });
    const data = (await resp.json().catch(() => ({}))) as {
      success?: boolean;
      segments?: TranscribeFastSegment[];
      error?: string;
      detail?: string;
    };

    if (!resp.ok || !data.success) {
      const detail = typeof data.detail === 'string' ? data.detail : '';
      return { ok: false, error: [data.error, detail].filter(Boolean).join('：') || `HTTP ${resp.status}` };
    }
    return { ok: true, segments: Array.isArray(data.segments) ? data.segments : [] };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** 本次 page load 是否已经跑过 sweep —— 幂等，避免重复扫。 */
let hasSweptInThisSession = false;

export interface RetranscribeSweepResult {
  scanned: number;
  attempted: number;
  recovered: number;
  failed: number;
}

/**
 * 扫描并重新转写所有卡住的 session。
 *
 * @param language ASR 语言模式（默认 'auto'）
 * @param force 跳过 page-lifetime 幂等保护（测试 / 用户手动重试用）
 */
export async function retranscribeStuckSessions(
  language: string = 'auto',
  force = false,
): Promise<RetranscribeSweepResult> {
  const result: RetranscribeSweepResult = { scanned: 0, attempted: 0, recovered: 0, failed: 0 };

  if (!force && hasSweptInThisSession) return result;
  hasSweptInThisSession = true;

  let sessions: AudioSession[];
  try {
    sessions = await db.audioSessions.where('status').equals('completed').toArray();
  } catch {
    return result;
  }
  result.scanned = sessions.length;

  // 预取有转录段的 sessionId 集合，避免 N 次查询
  let transcriptSessionIds: Set<string>;
  try {
    const rows = await db.transcripts.toArray();
    transcriptSessionIds = new Set(rows.map((r) => r.sessionId));
  } catch {
    transcriptSessionIds = new Set();
  }

  const now = Date.now();
  const candidates = sessions.filter((s) =>
    isStuckNeedingRetranscribe(s, transcriptSessionIds.has(s.sessionId), now),
  );

  // 顺序处理，避免一次性多个长音频转写打爆后端 / 移动端带宽
  for (const session of candidates) {
    if (!session.blob) continue;
    result.attempted += 1;

    // 标记 pending（让 UI 显示「正在整理」是名副其实的，且重置 stale 时钟）
    try {
      await db.audioSessions
        .where('sessionId')
        .equals(session.sessionId)
        .modify({ transcriptionStatus: 'pending', transcriptionUpdatedAt: new Date(), updatedAt: new Date() });
    } catch {
      // ignore — 不阻塞转写
    }

    const outcome = await transcribeBlobViaFast(session.blob, language);

    if (outcome.ok && outcome.segments.length > 0) {
      try {
        // addTranscripts 内部会把 session.transcriptionStatus 设为 'completed'
        await addTranscripts(
          session.sessionId,
          session.userId,
          outcome.segments.map((seg) => ({
            text: seg.text,
            startMs: seg.startMs,
            endMs: seg.endMs,
            confidence: seg.confidence ?? 0.95,
            isFinal: true,
          })),
        );
        result.recovered += 1;
      } catch {
        result.failed += 1;
      }
    } else {
      // 转写失败 / 转出空 —— 如实标 failed，不假装成功
      const errMsg = outcome.ok ? '这段原声没有转出可用文字' : outcome.error;
      try {
        await db.audioSessions
          .where('sessionId')
          .equals(session.sessionId)
          .modify({
            transcriptionStatus: 'failed',
            transcriptionError: errMsg.slice(0, 200),
            transcriptionUpdatedAt: new Date(),
            updatedAt: new Date(),
          });
      } catch {
        // ignore
      }
      result.failed += 1;
    }
  }

  return result;
}

/** 仅供测试：重置 page-lifetime 幂等标记 */
export function __resetRetranscribeSweepGuard() {
  hasSweptInThisSession = false;
}
