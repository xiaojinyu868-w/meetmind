/**
 * 课堂数据 Hook
 * 
 * 提供课堂数据的读写操作，支持学生端和教师端使用。
 * 
 * 学生端使用：
 * - markConfusion(): 标记困惑点
 * - cancelAnchor(): 撤销困惑点
 * - resolveAnchor(): 标记已解决
 * 
 * 教师端使用：
 * - classroomData: 完整课堂数据
 * - hotspots: 困惑热点列表
 * - refresh(): 刷新数据
 */

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from './useAuth';
import { 
  classroomDataService, 
  type StudentAnchor, 
  type ClassroomData,
  type ConfusionHotspot,
  type ClassSession,
  type AnchorType,
} from '@/lib/services/classroom-data-service';
import type { TranscriptSegment } from '@/types';

// ==================== 类型定义 ====================

interface UseClassroomDataOptions {
  /** 课程会话ID */
  sessionId: string;
  /** 是否自动刷新 (教师端) */
  autoRefresh?: boolean;
  /** 自动刷新间隔 (毫秒) */
  refreshInterval?: number;
  /** 转录内容 (用于聚合热点) */
  transcripts?: TranscriptSegment[];
}

interface UseClassroomDataReturn {
  // 状态
  isLoading: boolean;
  error: string | null;
  
  // 课程数据
  session: ClassSession | null;
  anchors: StudentAnchor[];
  hotspots: ConfusionHotspot[];
  classroomData: ClassroomData | null;
  
  // 统计
  statistics: {
    totalStudents: number;
    totalAnchors: number;
    unresolvedCount: number;
  };
  
  // 学生端操作
  markConfusion: (timestamp: number, transcriptContext?: string) => StudentAnchor | null;
  cancelAnchor: (anchorId: string) => boolean;
  resolveAnchor: (anchorId: string, aiExplanation?: string) => void;
  addNote: (anchorId: string, note: string) => void;
  
  // 课程管理
  saveSession: (session: Partial<ClassSession>) => void;
  completeSession: () => void;
  
  // 数据操作
  refresh: () => Promise<void>;
  migrateFromLegacy: () => number;
}

// ==================== Hook 实现 ====================

