/**
 * useSummary - 课堂摘要数据 Hook
 * 
 * 遵循 vercel-react-best-practices 规则：
 * - client-swr-dedup: 使用 useSWRMutation 管理 mutation
 */

'use client';

import useSWRMutation from 'swr/mutation';
import { useState, useCallback, useEffect } from 'react';
import { postFetcher } from '@/lib/swr';
import type { ClassSummary, TranscriptSegment } from '@/types';
import { getSessionSummary, saveClassSummary } from '@/lib/db';

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
  const [isLoadingFromDb, setIsLoadingFromDb] = useState(true);
  
  // 初始化时从 IndexedDB 加载已有摘要
  useEffect(() => {
    let mounted = true;
    
    async function loadSummaryFromDb() {
      if (!sessionId || sessionId === 'default') {
        setIsLoadingFromDb(false);
        return;
      }
      
      try {
        const existingSummary = await getSessionSummary(sessionId);
        if (mounted && existingSummary) {
          // 转换 DB 格式为组件格式
          setSummary({
            id: existingSummary.summaryId,
            sessionId: existingSummary.sessionId,
            overview: existingSummary.overview,
            takeaways: existingSummary.takeaways,
            keyDifficulties: existingSummary.keyDifficulties,
            structure: existingSummary.structure,
            createdAt: existingSummary.createdAt.toISOString(),
            updatedAt: existingSummary.updatedAt.toISOString(),
          });
          console.log('[useSummary] 从 IndexedDB 加载摘要成功');
        }
      } catch (err) {
        console.error('[useSummary] 从 IndexedDB 加载摘要失败:', err);
      } finally {
        if (mounted) {
          setIsLoadingFromDb(false);
        }
      }
    }
    
    loadSummaryFromDb();
    
    return () => {
      mounted = false;
    };
  }, [sessionId]);
  
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
      const summaryId = crypto.randomUUID();
      const newSummary = {
        ...result.summary,
        id: summaryId,
        sessionId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setSummary(newSummary);
      
      // 保存到 IndexedDB
      try {
        await saveClassSummary({
          summaryId,
          sessionId,
          overview: result.summary.overview,
          takeaways: result.summary.takeaways,
          keyDifficulties: result.summary.keyDifficulties,
          structure: result.summary.structure,
        });
        console.log('[useSummary] 摘要已保存到 IndexedDB');
      } catch (err) {
        console.error('[useSummary] 保存摘要到 IndexedDB 失败:', err);
      }
    }
  }, [sessionId, segments, trigger]);
  
  // 清空
  const clear = useCallback(() => {
    setSummary(null);
  }, []);
  
  return {
    summary,
    isLoading: isLoadingFromDb || isMutating,
    error: error || null,
    generate,
    clear,
  };
}

export default useSummary;
