// Dexie.js React Hooks
// 使用 useLiveQuery 实现响应式数据

import { useLiveQuery } from 'dexie-react-hooks';
import { db, AudioSession, Anchor, TranscriptSegment } from '../lib/db';

/**
 * 获取所有音频会话（响应式）
 */
export function useAudioSessions() {
  return useLiveQuery(
    () => db.audioSessions.orderBy('createdAt').reverse().toArray()
  ) ?? [];
}

/**
 * 获取单个会话
 */
export function useAudioSession(sessionId: string | undefined) {
  return useLiveQuery(
    () => sessionId 
      ? db.audioSessions.where('sessionId').equals(sessionId).first()
      : undefined,
    [sessionId]
  );
}

/**
 * 获取今日会话（响应式）
 */
export function useTodaySessions() {
  return useLiveQuery(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return db.audioSessions
      .where('createdAt')
      .aboveOrEqual(today)
      .reverse()
      .toArray();
  }) ?? [];
}

/**
 * 获取会话的困惑点（响应式）
 */
export function useAnchors(sessionId: string | undefined) {
  return useLiveQuery(
    () => sessionId
      ? db.anchors.where('sessionId').equals(sessionId).sortBy('timestamp')
      : [],
    [sessionId]
  ) ?? [];
}

/**
 * 获取未解决的困惑点
 */
export function useActiveAnchors(sessionId: string | undefined) {
  return useLiveQuery(
    () => sessionId
      ? db.anchors
          .where(['sessionId', 'status'])
          .equals([sessionId, 'active'])
          .sortBy('timestamp')
      : [],
    [sessionId]
  ) ?? [];
}

/**
 * 获取会话的转录（响应式）
 */
export function useTranscripts(sessionId: string | undefined) {
  return useLiveQuery(
    () => sessionId
      ? db.transcripts.where('sessionId').equals(sessionId).sortBy('startMs')
      : [],
    [sessionId]
  ) ?? [];
}

/**
 * 获取存储统计
 */
export function useStorageStats() {
  return useLiveQuery(async () => {
    const [sessions, anchors, transcripts] = await Promise.all([
      db.audioSessions.count(),
      db.anchors.count(),
      db.transcripts.count()
    ]);
    return { sessions, anchors, transcripts };
  }) ?? { sessions: 0, anchors: 0, transcripts: 0 };
}

/**
 * 获取今日统计
 */
export function useTodayStats() {
  return useLiveQuery(async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const sessions = await db.audioSessions
      .where('createdAt')
      .aboveOrEqual(today)
      .toArray();
    
    const sessionIds = sessions.map(s => s.sessionId);
    
    const [totalAnchors, resolvedAnchors] = await Promise.all([
      db.anchors.where('sessionId').anyOf(sessionIds).count(),
      db.anchors
        .where('sessionId')
        .anyOf(sessionIds)
        .filter(a => a.status === 'resolved')
        .count()
    ]);
    
    const totalDuration = sessions.reduce((sum, s) => sum + (s.duration || 0), 0);
    
    return {
      sessionCount: sessions.length,
      totalDuration,
      totalAnchors,
      resolvedAnchors,
      completionRate: totalAnchors > 0 ? Math.round((resolvedAnchors / totalAnchors) * 100) : 100
    };
  }) ?? {
    sessionCount: 0,
    totalDuration: 0,
    totalAnchors: 0,
    resolvedAnchors: 0,
    completionRate: 100
  };
}
