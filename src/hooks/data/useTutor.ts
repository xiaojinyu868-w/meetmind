/**
 * useTutor - AI 家教聊天数据 Hook
 * 
 * 遵循 vercel-react-best-practices 规则：
 * - client-swr-dedup: 使用 useSWRMutation 管理 mutation，避免重复请求
 * - client-swr-error: 统一错误处理
 */

'use client';

import useSWRMutation from 'swr/mutation';
import { useState, useCallback, useRef } from 'react';
import { postFetcher } from '@/lib/swr';
import type { TranscriptSegment } from '@/types';

// ==================== 类型定义 ====================

export interface TutorMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  /** 关联的转录片段时间戳 */
  relatedTimestamps?: number[];
}

interface TutorChatRequest {
  sessionId: string;
  message: string;
  context: {
    transcript: Array<{
      id: string;
      text: string;
      startMs: number;
      endMs: number;
    }>;
    currentTime?: number;
  };
  history: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
}

interface TutorChatResponse {
  success: boolean;
  reply?: string;
  relatedTimestamps?: number[];
  error?: string;
}

interface UseTutorOptions {
  sessionId: string;
  segments: TranscriptSegment[];
  currentTime?: number;
}

interface UseTutorReturn {
  /** 聊天历史 */
  messages: TutorMessage[];
  /** 是否正在加载 */
  isLoading: boolean;
  /** 错误信息 */
  error: Error | null;
  /** 发送消息 */
  sendMessage: (message: string) => Promise<void>;
  /** 清空历史 */
  clearHistory: () => void;
  /** 添加系统欢迎消息 */
  addWelcomeMessage: (content: string) => void;
}

// ==================== Hook 实现 ====================

export function useTutor({ 
  sessionId, 
  segments, 
  currentTime 
}: UseTutorOptions): UseTutorReturn {
  const [messages, setMessages] = useState<TutorMessage[]>([]);
  const messageIdRef = useRef(0);
  
  // SWR Mutation
  const { trigger, isMutating, error } = useSWRMutation<
    TutorChatResponse,
    Error,
    string,
    TutorChatRequest
  >('/api/tutor-chat', postFetcher);
  
  // 生成唯一 ID
  const generateId = useCallback(() => {
    messageIdRef.current += 1;
    return `msg-${Date.now()}-${messageIdRef.current}`;
  }, []);
  
  // 发送消息
  const sendMessage = useCallback(async (message: string) => {
    if (!message.trim()) return;
    
    // 添加用户消息
    const userMessage: TutorMessage = {
      id: generateId(),
      role: 'user',
      content: message,
      timestamp: Date.now(),
    };
    
    setMessages(prev => [...prev, userMessage]);
    
    // 调用 API
    const result = await trigger({
      sessionId,
      message,
      context: {
        transcript: segments.map(s => ({
          id: s.id,
          text: s.text,
          startMs: s.startMs,
          endMs: s.endMs,
        })),
        currentTime,
      },
      history: messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
    });
    
    // 添加 AI 回复
    if (result?.success && result.reply) {
      const assistantMessage: TutorMessage = {
        id: generateId(),
        role: 'assistant',
        content: result.reply,
        timestamp: Date.now(),
        relatedTimestamps: result.relatedTimestamps,
      };
      setMessages(prev => [...prev, assistantMessage]);
    }
  }, [sessionId, segments, currentTime, messages, trigger, generateId]);
  
  // 清空历史
  const clearHistory = useCallback(() => {
    setMessages([]);
  }, []);
  
  // 添加欢迎消息
  const addWelcomeMessage = useCallback((content: string) => {
    const welcomeMessage: TutorMessage = {
      id: generateId(),
      role: 'assistant',
      content,
      timestamp: Date.now(),
    };
    setMessages(prev => {
      // 避免重复添加
      if (prev.length === 0) {
        return [welcomeMessage];
      }
      return prev;
    });
  }, [generateId]);
  
  return {
    messages,
    isLoading: isMutating,
    error: error || null,
    sendMessage,
    clearHistory,
    addWelcomeMessage,
  };
}

export default useTutor;
