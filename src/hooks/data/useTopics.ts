/**
 * useTopics - 精选片段数据 Hook
 * 
 * 遵循 vercel-react-best-practices 规则：
 * - client-swr-dedup: 使用 useSWRMutation 管理 mutation
 * - rerender-functional-setstate: 使用函数式更新
 */

'use client';

import useSWRMutation from 'swr/mutation';
import { useState, useCallback } from 'react';
import { postFetcher } from '@/lib/swr';
import type { HighlightTopic, TranscriptSegment, TopicGenerationMode } from '@/types';

// ==================== 类型定义 ====================

interface GenerateTopicsRequest {
  sessionId: string;
  transcript: Array<{
    id: string;
    text: string;
    startMs: number;
    endMs: number;
    confidence?: number;
  }>;
  mode: TopicGenerationMode;
  theme?: string;
}

interface GenerateTopicsResponse {
  success: boolean;
  topics?: HighlightTopic[];
  error?: string;
}

export interface UseTopicsOptions {
  sessionId: string;
  segments: TranscriptSegment[];
}

export type { TopicGenerationMode } from '@/types';

export interface UseTopicsReturn {
  /** 精选片段列表 */
  topics: HighlightTopic[];
  /** 当前选中的片段 */
  selectedTopic: HighlightTopic | null;
  /** 是否正在加载 */
  isLoading: boolean;
  /** 错误信息 */
  error: Error | null;
  /** 生成精选片段 */
  generate: (mode: TopicGenerationMode) => Promise<void>;
  /** 按主题重新生成 */
  regenerateByTheme: (theme: string) => Promise<void>;
  /** 选中片段 */
  setSelectedTopic: (topic: HighlightTopic | null) => void;
  /** 清空片段 */
  clear: () => void;
}

// ==================== Hook 实现 ====================

export function useTopics({ sessionId, segments }: UseTopicsOptions): UseTopicsReturn {
  const [topics, setTopics] = useState<HighlightTopic[]>([]);
  const [selectedTopic, setSelectedTopic] = useState<HighlightTopic | null>(null);
  
  // SWR Mutation
  const { trigger, isMutating, error } = useSWRMutation<
    GenerateTopicsResponse,
    Error,
    string,
    GenerateTopicsRequest
  >('/api/generate-topics', postFetcher);
  
  // 生成精选片段
  const generate = useCallback(async (mode: TopicGenerationMode) => {
    if (segments.length === 0) {
      console.warn('[useTopics] 无转录内容，无法生成精选片段');
      return;
    }
    
    const result = await trigger({
      sessionId,
      transcript: segments.map(s => ({
        id: s.id,
        text: s.text,
        startMs: s.startMs,
        endMs: s.endMs,
        confidence: s.confidence,
      })),
      mode,
    });
    
    if (result?.success && result.topics) {
      setTopics(result.topics);
    }
  }, [sessionId, segments, trigger]);
  
  // 按主题重新生成
  const regenerateByTheme = useCallback(async (theme: string) => {
    if (segments.length === 0) return;
    
    const result = await trigger({
      sessionId,
      transcript: segments.map(s => ({
        id: s.id,
        text: s.text,
        startMs: s.startMs,
        endMs: s.endMs,
      })),
      mode: 'smart',
      theme,
    });
    
    if (result?.success && result.topics) {
      setTopics(result.topics);
    }
  }, [sessionId, segments, trigger]);
  
  // 清空
  const clear = useCallback(() => {
    setTopics([]);
    setSelectedTopic(null);
  }, []);
  
  return {
    topics,
    selectedTopic,
    isLoading: isMutating,
    error: error || null,
    generate,
    regenerateByTheme,
    setSelectedTopic,
    clear,
  };
}

export default useTopics;
