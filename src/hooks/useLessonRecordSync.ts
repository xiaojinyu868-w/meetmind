'use client';

/**
 * useLessonRecordSync —— 让一节正在上的 live 课随时是"我的一节课"。
 *
 * 老师每讲完一轮（宿主传 `settledNonce` 变化），拉一次 GET /api/teach/threads/[id]/record，存进 IndexedDB
 * （`saveLessonRecordAsSession`，幂等整段替换）。存好后课堂列表里就有它，复习页按 `teach:<threadId>` 直达。
 * 与来源无关：知乎收藏夹课、/teach/live 自己开的课都能用。失败静默重试下一轮，不打扰上课。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { saveLessonRecordAsSession, teachSessionId } from '@/lib/db/lesson-records';
import type { LessonRecord } from '@/lib/services/teach-live/lesson-record';

export interface LessonRecordSyncState {
  sessionId: string;
  /** 最近一次成功同步的 record（复习页 / 材料栏可直接用） */
  record: LessonRecord | null;
  syncing: boolean;
  syncedAt: number | null;
  error: string | null;
  /** 手动触发一次（如点「去复习」前确保最新） */
  syncNow: () => Promise<LessonRecord | null>;
}

export async function fetchLessonRecord(token: string, threadId: string): Promise<LessonRecord> {
  const response = await fetch(`/api/teach/threads/${encodeURIComponent(threadId)}/record`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await response.json().catch(() => ({}))) as { success?: boolean; record?: LessonRecord; message?: string };
  if (!response.ok || !data.success || !data.record) throw new Error(data.message || `record ${response.status}`);
  return data.record;
}

export function useLessonRecordSync(threadId: string | null, settledNonce: number): LessonRecordSyncState {
  const { accessToken, user } = useAuth();
  const [record, setRecord] = useState<LessonRecord | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef<Promise<LessonRecord | null> | null>(null);

  const syncNow = useCallback(async (): Promise<LessonRecord | null> => {
    if (!threadId || !accessToken || !user?.id) return null;
    if (inflight.current) return inflight.current;
    const run = (async () => {
      setSyncing(true);
      setError(null);
      try {
        const fresh = await fetchLessonRecord(accessToken, threadId);
        if (fresh.segments.length) await saveLessonRecordAsSession(fresh, user.id);
        setRecord(fresh);
        setSyncedAt(Date.now());
        return fresh;
      } catch (e) {
        setError((e as Error).message);
        return null;
      } finally {
        setSyncing(false);
        inflight.current = null;
      }
    })();
    inflight.current = run;
    return run;
  }, [accessToken, threadId, user?.id]);

  useEffect(() => {
    if (settledNonce <= 0) return;
    void syncNow();
  }, [settledNonce, syncNow]);

  return { sessionId: threadId ? teachSessionId(threadId) : '', record, syncing, syncedAt, error, syncNow };
}
