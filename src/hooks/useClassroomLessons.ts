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
import { db, getPreference, setPreference, dedupeAudioSessions, repairMisflaggedVideoLinkRecordings, updateSessionStatus } from '@/lib/db';
import { retranscribeStuckSessions } from '@/lib/services/retranscribe-stuck-sessions';
import { retryPendingRecordingUploads } from '@/lib/services/retry-pending-recording-uploads';
import { useAuth } from '@/lib/hooks/useAuth';
import { useEchoStore } from '@/stores/echo-store';
import { useCollectionStore } from '@/stores/collection-store';
import { audioSessionToLesson } from '@/components/classroom/lessonAdapter';
import type { Lesson } from '@/components/classroom/types';

/** preferences 表里存"已复习的 sessionId 列表"的 key */
const REVIEWED_SESSIONS_KEY = 'classroom_reviewed_sessions';

/**
 * 本次 page load 是否已经跑过一次 audioSessions 去重。
 * 幂等且没必要跑多遍——一次 session 改一次就够。
 */
let hasDedupedInThisSession = false;

/**
 * 本次 page load 是否已经跑过一次 video-link 录音标记修复。
 * 同样幂等——修好之后 sourceType 不再是 'video-link'，重跑无命中。
 */
let hasRepairedMisflaggedInThisSession = false;

/**
 * 本次 page load 是否已经清理过孤立的 recording 态会话。
 * 这是一个 page-lifetime 幂等动作，只在第一次进课堂 tab 时跑。
 */
let hasCleanedStaleRecordingsInThisSession = false;

export interface UseClassroomLessonsResult {
  lessons: Lesson[];
  /** 把一节课标记为已复习（会自动持久化） */
  markReviewed: (sessionId: string) => void;
  /**
   * 把卡在 status='recording' 的幽灵会话降级为 completed。
   *
   * 适用场景：用户点击"正在录音"pill 的停止按钮，但 Recorder 其实
   * 没有挂着这条 session（比如刷新页面、异常中断、旧版本脏数据）。
   * 直接真停没反应，得靠这个兜底把 UI 上那颗红点熄掉。
   */
  cleanupStaleRecording: (sessionId: string) => Promise<void>;
}

