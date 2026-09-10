'use client';

/**
 * useUnfinishedRecordings — 「有一节课没结束」的数据与动作（2026-09-10 录课不丢）。
 *
 * 数据源：IndexedDB.audioSessions 里 status 仍是 'recording'、且不是当前 Recorder 正在录的那一节
 * （页面被关 / 崩溃 / 被系统回收留下的）。之前 useClassroomLessons 挂载时把它们一刀改成 completed
 * ——从此没人知道这节课"没结束"，也没法接着录或收好，45 分钟后卡片变成「没有留下可用内容」。
 *
 * 动作：
 *   - finish（就到这里）：finalizeUnfinishedRecording → 拼原声 + 落转录 + 写服务端 + 课后理解
 *   - resume（继续录）：先按 finish 收好前半段，再交给调用方开一段新的录音
 *   - 自动：超过 6 小时没回来的、或占位里什么都没有的，挂载时静默处理，不打扰
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { toast } from 'sonner';
import { db, countRecordingChunks } from '@/lib/db';
import type { AudioSession } from '@/lib/db/schema';
import {
  finalizeUnfinishedRecording,
  resolveUnfinishedDurationMs,
} from '@/lib/services/recording-recovery-service';
import { isRecordingCheckpointStale } from '@/lib/capture/live-recording-capture';
import { isPlaceholderLessonTitle } from '@/lib/learning/lesson-title-generic';
import { COPY } from '@/lib/ui/copy';

export interface UnfinishedLesson {
  sessionId: string;
  title: string;
  /** 已录时长（分钟，四舍五入，至少 0） */
  minutes: number;
  createdAt: Date;
}

export interface UseUnfinishedRecordingsDeps {
  userId?: string | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  /** 当前 Recorder 正在录的 sessionId（isRecording 为真时）——它不是"没结束"，是"正在录" */
  activeRecordingSessionId: string | null;
  /** 「继续录」收好前半段后由调用方开新录音 */
  onStartRecording?: () => void;
}

/** 已由本 hook 处理过（自动或手动）的 sessionId，避免 useLiveQuery 重放时重复收尾 */
const handledSessionIds = new Set<string>();
/** Recorder 正常收尾（停 ASR / flush blob / 落库）通常 1-3s；超过这个窗口还没翻成 completed 才算"没结束" */
const GRACE_AFTER_LAST_ACTIVITY_MS = 8_000;
const GRACE_HEARTBEAT_MS = 3_000;

