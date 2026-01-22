/**
 * useTranscript - 转录数据 Hook
 * 
 * 遵循 vercel-react-best-practices 规则：
 * - client-swr-dedup: 使用 useSWRMutation 管理 mutation
 */

'use client';

import useSWRMutation from 'swr/mutation';
import { useState, useCallback } from 'react';
import { postFetcher } from '@/lib/swr';
import type { TranscriptSegment } from '@/types';

// ==================== 类型定义 ====================

interface TranscribeRequest {
  sessionId: string;
  audioBlob: Blob;
  startTime: number;
}

interface TranscribeResponse {
  success: boolean;
  segments?: TranscriptSegment[];
  error?: string;
}

interface UseTranscriptOptions {
  sessionId: string;
  /** 初始转录内容 */
  initialSegments?: TranscriptSegment[];
}

interface UseTranscriptReturn {
  /** 转录片段列表 */
  segments: TranscriptSegment[];
  /** 是否正在转录 */
  isTranscribing: boolean;
  /** 错误信息 */
  error: Error | null;
  /** 转录音频 */
  transcribe: (audioBlob: Blob, startTime: number) => Promise<TranscriptSegment[]>;
  /** 添加片段（用于实时转录） */
  addSegment: (segment: TranscriptSegment) => void;
  /** 更新片段 */
  updateSegment: (id: string, updates: Partial<TranscriptSegment>) => void;
  /** 清空转录 */
  clear: () => void;
  /** 设置转录（用于加载历史数据） */
  setSegments: (segments: TranscriptSegment[]) => void;
}

// ==================== Hook 实现 ====================

export function useTranscript({ 
  sessionId, 
  initialSegments = [] 
}: UseTranscriptOptions): UseTranscriptReturn {
  const [segments, setSegments] = useState<TranscriptSegment[]>(initialSegments);
  
  // 实际项目中可能用 FormData，这里简化为 JSON
  const { trigger, isMutating, error } = useSWRMutation<
    TranscribeResponse,
    Error,
    string,
    TranscribeRequest
  >('/api/transcribe', async (url, { arg }) => {
    // 使用 FormData 上传音频
    const formData = new FormData();
    formData.append('sessionId', arg.sessionId);
    formData.append('audio', arg.audioBlob);
    formData.append('startTime', arg.startTime.toString());
    
    const response = await fetch(url, {
      method: 'POST',
      body: formData,
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    return response.json();
  });
  
  // 转录音频
  const transcribe = useCallback(async (audioBlob: Blob, startTime: number) => {
    const result = await trigger({
      sessionId,
      audioBlob,
      startTime,
    });
    
    if (result?.success && result.segments) {
      setSegments(prev => [...prev, ...result.segments!]);
      return result.segments;
    }
    
    return [];
  }, [sessionId, trigger]);
  
  // 添加单个片段（实时转录场景）
  const addSegment = useCallback((segment: TranscriptSegment) => {
    setSegments(prev => [...prev, segment]);
  }, []);
  
  // 更新片段
  const updateSegment = useCallback((id: string, updates: Partial<TranscriptSegment>) => {
    setSegments(prev => 
      prev.map(s => s.id === id ? { ...s, ...updates } : s)
    );
  }, []);
  
  // 清空
  const clear = useCallback(() => {
    setSegments([]);
  }, []);
  
  return {
    segments,
    isTranscribing: isMutating,
    error: error || null,
    transcribe,
    addSegment,
    updateSegment,
    clear,
    setSegments,
  };
}

export default useTranscript;