export function useClassroomLessons(): UseClassroomLessonsResult {
  const { accessToken, isAuthenticated } = useAuth();
  // ── 0. 挂载时跑一次 dedupe（修复历史脏数据） ──
  // 背景：旧版本 saveAudioSession 走 add、加上 classroomDataService 录音开始时的
  // 空壳 add，历史数据里同一 sessionId 可能有 2-3 行。现在 saveAudioSession 已改为
  // upsert，但老用户本地 IndexedDB 还有残留。挂载时合并一次，UI 就不会再出现
  // "同一节课两张卡 / 点进去串台"的问题。
  useEffect(() => {
    if (hasDedupedInThisSession) return;
    hasDedupedInThisSession = true;
    dedupeAudioSessions()
      .then(({ scanned, merged, deleted }) => {
        if (merged > 0 || deleted > 0) {
          // 只在真的有脏数据时打日志，正常启动时静默
          // eslint-disable-next-line no-console
          console.info('[classroom] dedupe audioSessions:', { scanned, merged, deleted });
        }
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('[classroom] dedupe audioSessions failed:', err);
      });
  }, []);

  // ── 0d. 登录后静默补传曾因断网 / 退后台失败的本地原声 ──
  // 每次只顺序处理两条，避免进课堂时占满移动网络；成功后服务端按 sessionId
  // 自动绑定 Workspace capture，失败仍保留 Blob，后续页面生命周期可再试。
  useEffect(() => {
    if (!isAuthenticated || !accessToken) return;
    void retryPendingRecordingUploads(accessToken).catch(() => undefined);
  }, [accessToken, isAuthenticated]);

  // ── 0a. 挂载时修复"有录音 blob 但被错标为 video-link"的历史数据 ──
  // 背景（2026-04-20）：用户在"看 B 站视频 + 开系统内录"的场景下，录音
  // upsert 历史上没显式传 sourceType，导致视频导入先写入的 'video-link'
  // 被保留——下游 isStoredVideoSession 会误判这些录音卡为"纯视频"，点开
  // 跳 B 站 iframe 而不是放用户本地录的那段音。
  // 修复规则：blob 存在即说明真的录过音，不该是 video-link。videoUrl 保留。
  useEffect(() => {
    if (hasRepairedMisflaggedInThisSession) return;
    hasRepairedMisflaggedInThisSession = true;
    repairMisflaggedVideoLinkRecordings()
      .then((fixed) => {
        if (fixed > 0) {
          // eslint-disable-next-line no-console
          console.info('[classroom] repaired misflagged video-link recordings:', fixed);
        }
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('[classroom] repairMisflaggedVideoLinkRecordings failed:', err);
      });
  }, []);

  // ── 0b. 挂载时清理"孤立的 recording"会话 ──
  // 页面刚加载、没有任何 Recorder 挂着，但 IndexedDB 里如果有 status='recording'
  // 的会话，一定是异常中断或旧版脏数据留下的"幽灵"——它会以红点脉动的
  // ActiveLessonPill 霸占列表顶部，而且用户点它的停止按钮不会有反应。
  //
  // 页面加载时默认没有真在录音的 session（录音是用户主动触发的），
  // 所以这里可以安全地把所有 recording 态强制降级为 completed。
  //
  // 边界：如果用户刷新页面的瞬间碰巧 Recorder 还没走到 setIsRecording(true)
  // 那一步，也几乎不会命中这里（因为本 effect 是 mount once，Recorder 的写
  // 入发生在随后的交互里）。
  useEffect(() => {
    if (hasCleanedStaleRecordingsInThisSession) return;
    hasCleanedStaleRecordingsInThisSession = true;
    (async () => {
      try {
        const stale = await db.audioSessions
          .where('status')
          .equals('recording')
          .toArray();
        if (stale.length === 0) return;
        await Promise.all(
          stale
            .filter((s) => !!s.sessionId)
            .map((s) => updateSessionStatus(s.sessionId, 'completed')),
        );
        // eslint-disable-next-line no-console
        console.info('[classroom] cleaned stale recording sessions:', stale.length);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[classroom] cleanup stale recordings failed:', err);
      }
    })();
  }, []);

  // ── 0c. 挂载时自愈"卡在正在整理却从没真正转写"的录音 ──
  // 真实用户 case（2026-06-03）：手机录 1.5h 会议，流式 ASR 被锁屏/切后台/网络抖动
  // 中断 → 0 段，blob 存了却从没转写 → session 永远「正在整理」。
  //
  // Recorder 侧已修根因（流式 0 段兜底批量转写），但**存量卡住的录音**靠这个 sweep 救：
  // 找到「completed + 有 blob + 0 转录段 + 没成功/失败标记」的 session，
  // 把 blob 重新送 /api/transcribe-fast 转出来，结果写回 IndexedDB（useLiveQuery 自动刷新 UI）。
  //
  // 顺序处理 + page-lifetime 幂等，避免重复扫 / 打爆后端。失败如实标 failed，不假装成功。
  useEffect(() => {
    retranscribeStuckSessions()
      .then((r) => {
        if (r.attempted > 0) {
          // eslint-disable-next-line no-console
          console.info('[classroom] retranscribe stuck sessions:', r);
        }
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('[classroom] retranscribeStuckSessions failed:', err);
      });
  }, []);

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

  const cleanupStaleRecording = useCallback(async (sessionId: string) => {
    if (!sessionId) return;
    try {
      await updateSessionStatus(sessionId, 'completed');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[classroom] cleanupStaleRecording failed:', err);
    }
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
  // 额外做一次 **按 sessionId 去重的 UI 兜底**：即使后台 dedupe 还没跑完、
  // 或者异步期间又来了新的重复行，这里也不会让用户看到重复卡片。
  // 保留第一条（sessions 已按 createdAt desc 排过，第一条就是最新那条）。
  const lessons = useMemo(() => {
    const seen = new Set<string>();
    const uniqSessions = [] as typeof sessions;
    for (const s of sessions) {
      if (!s.sessionId) continue;
      if (seen.has(s.sessionId)) continue;
      seen.add(s.sessionId);
      uniqSessions.push(s);
    }
    return uniqSessions.map((s) => {
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

  return { lessons, markReviewed, cleanupStaleRecording };
}
