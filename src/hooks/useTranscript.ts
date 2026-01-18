/**
 * useTranscript - 转录数据管理 Hook
 * 
 * 管理课堂录音的转录数据状态
 */

import { useState, useRef, useCallback } from 'react';
import type { TranscriptSegment, ClassTimeline } from '@/types';
import { dbToTranscriptSegment } from '@/types';
import { memoryService } from '@/lib/services/memory-service';
import { db } from '@/lib/db';

interface UseTranscriptOptions {
  sessionId: string;
}

interface UseTranscriptReturn {
  segments: TranscriptSegment[];
  setSegments: React.Dispatch<React.SetStateAction<TranscriptSegment[]>>;
  liveSegmentsRef: React.MutableRefObject<TranscriptSegment[]>;
  dataSource: 'live' | 'demo';
  setDataSource: React.Dispatch<React.SetStateAction<'live' | 'demo'>>;
  updateTranscript: (newSegments: TranscriptSegment[]) => void;
  buildTimeline: (anchors: import('@/types').Anchor[], sessionInfo?: { subject?: string; teacher?: string; date?: string }) => ClassTimeline;
  saveTranscript: () => Promise<void>;
  loadTranscript: () => Promise<TranscriptSegment[]>;
  clearTranscript: () => void;
  getTotalDuration: () => number;
  getWordCount: () => number;
}

export function useTranscript(options: UseTranscriptOptions): UseTranscriptReturn {
  const { sessionId } = options;
  
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [dataSource, setDataSource] = useState<'live' | 'demo'>('live');
  const liveSegmentsRef = useRef<TranscriptSegment[]>([]);

  // 更新转录（实时转录时使用）
  const updateTranscript = useCallback((newSegments: TranscriptSegment[]) => {
    liveSegmentsRef.current = newSegments;
    setSegments(newSegments);
    setDataSource('live');
  }, []);

  // 构建时间轴
  const buildTimeline = useCallback((
    anchors: import('@/types').Anchor[],
    sessionInfo?: { subject?: string; teacher?: string; date?: string }
  ): ClassTimeline => {
    const currentSegments = liveSegmentsRef.current.length > 0 
      ? liveSegmentsRef.current 
      : segments;
    
    return memoryService.buildTimeline(
      sessionId,
      currentSegments,
      anchors,
      {
        subject: sessionInfo?.subject || '课堂',
        teacher: sessionInfo?.teacher || '',
        date: sessionInfo?.date || new Date().toISOString().split('T')[0],
      }
    );
  }, [sessionId, segments]);

  // 保存转录到 IndexedDB
  const saveTranscript = useCallback(async (): Promise<void> => {
    const currentSegments = liveSegmentsRef.current.length > 0 
      ? liveSegmentsRef.current 
      : segments;
    
    if (currentSegments.length === 0) return;
    
    // 转换为 DB 格式
    await db.transcripts.bulkPut(
      currentSegments.map(seg => ({
        sessionId,
        text: seg.text,
        startMs: seg.startMs,
        endMs: seg.endMs,
        confidence: seg.confidence,
        speakerId: seg.speakerId,
        isFinal: seg.isFinal ?? true,
      }))
    );
  }, [sessionId, segments]);

  // 从 IndexedDB 加载转录
  const loadTranscript = useCallback(async (): Promise<TranscriptSegment[]> => {
    const savedSegments = await db.transcripts
      .where('sessionId')
      .equals(sessionId)
      .toArray();
    
    if (savedSegments.length > 0) {
      // 转换 DB 格式到应用层格式
      const converted = savedSegments.map(s => dbToTranscriptSegment({
        ...s,
        sessionId,
      }));
      setSegments(converted);
      return converted;
    }
    return [];
  }, [sessionId]);

  // 清空转录
  const clearTranscript = useCallback(() => {
    liveSegmentsRef.current = [];
    setSegments([]);
    setDataSource('live');
  }, []);

  // 获取总时长
  const getTotalDuration = useCallback((): number => {
    if (segments.length === 0) return 0;
    return segments[segments.length - 1].endMs - segments[0].startMs;
  }, [segments]);

  // 获取字数
  const getWordCount = useCallback((): number => {
    return segments.reduce((count, seg) => {
      // 中文按字符计数，英文按空格分词计数
      const chinese = seg.text.match(/[\u4e00-\u9fa5]/g) || [];
      const english = seg.text.match(/[a-zA-Z]+/g) || [];
      return count + chinese.length + english.length;
    }, 0);
  }, [segments]);

  return {
    segments,
    setSegments,
    liveSegmentsRef,
    dataSource,
    setDataSource,
    updateTranscript,
    buildTimeline,
    saveTranscript,
    loadTranscript,
    clearTranscript,
    getTotalDuration,
    getWordCount,
  };
}
