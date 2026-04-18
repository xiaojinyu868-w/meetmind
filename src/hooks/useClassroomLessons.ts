/**
 * useClassroomLessons — 课堂列表数据 hook
 *
 * 数据流：
 *   IndexedDB.audioSessions      ──┐
 *   IndexedDB.transcripts        ──┤
 *   IndexedDB.highlightTopics    ──┼──> audioSessionToLesson ──> Lesson[]
 *   IndexedDB.preferences        ──┤     (reviewed set)
 *   useEchoStore.workspaceEchoes ──┤
 *   useEchoStore.workspaceCaptures ┤
 *   useCollectionStore.sourceItems ┘     (linkedMaterials by date)
 *
 * 用 dexie-react-hooks 的 useLiveQuery，数据是响应式的。
 */

'use client';

import { useMemo, useEffect, useState, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getPreference, setPreference } from '@/lib/db';
import { useEchoStore } from '@/stores/echo-store';
import { useCollectionStore } from '@/stores/collection-store';
import { audioSessionToLesson } from '@/components/classroom/lessonAdapter';
import type { Lesson } from '@/components/classroom/types';

/** preferences 表里存"已复习的 sessionId 列表"的 key */
const REVIEWED_SESSIONS_KEY = 'classroom_reviewed_sessions';

export interface UseClassroomLessonsResult {
  lessons: Lesson[];
  /** 把一节课标记为已复习（会自动持久化） */
  markReviewed: (sessionId: string) => void;
}

export function useClassroomLessons(): UseClassroomLessonsResult {
  // ── 1. audioSessions（主表） ──
  const sessions = useLiveQuery(
    () => db.audioSessions.orderBy('createdAt').reverse().toArray(),
  ) ?? [];

  // ── 2. transcripts：有转录的 sessionId 集合（判断 ready vs processing） ──
  const transcriptSessionIds = useLiveQuery(async () => {
    const rows = await db.transcripts.toArray();
    return new Set(rows.map((r) => r.sessionId));
  }) ?? new Set<string>();

  // ── 3. highlightTopics：按 session 计数 keyPoints ──
  const highlightCountBySession = useLiveQuery(async () => {
    const rows = await db.highlightTopics.toArray();
    const map = new Map<string, number>();
    for (const r of rows) {
      map.set(r.sessionId, (map.get(r.sessionId) ?? 0) + 1);
    }
    return map;
  }) ?? new Map<string, number>();

  // ── 4. reviewed set：从 preferences 读，本地状态维护 ──
  const [reviewedSet, setReviewedSet] = useState<Set<string>>(new Set());
  useEffect(() => {
    let alive = true;
    getPreference<string[]>(REVIEWED_SESSIONS_KEY, []).then((arr) => {
      if (!alive) return;
      setReviewedSet(new Set(arr));
    }).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  const markReviewed = useCallback((sessionId: string) => {
    if (!sessionId) return;
    setReviewedSet((prev) => {
      if (prev.has(sessionId)) return prev;
      const next = new Set(prev);
      next.add(sessionId);
      void setPreference(REVIEWED_SESSIONS_KEY, Array.from(next)).catch(() => undefined);
      return next;
    });
  }, []);

  // ── 5. hasEcho 映射：echo.sourceCaptureIds → capture.metadata.sessionId ──
  const workspaceEchoes = useEchoStore((s) => s.workspaceEchoes);
  const workspaceCaptures = useEchoStore((s) => s.workspaceCaptures);

  const sessionIdsWithEcho = useMemo(() => {
    if (workspaceEchoes.length === 0 || workspaceCaptures.length === 0) {
      return new Set<string>();
    }
    // 先建 captureId → sessionId 的反向索引
    const captureIdToSessionId = new Map<string, string>();
    for (const cap of workspaceCaptures) {
      const sid = typeof cap.metadata?.sessionId === 'string' ? cap.metadata.sessionId : null;
      if (sid) captureIdToSessionId.set(cap.id, sid);
    }
    // 遍历 echoes，凡是 sourceCaptureIds 里有落到某个 sessionId 的，就打勾
    const hit = new Set<string>();
    for (const echo of workspaceEchoes) {
      if (!echo.sourceCaptureIds) continue;
      for (const cid of echo.sourceCaptureIds) {
        const sid = captureIdToSessionId.get(cid);
        if (sid) hit.add(sid);
      }
    }
    return hit;
  }, [workspaceEchoes, workspaceCaptures]);

  // ── 6. linkedMaterials：同一天创建的 sourceItems 里的非 audio/video 数量 ──
  // 松绑定：用户在课前丢的链接/图片/笔记算作"这一天的预习材料"
  const sourceItems = useCollectionStore((s) => s.sourceItems);
  const materialsCountByDate = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of sourceItems) {
      if (item.type === 'audio' || item.type === 'video') continue;
      const date = (item.addedAt || '').split('T')[0];
      if (!date) continue;
      map.set(date, (map.get(date) ?? 0) + 1);
    }
    return map;
  }, [sourceItems]);

  // ── 7. 组装 Lesson[] ──
  const lessons = useMemo(() => {
    return sessions.map((s) => {
      const lesson = audioSessionToLesson(s, {
        hasTranscript: transcriptSessionIds.has(s.sessionId),
        highlightCount: highlightCountBySession.get(s.sessionId),
        hasEcho: sessionIdsWithEcho.has(s.sessionId),
      });
      // 覆盖 reviewed（adapter 默认给 false）
      lesson.reviewed = reviewedSet.has(s.sessionId);
      // 注入 linkedMaterials（按日期）
      const materials = materialsCountByDate.get(lesson.date);
      if (materials && materials > 0) lesson.linkedMaterials = materials;
      return lesson;
    });
  }, [sessions, transcriptSessionIds, highlightCountBySession, sessionIdsWithEcho, reviewedSet, materialsCountByDate]);

  return { lessons, markReviewed };
}
