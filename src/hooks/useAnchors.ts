/**
 * useAnchors - 困惑点管理 Hook
 * 
 * 管理学生标记的困惑点状态和操作
 */

import { useState, useCallback } from 'react';
import { anchorService, type Anchor } from '@/lib/services/anchor-service';
import { classroomDataService } from '@/lib/services/classroom-data-service';
import type { TranscriptSegment, ClassTimeline } from '@/types';

interface UseAnchorsOptions {
  sessionId: string;
  studentId: string;
  studentName: string;
  segments: TranscriptSegment[];
  timeline: ClassTimeline | null;
  onTimelineUpdate?: (timeline: ClassTimeline) => void;
}

interface UseAnchorsReturn {
  anchors: Anchor[];
  selectedAnchor: Anchor | null;
  setAnchors: React.Dispatch<React.SetStateAction<Anchor[]>>;
  setSelectedAnchor: (anchor: Anchor | null) => void;
  markAnchor: (timestamp: number) => Anchor;
  cancelAnchor: (anchorId: string) => boolean;
  resolveAnchor: (anchorId: string) => void;
  addNote: (anchorId: string, note: string) => void;
  getActiveAnchors: () => Anchor[];
  getUnresolvedAnchors: () => Anchor[];
  clearAnchors: () => void;
}

export function useAnchors(options: UseAnchorsOptions): UseAnchorsReturn {
  const { sessionId, studentId, studentName, segments, timeline, onTimelineUpdate } = options;
  
  const [anchors, setAnchors] = useState<Anchor[]>([]);
  const [selectedAnchor, setSelectedAnchor] = useState<Anchor | null>(null);

  // 标记困惑点
  const markAnchor = useCallback((timestamp: number): Anchor => {
    // 写入本地存储
    const anchor = anchorService.mark(sessionId, studentId, timestamp, 'confusion');
    setAnchors(prev => [...prev, anchor]);
    
    // 获取当前时间点附近的转录内容作为上下文
    const contextSegments = segments.filter(
      s => s.startMs <= timestamp + 5000 && s.endMs >= timestamp - 5000
    );
    const transcriptContext = contextSegments.map(s => s.text).join(' ').slice(0, 200);
    
    // 写入共享存储 (供教师端读取)
    classroomDataService.saveStudentAnchor(
      sessionId,
      studentId,
      studentName,
      timestamp,
      'confusion',
      transcriptContext
    );
    
    // 更新时间轴
    if (timeline && onTimelineUpdate) {
      onTimelineUpdate({ ...timeline, anchors: [...timeline.anchors, anchor] });
    }
    
    return anchor;
  }, [sessionId, studentId, studentName, segments, timeline, onTimelineUpdate]);

  // 撤销困惑点
  const cancelAnchor = useCallback((anchorId: string): boolean => {
    const success = anchorService.cancel(anchorId, sessionId);
    if (success) {
      setAnchors(prev => prev.map(a => 
        a.id === anchorId ? { ...a, cancelled: true } : a
      ));
      if (selectedAnchor?.id === anchorId) {
        setSelectedAnchor(null);
      }
    }
    return success;
  }, [sessionId, selectedAnchor]);

  // 标记为已解决
  const resolveAnchor = useCallback((anchorId: string): void => {
    anchorService.resolve(anchorId, sessionId);
    setAnchors(prev => prev.map(a => 
      a.id === anchorId ? { ...a, resolved: true, resolvedAt: new Date().toISOString() } : a
    ));
    
    // 更新共享存储
    classroomDataService.updateAnchorStatus(anchorId, 'resolved');
    
    // 更新时间轴
    if (timeline && onTimelineUpdate) {
      const updatedAnchors = timeline.anchors.map(a =>
        a.id === anchorId ? { ...a, resolved: true } : a
      );
      onTimelineUpdate({ ...timeline, anchors: updatedAnchors });
    }
  }, [sessionId, timeline, onTimelineUpdate]);

  // 添加备注
  const addNote = useCallback((anchorId: string, note: string): void => {
    anchorService.addNote(anchorId, sessionId, note);
    setAnchors(prev => prev.map(a => 
      a.id === anchorId ? { ...a, note } : a
    ));
  }, [sessionId]);

  // 获取有效困惑点
  const getActiveAnchors = useCallback((): Anchor[] => {
    return anchors.filter(a => !a.cancelled);
  }, [anchors]);

  // 获取未解决困惑点
  const getUnresolvedAnchors = useCallback((): Anchor[] => {
    return anchors.filter(a => !a.cancelled && !a.resolved);
  }, [anchors]);

  // 清空困惑点
  const clearAnchors = useCallback((): void => {
    anchorService.clear(sessionId);
    setAnchors([]);
    setSelectedAnchor(null);
  }, [sessionId]);

  return {
    anchors,
    selectedAnchor,
    setAnchors,
    setSelectedAnchor,
    markAnchor,
    cancelAnchor,
    resolveAnchor,
    addNote,
    getActiveAnchors,
    getUnresolvedAnchors,
    clearAnchors,
  };
}
