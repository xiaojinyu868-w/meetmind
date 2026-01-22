/**
 * useSession - 课堂会话数据 Hook
 * 
 * 遵循 vercel-react-best-practices 规则：
 * - client-swr-dedup: 使用 useSWR 自动去重和缓存
 * - client-swr-error: 统一错误处理
 */

'use client';

import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';
import { useCallback } from 'react';
import { authFetcher, postFetcher } from '@/lib/swr';
import type { TranscriptSegment, AudioRecording } from '@/types';

// ==================== 类型定义 ====================

export interface Session {
  id: string;
  title: string;
  subject: string;
  createdAt: string;
  updatedAt: string;
  transcript: TranscriptSegment[];
  recordings: AudioRecording[];
}

interface SessionListResponse {
  success: boolean;
  sessions: Session[];
}

interface SessionDetailResponse {
  success: boolean;
  session: Session;
}

interface CreateSessionRequest {
  title: string;
  subject?: string;
}

interface CreateSessionResponse {
  success: boolean;
  session?: Session;
  error?: string;
}

interface UseSessionsReturn {
  /** 会话列表 */
  sessions: Session[];
  /** 是否正在加载 */
  isLoading: boolean;
  /** 错误信息 */
  error: Error | null;
  /** 刷新列表 */
  refresh: () => Promise<void>;
}

interface UseSessionReturn {
  /** 会话详情 */
  session: Session | null;
  /** 是否正在加载 */
  isLoading: boolean;
  /** 错误信息 */
  error: Error | null;
  /** 刷新详情 */
  refresh: () => Promise<void>;
}

interface UseCreateSessionReturn {
  /** 创建会话 */
  create: (data: CreateSessionRequest) => Promise<Session | null>;
  /** 是否正在创建 */
  isCreating: boolean;
  /** 错误信息 */
  error: Error | null;
}

// ==================== Hook 实现 ====================

/**
 * 获取会话列表
 */
export function useSessions(): UseSessionsReturn {
  const { data, error, isLoading, mutate } = useSWR<SessionListResponse>(
    '/api/sessions',
    authFetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 10000, // 10秒内不重复请求
    }
  );
  
  const refresh = useCallback(async () => {
    await mutate();
  }, [mutate]);
  
  return {
    sessions: data?.sessions || [],
    isLoading,
    error: error || null,
    refresh,
  };
}

/**
 * 获取单个会话详情
 */
export function useSession(sessionId: string | null): UseSessionReturn {
  const { data, error, isLoading, mutate } = useSWR<SessionDetailResponse>(
    sessionId ? `/api/sessions/${sessionId}` : null,
    authFetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 5000,
    }
  );
  
  const refresh = useCallback(async () => {
    await mutate();
  }, [mutate]);
  
  return {
    session: data?.session || null,
    isLoading,
    error: error || null,
    refresh,
  };
}

/**
 * 创建新会话
 */
export function useCreateSession(): UseCreateSessionReturn {
  const { trigger, isMutating, error } = useSWRMutation<
    CreateSessionResponse,
    Error,
    string,
    CreateSessionRequest
  >('/api/sessions', postFetcher);
  
  const create = useCallback(async (data: CreateSessionRequest) => {
    const result = await trigger(data);
    return result?.session || null;
  }, [trigger]);
  
  return {
    create,
    isCreating: isMutating,
    error: error || null,
  };
}

export default useSession;
