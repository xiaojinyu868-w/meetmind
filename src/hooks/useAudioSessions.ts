// Dexie.js React Hooks
// 使用 useLiveQuery 实现响应式数据

import { useLiveQuery } from 'dexie-react-hooks';
import { db, AudioSession, deleteSession as dbDeleteSession } from '../lib/db';
import { useAuth } from '@/lib/hooks/useAuth';
import { useCallback } from 'react';

/**
 * 获取所有音频会话（响应式）
 * @deprecated 推荐使用 useUserSessions 获取当前用户的会话
 */
export function useAudioSessions() {
  return useLiveQuery(
    () => db.audioSessions.orderBy('createdAt').reverse().toArray()
  ) ?? [];
}

/**
 * 获取当前用户的音频会话（响应式，支持 userId 过滤）
 */
export function useUserSessions(options: {
  status?: AudioSession['status'];
  limit?: number;
} = {}) {
  const { user } = useAuth();
  const userId = user?.id || '';

  const sessions = useLiveQuery(
    async () => {
      if (!userId) return [];
      
      let query = db.audioSessions.where('userId').equals(userId);
      
      if (options.status) {
        query = db.audioSessions.where('[userId+status]').equals([userId, options.status]);
      }
      
      let collection = query.reverse(); // 按时间倒序
      
      if (options.limit) {
        collection = collection.limit(options.limit);
      }
      
      return collection.toArray();
    },
    [userId, options.status, options.limit]
  ) ?? [];

  const deleteSession = useCallback(async (sessionId: string): Promise<boolean> => {
    if (!userId) return false;
    return dbDeleteSession(sessionId, userId);
  }, [userId]);

  return {
    sessions,
    isLoading: sessions === undefined,
    deleteSession,
    userId,
  };
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
 * @deprecated 推荐使用 useUserTodaySessions 获取当前用户今日会话
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
 * 获取当前用户今日会话（响应式）
 */
export function useUserTodaySessions() {
  const { user } = useAuth();
  const userId = user?.id || '';

  return useLiveQuery(async () => {
    if (!userId) return [];
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    return db.audioSessions
      .where('[userId+createdAt]')
      .between([userId, today], [userId, new Date()], true, true)
      .reverse()
      .toArray();
  }, [userId]) ?? [];
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

/**
 * 获取当前用户的存储统计
 */
export function useUserStorageStats() {
  const { user } = useAuth();
  const userId = user?.id || '';

  return useLiveQuery(async () => {
    if (!userId) return { sessions: 0, anchors: 0, transcripts: 0 };
    
    const [sessions, anchors, transcripts] = await Promise.all([
      db.audioSessions.where('userId').equals(userId).count(),
      db.anchors.where('userId').equals(userId).count(),
      db.transcripts.where('userId').equals(userId).count()
    ]);
    return { sessions, anchors, transcripts };
  }, [userId]) ?? { sessions: 0, anchors: 0, transcripts: 0 };
}
