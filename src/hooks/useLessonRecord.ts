'use client';

/**
 * useLessonRecord —— 复习页里：这节课如果是同学讲的（audioSessions.sourceType='teach-live'），拉它的 LessonRecord。
 * 材料卡、复习同桌的附件层、「接着讲」都从这一份来；不是同学讲的课返回 null，零开销。
 */

import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { useAuth } from '@/lib/hooks/useAuth';
import { fetchLessonRecord } from '@/hooks/useLessonRecordSync';
import { formatLessonMaterialsForTutor } from '@/lib/review/lesson-materials-context';
import type { LessonRecord } from '@/lib/services/teach-live/lesson-record';

export interface LessonRecordState {
  record: LessonRecord | null;
  /** 复习同桌的附件层文本（空串 = 没有材料） */
  tutorContextText: string;
  loading: boolean;
  error: string | null;
}

const EMPTY: LessonRecordState = { record: null, tutorContextText: '', loading: false, error: null };

export function useLessonRecord(sessionId: string | null | undefined): LessonRecordState {
  const { accessToken } = useAuth();
  const session = useLiveQuery(
    async () => (sessionId ? db.audioSessions.where('sessionId').equals(sessionId).first() : undefined),
    [sessionId],
  );
  const threadId = session?.sourceType === 'teach-live' && session.sourceRef ? session.sourceRef : null;
  const [record, setRecord] = useState<LessonRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!threadId || !accessToken) {
      setRecord(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchLessonRecord(accessToken, threadId)
      .then((fresh) => {
        if (!cancelled) setRecord(fresh);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [threadId, accessToken]);

  const tutorContextText = useMemo(() => (record ? formatLessonMaterialsForTutor(record) : ''), [record]);
  if (!threadId) return EMPTY;
  return { record, tutorContextText, loading, error };
}