export function useClassroomData(options: UseClassroomDataOptions): UseClassroomDataReturn {
  const { sessionId, autoRefresh = false, refreshInterval = 5000, transcripts = [] } = options;
  
  const { user, isAuthenticated } = useAuth();
  
  // 状态
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<ClassSession | null>(null);
  const [anchors, setAnchors] = useState<StudentAnchor[]>([]);
  const [hotspots, setHotspots] = useState<ConfusionHotspot[]>([]);
  const [classroomData, setClassroomData] = useState<ClassroomData | null>(null);
  
  // Refs
  const transcriptsRef = useRef(transcripts);
  transcriptsRef.current = transcripts;
  
  // ============ 数据加载 ============
  
  const loadData = useCallback(async () => {
    if (!sessionId) return;
    
    try {
      setError(null);
      
      // 获取完整课堂数据
      const data = await classroomDataService.getClassroomData(sessionId);
      
      if (data) {
        setSession(data.session);
        setAnchors(data.anchors);
        setClassroomData(data);
        
        // 使用最新的转录内容重新聚合热点
        const newHotspots = classroomDataService.aggregateHotspots(
          sessionId,
          transcriptsRef.current.length > 0 ? transcriptsRef.current : data.transcripts
        );
        setHotspots(newHotspots);
      } else {
        // 如果没有课堂数据，尝试只获取困惑点
        const sessionAnchors = classroomDataService.getSessionAnchors(sessionId);
        setAnchors(sessionAnchors);
        
        if (transcriptsRef.current.length > 0) {
          const newHotspots = classroomDataService.aggregateHotspots(
            sessionId,
            transcriptsRef.current
          );
          setHotspots(newHotspots);
        }
      }
    } catch (err) {
      console.error('加载课堂数据失败:', err);
      setError('加载数据失败');
    } finally {
      setIsLoading(false);
    }
  }, [sessionId]);
  
  // 初始加载
  useEffect(() => {
    loadData();
  }, [loadData]);
  
  // 自动刷新 (教师端)
  useEffect(() => {
    if (!autoRefresh) return;
    
    const timer = setInterval(loadData, refreshInterval);
    return () => clearInterval(timer);
  }, [autoRefresh, refreshInterval, loadData]);
  
  // 监听跨标签页更新
  useEffect(() => {
    const cleanup = classroomDataService.onAnchorUpdate((action, anchor) => {
      if (anchor.sessionId !== sessionId) return;
      
      // 更新本地状态
      setAnchors(prev => {
        switch (action) {
          case 'add':
            return [...prev, anchor];
          case 'cancel':
          case 'resolve':
            return prev.map(a => a.id === anchor.id ? anchor : a);
          default:
            return prev;
        }
      });
      
      // 重新聚合热点
      setTimeout(() => {
        const newHotspots = classroomDataService.aggregateHotspots(
          sessionId,
          transcriptsRef.current
        );
        setHotspots(newHotspots);
      }, 100);
    });
    
    return cleanup;
  }, [sessionId]);
  
  // 当转录内容更新时，重新聚合热点
  useEffect(() => {
    if (transcripts.length > 0 && anchors.length > 0) {
      const newHotspots = classroomDataService.aggregateHotspots(sessionId, transcripts);
      setHotspots(newHotspots);
    }
  }, [transcripts, anchors, sessionId]);
  
  // ============ 学生端操作 ============
  
  /**
   * 标记困惑点
   */
  const markConfusion = useCallback((
    timestamp: number,
    transcriptContext?: string
  ): StudentAnchor | null => {
    if (!user) {
      console.warn('用户未登录，无法标记困惑点');
      return null;
    }
    
    const anchor = classroomDataService.saveStudentAnchor(
      sessionId,
      user.id,
      user.nickname || user.username,
      timestamp,
      'confusion',
      transcriptContext
    );
    
    // 更新本地状态
    setAnchors(prev => [...prev, anchor]);
    
    return anchor;
  }, [sessionId, user]);
  
  /**
   * 撤销困惑点
   */
  const cancelAnchor = useCallback((anchorId: string): boolean => {
    const success = classroomDataService.cancelAnchor(anchorId);
    
    if (success) {
      setAnchors(prev => prev.map(a => 
        a.id === anchorId ? { ...a, status: 'cancelled' as const } : a
      ));
    }
    
    return success;
  }, []);
  
  /**
   * 标记已解决
   */
  const resolveAnchor = useCallback((anchorId: string, aiExplanation?: string): void => {
    classroomDataService.resolveAnchor(anchorId, aiExplanation);
    
    setAnchors(prev => prev.map(a => 
      a.id === anchorId 
        ? { ...a, status: 'resolved' as const, aiExplanation, resolvedAt: new Date().toISOString() }
        : a
    ));
  }, []);
  
  /**
   * 添加备注
   */
  const addNote = useCallback((anchorId: string, note: string): void => {
    classroomDataService.addNote(anchorId, note);
    
    setAnchors(prev => prev.map(a => 
      a.id === anchorId ? { ...a, note } : a
    ));
  }, []);
  
  // ============ 课程管理 ============
  
  /**
   * 保存课程信息
   */
  const saveSession = useCallback((sessionData: Partial<ClassSession>): void => {
    const saved = classroomDataService.saveSession({
      id: sessionId,
      ...sessionData,
      createdBy: user?.id,
    });
    setSession(saved);
  }, [sessionId, user?.id]);
  
  /**
   * 完成课程
   */
  const completeSession = useCallback((): void => {
    classroomDataService.completeSession(sessionId);
    setSession(prev => prev ? { ...prev, status: 'completed' } : null);
  }, [sessionId]);
  
  // ============ 数据操作 ============
  
  /**
   * 刷新数据
   */
  const refresh = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    await loadData();
  }, [loadData]);
  
  /**
   * 从旧版迁移数据
   */
  const migrateFromLegacy = useCallback((): number => {
    if (!user) return 0;
    
    const count = classroomDataService.migrateFromLegacyAnchorService(
      sessionId,
      user.id,
      user.nickname || user.username
    );
    
    if (count > 0) {
      loadData();
    }
    
    return count;
  }, [sessionId, user, loadData]);
  
  // ============ 统计数据 ============
  
  const statistics = {
    totalStudents: new Set(anchors.filter(a => a.status !== 'cancelled').map(a => a.studentId)).size,
    totalAnchors: anchors.filter(a => a.status !== 'cancelled').length,
    unresolvedCount: anchors.filter(a => a.status === 'active').length,
  };
  
  return {
    isLoading,
    error,
    session,
    anchors: anchors.filter(a => a.status !== 'cancelled'),
    hotspots,
    classroomData,
    statistics,
    markConfusion,
    cancelAnchor,
    resolveAnchor,
    addNote,
    saveSession,
    completeSession,
    refresh,
    migrateFromLegacy,
  };
}

export default useClassroomData;
