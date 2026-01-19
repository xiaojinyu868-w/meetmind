/**
 * 对话历史 Hook
 * 
 * 封装对话历史的状态管理和操作，提供给 AITutor 和 AIChat 组件使用
 */

'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { conversationService, getEffectiveUserId } from '@/lib/services/conversation-service';
import { useAuth } from '@/lib/hooks/useAuth';
import type {
  ConversationHistory,
  ConversationMessage,
  ConversationType,
  CreateConversationParams,
  AddMessageParams,
  ListConversationsParams,
  SearchConversationsParams,
  UseConversationHistoryReturn,
} from '@/types/conversation';

interface UseConversationHistoryOptions {
  /** 对话类型过滤 */
  type?: ConversationType;
  /** 关联的音频会话 ID */
  sessionId?: string;
  /** 自动加载对话列表 */
  autoLoad?: boolean;
  /** 列表加载数量 */
  limit?: number;
}

/**
 * 对话历史 Hook
 */
export function useConversationHistory(
  options: UseConversationHistoryOptions = {}
): UseConversationHistoryReturn {
  const { user } = useAuth();
  const userId = getEffectiveUserId(user?.id);
  
  const [conversations, setConversations] = useState<ConversationHistory[]>([]);
  const [currentConversation, setCurrentConversation] = useState<ConversationHistory | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const isInitialized = useRef(false);

  // 加载对话列表
  const loadConversations = useCallback(async (params?: ListConversationsParams) => {
    setIsLoading(true);
    setError(null);
    
    try {
      const list = await conversationService.listConversations(userId, {
        type: params?.type || options.type,
        sessionId: params?.sessionId || options.sessionId,
        limit: params?.limit || options.limit,
        offset: params?.offset,
      });
      setConversations(list);
    } catch (err) {
      const message = err instanceof Error ? err.message : '加载对话列表失败';
      setError(message);
      console.error('[useConversationHistory] loadConversations error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [userId, options.type, options.sessionId, options.limit]);

  // 创建对话
  const createConversation = useCallback(async (
    params: CreateConversationParams
  ): Promise<ConversationHistory> => {
    setIsLoading(true);
    setError(null);
    
    try {
      const conversation = await conversationService.createConversation({
        ...params,
        userId,
      });
      
      // 更新列表
      setConversations(prev => [conversation, ...prev]);
      // 设置为当前对话
      setCurrentConversation(conversation);
      setMessages([]);
      
      return conversation;
    } catch (err) {
      const message = err instanceof Error ? err.message : '创建对话失败';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  // 选择对话（加载历史消息）
  const selectConversation = useCallback(async (conversationId: string) => {
    setIsLoading(true);
    setError(null);
    
    try {
      // 获取对话信息
      const conversation = await conversationService.getConversation(conversationId);
      if (!conversation) {
        throw new Error('对话不存在');
      }
      
      // 加载消息
      const msgs = await conversationService.getMessages(conversationId);
      
      setCurrentConversation(conversation);
      setMessages(msgs);
    } catch (err) {
      const message = err instanceof Error ? err.message : '加载对话失败';
      setError(message);
      console.error('[useConversationHistory] selectConversation error:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 添加消息
  const addMessage = useCallback(async (params: AddMessageParams): Promise<ConversationMessage> => {
    if (!currentConversation) {
      throw new Error('没有选中的对话');
    }
    
    try {
      const message = await conversationService.addMessage(
        currentConversation.conversationId,
        params
      );
      
      // 更新消息列表
      setMessages(prev => [...prev, message]);
      
      // 更新当前对话的消息计数
      setCurrentConversation(prev => prev ? {
        ...prev,
        messageCount: prev.messageCount + 1,
        lastMessage: params.content.slice(0, 100),
        updatedAt: new Date(),
      } : null);
      
      // 更新列表中对应对话的信息
      setConversations(prev => prev.map(c => 
        c.conversationId === currentConversation.conversationId
          ? {
              ...c,
              messageCount: c.messageCount + 1,
              lastMessage: params.content.slice(0, 100),
              updatedAt: new Date(),
            }
          : c
      ));
      
      return message;
    } catch (err) {
      const message = err instanceof Error ? err.message : '添加消息失败';
      setError(message);
      throw err;
    }
  }, [currentConversation]);

  // 删除对话
  const deleteConversation = useCallback(async (conversationId: string) => {
    setError(null);
    
    try {
      await conversationService.deleteConversation(conversationId);
      
      // 更新列表
      setConversations(prev => prev.filter(c => c.conversationId !== conversationId));
      
      // 如果删除的是当前对话，清空当前对话
      if (currentConversation?.conversationId === conversationId) {
        setCurrentConversation(null);
        setMessages([]);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '删除对话失败';
      setError(message);
      throw err;
    }
  }, [currentConversation]);

  // 搜索对话
  const searchConversations = useCallback(async (
    params: SearchConversationsParams
  ): Promise<ConversationHistory[]> => {
    setError(null);
    
    try {
      return await conversationService.searchConversations(userId, params);
    } catch (err) {
      const message = err instanceof Error ? err.message : '搜索对话失败';
      setError(message);
      throw err;
    }
  }, [userId]);

  // 清空当前对话
  const clearCurrentConversation = useCallback(() => {
    setCurrentConversation(null);
    setMessages([]);
  }, []);

  // 自动加载
  useEffect(() => {
    if (options.autoLoad && !isInitialized.current) {
      isInitialized.current = true;
      loadConversations();
    }
  }, [options.autoLoad, loadConversations]);

  // 用户切换时重新加载
  useEffect(() => {
    if (isInitialized.current && options.autoLoad) {
      loadConversations();
      clearCurrentConversation();
    }
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    // 状态
    conversations,
    currentConversation,
    messages,
    isLoading,
    error,
    // 操作
    loadConversations,
    createConversation,
    selectConversation,
    addMessage,
    deleteConversation,
    searchConversations,
    clearCurrentConversation,
  };
}

/**
 * 单对话模式 Hook（用于 AITutor 等场景）
 * 
 * 自动根据 anchorId 获取或创建对话
 */
export function useSingleConversation(options: {
  type: ConversationType;
  sessionId?: string;
  anchorId?: string;
  anchorTimestamp?: number;
  model?: string;
}) {
  const { user } = useAuth();
  const userId = getEffectiveUserId(user?.id);
  
  const [conversation, setConversation] = useState<ConversationHistory | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const prevAnchorId = useRef<string | undefined>();

  // 初始化或切换对话
  const initConversation = useCallback(async () => {
    // 对于 tutor 类型，需要 anchorId
    if (options.type === 'tutor' && !options.anchorId) {
      setConversation(null);
      setMessages([]);
      return;
    }
    
    // anchorId 未变化时不重复加载
    if (options.anchorId === prevAnchorId.current && conversation) {
      return;
    }
    prevAnchorId.current = options.anchorId;
    
    setIsLoading(true);
    setError(null);
    
    try {
      // 尝试获取已存在的对话
      let conv: ConversationHistory | null = null;
      
      if (options.anchorId) {
        conv = await conversationService.getConversationByAnchor(options.anchorId);
      }
      
      if (!conv) {
        // 创建新对话
        conv = await conversationService.createConversation({
          userId,
          type: options.type,
          sessionId: options.sessionId,
          anchorId: options.anchorId,
          anchorTimestamp: options.anchorTimestamp,
          model: options.model,
        });
        setMessages([]);
      } else {
        // 加载历史消息
        const msgs = await conversationService.getMessages(conv.conversationId);
        setMessages(msgs);
      }
      
      setConversation(conv);
    } catch (err) {
      const message = err instanceof Error ? err.message : '初始化对话失败';
      setError(message);
      console.error('[useSingleConversation] init error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [userId, options.type, options.sessionId, options.anchorId, options.anchorTimestamp, options.model, conversation]);

  // 添加消息
  const addMessage = useCallback(async (params: AddMessageParams): Promise<ConversationMessage | null> => {
    if (!conversation) {
      setError('对话未初始化');
      return null;
    }
    
    try {
      const msg = await conversationService.addMessage(conversation.conversationId, params);
      setMessages(prev => [...prev, msg]);
      setConversation(prev => prev ? {
        ...prev,
        messageCount: prev.messageCount + 1,
        lastMessage: params.content.slice(0, 100),
        updatedAt: new Date(),
      } : null);
      return msg;
    } catch (err) {
      const message = err instanceof Error ? err.message : '添加消息失败';
      setError(message);
      return null;
    }
  }, [conversation]);

  // 批量添加消息
  const addMessages = useCallback(async (msgs: AddMessageParams[]): Promise<void> => {
    if (!conversation) {
      setError('对话未初始化');
      return;
    }
    
    try {
      const newMsgs = await conversationService.addMessages(conversation.conversationId, msgs);
      setMessages(prev => [...prev, ...newMsgs]);
      
      const lastMsg = msgs[msgs.length - 1];
      setConversation(prev => prev ? {
        ...prev,
        messageCount: prev.messageCount + msgs.length,
        lastMessage: lastMsg?.content.slice(0, 100),
        updatedAt: new Date(),
      } : null);
    } catch (err) {
      const message = err instanceof Error ? err.message : '添加消息失败';
      setError(message);
    }
  }, [conversation]);

  // 更新对话标题
  const updateTitle = useCallback(async (title: string) => {
    if (!conversation) return;
    
    try {
      await conversationService.updateConversation(conversation.conversationId, { title });
      setConversation(prev => prev ? { ...prev, title } : null);
    } catch (err) {
      console.error('[useSingleConversation] updateTitle error:', err);
    }
  }, [conversation]);

  // 清空对话
  const clearConversation = useCallback(() => {
    setConversation(null);
    setMessages([]);
    prevAnchorId.current = undefined;
  }, []);

  // anchorId 变化时初始化
  useEffect(() => {
    initConversation();
  }, [options.anchorId]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    conversation,
    messages,
    isLoading,
    error,
    addMessage,
    addMessages,
    updateTitle,
    clearConversation,
    initConversation,
  };
}

export default useConversationHistory;
