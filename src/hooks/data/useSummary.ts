/**
 * useSummary - 课堂摘要数据 Hook
 * 
 * 遵循 vercel-react-best-practices 规则：
 * - client-swr-dedup: 使用 useSWRMutation 管理 mutation
 */

'use client';

import useSWRMutation from 'swr/mutation';
import { useState, useCallback } from 'react';
import { postFetcher } from '@/lib/swr';
import type { ClassSummary, TranscriptSegment } from '@/types';

// ==================== 类型定义 ====================

interface GenerateSummaryRequest {
  sessionId: string;
  transcript: Array<{
    id: string;
    text: string;
    startMs: number;
    endMs: number;
  }>;
}

interface GenerateSummaryResponse {
  success: boolean;
  summary?: Omit<ClassSummary, 'id' | 'sessionId' | 'createdAt' | 'updatedAt'>;
  error?: string;
}

interface UseSummaryOptions {
  sessionId: string;
  segments: TranscriptSegment[];
}

interface UseSummaryReturn {
  /** 课堂摘要 */
  summary: ClassSummary | null;
  /** 是否正在加载 */
  isLoading: boolean;
  /** 错误信息 */
  error: Error | null;
  /** 生成摘要 */
  generate: () => Promise<void>;
  /** 清空摘要 */
  clear: () => void;
}

// ==================== Hook 实现 ====================

export function useSummary({ sessionId, segments }: UseSummaryOptions): UseSummaryReturn {
  const [summary, setSummary] = useState<ClassSummary | null>(null);
  
  // SWR Mutation
  const { trigger, isMutating, error } = useSWRMutation<
    GenerateSummaryResponse,
    Error,
    string,
    GenerateSummaryRequest
  >('/api/generate-summary', postFetcher);
  
  // 生成摘要
  const generate = useCallback(async () => {
    if (segments.length === 0) {
      console.warn('[useSummary] 无转录内容，无法生成摘要');
      return;
    }
    
    const result = await trigger({
      sessionId,
      transcript: segments.map(s => ({
        id: s.id,
        text: s.text,
        startMs: s.startMs,
        endMs: s.endMs,
      })),
    });
    
    if (result?.success && result.summary) {
      setSummary({
        ...result.summary,
        id: crypto.randomUUID(),
        sessionId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  }, [sessionId, segments, trigger]);
  
  // 清空
  const clear = useCallback(() => {
    setSummary(null);
  }, []);
  
  return {
    summary,
    isLoading: isMutating,
    error: error || null,
    generate,
    clear,
  };
}

export default useSummary;