function toDate(value: Date | string | undefined): Date {
  const date = value instanceof Date ? value : value ? new Date(value) : new Date(0);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

/** 这节课上次有动静的时刻：检查点优先，其次 updatedAt / createdAt */
export function unfinishedLastActivityAt(session: AudioSession): Date {
  return toDate(session.checkpointAt || session.updatedAt || session.createdAt);
}

export function useUnfinishedRecordings(deps: UseUnfinishedRecordingsDeps) {
  const { userId, accessToken, isAuthenticated, activeRecordingSessionId, onStartRecording } = deps;
  const [busySessionId, setBusySessionId] = useState<string | null>(null);
  const authRef = useRef({ userId, accessToken, isAuthenticated });
  authRef.current = { userId, accessToken, isAuthenticated };
  const onStartRecordingRef = useRef(onStartRecording);
  onStartRecordingRef.current = onStartRecording;

  // 不传 deps（与 useClassroomLessons 同一写法）：传 [] 时 React 18 开发态 StrictMode 双挂载下，
  // 挂载前已存在的行只有一次初始 emission，落在被丢弃的第一次订阅里，组件永远拿到 []（实测复现）。
  const rows = useLiveQuery(
    () => db.audioSessions.where('status').equals('recording').toArray(),
  ) ?? [];

  // 刚停下的课在 Recorder 收尾期间（isRecording 已 false、blob 还没落库）也会短暂满足条件；
  // 给 8 秒宽限（录课中检查点每 5 秒更新一次 checkpointAt）。宽限是按 Date.now() 判的，
  // 所以只要还有 status='recording' 的行就用一个 3s 心跳重算，而不是靠"某次渲染恰好过了线"。
  const [tick, setTick] = useState(0);
  const hasRecordingRows = rows.length > 0;
  useEffect(() => {
    if (!hasRecordingRows) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), GRACE_HEARTBEAT_MS);
    return () => window.clearInterval(timer);
  }, [hasRecordingRows]);
  const candidates = useMemo(
    () => rows.filter((row) =>
      row.sessionId
      && row.sessionId !== activeRecordingSessionId
      && row.remoteRecordingState !== 'recording'
      && !handledSessionIds.has(row.sessionId)
      && Date.now() - unfinishedLastActivityAt(row).getTime() > GRACE_AFTER_LAST_ACTIVITY_MS),
    // tick 只是为了让宽限期过后重新过一遍 filter
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, activeRecordingSessionId, tick],
  );

  const runFinalize = useCallback(async (sessionId: string, options: { silent?: boolean } = {}) => {
    if (handledSessionIds.has(sessionId)) return null;
    handledSessionIds.add(sessionId);
    setBusySessionId(sessionId);
    try {
      const auth = authRef.current;
      const result = await finalizeUnfinishedRecording({
        sessionId,
        userId: auth.userId,
        accessToken: auth.isAuthenticated ? auth.accessToken : null,
      });
      if (!options.silent && !result.discarded) {
        toast.success(COPY.recording.unfinished.finished);
      }
      return result;
    } catch (error) {
      handledSessionIds.delete(sessionId);
      console.warn('[unfinished-recording] finalize failed:', error);
      return null;
    } finally {
      setBusySessionId((current) => (current === sessionId ? null : current));
    }
  }, []);

  // 自动收尾：超过 6 小时没回来的，或占位里什么都没有（0 秒、无分片、无文字）的
  useEffect(() => {
    if (candidates.length === 0) return;
    let cancelled = false;
    void (async () => {
      let autoFinished = 0;
      for (const session of candidates) {
        if (cancelled) return;
        const stale = isRecordingCheckpointStale(unfinishedLastActivityAt(session));
        let empty = false;
        if (!stale) {
          const [chunks, transcripts] = await Promise.all([
            countRecordingChunks(session.sessionId).catch(() => 0),
            db.transcripts.where('sessionId').equals(session.sessionId).count().catch(() => 0),
          ]);
          empty = chunks === 0 && transcripts === 0 && resolveUnfinishedDurationMs(session) === 0
            // 刚开始录还没来得及落任何东西的占位：给它 30 秒，不要把正在启动的课误判成空壳
            && Date.now() - toDate(session.createdAt).getTime() > 30_000;
        }
        if (!stale && !empty) continue;
        const result = await runFinalize(session.sessionId, { silent: true });
        if (result && !result.discarded) autoFinished += 1;
      }
      if (!cancelled && autoFinished > 0) toast(COPY.recording.unfinished.autoFinished, { duration: 5000 });
    })();
    return () => { cancelled = true; };
  }, [candidates, runFinalize]);

  const unfinished: UnfinishedLesson[] = useMemo(
    () => candidates
      .filter((session) => !isRecordingCheckpointStale(unfinishedLastActivityAt(session)))
      .map((session) => ({
        sessionId: session.sessionId,
        title: session.topic && !isPlaceholderLessonTitle(session.topic)
          ? session.topic
          : `${toDate(session.createdAt).getHours().toString().padStart(2, '0')}:${toDate(session.createdAt).getMinutes().toString().padStart(2, '0')} 的课`,
        minutes: Math.max(0, Math.round(resolveUnfinishedDurationMs(session) / 60000)),
        createdAt: toDate(session.createdAt),
      }))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    [candidates],
  );

  const finish = useCallback(async (sessionId: string) => {
    await runFinalize(sessionId);
  }, [runFinalize]);

  const resume = useCallback(async (sessionId: string) => {
    await runFinalize(sessionId, { silent: true });
    onStartRecordingRef.current?.();
  }, [runFinalize]);

  return { unfinished, finish, resume, busySessionId };
}
