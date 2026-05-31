'use client';

/**
 * 对话历史列表组件
 */

import { useState, useCallback, useEffect } from 'react';
import { useConversationHistory } from '@/hooks/useConversationHistory';
import { ConversationItem } from './ConversationItem';
import type { ConversationType, ConversationHistory } from '@/types/conversation';

interface ConversationListProps {
  /** 对话类型过滤 */
  type?: ConversationType;
  /** 关联的音频会话 ID */
  sessionId?: string;
  /** 选中的对话 ID */
  activeConversationId?: string;
  /** 选择对话回调 */
  onSelect: (conversation: ConversationHistory) => void;
  /** 空状态自定义内容 */
  emptyContent?: React.ReactNode;
  /** 显示搜索框 */
  showSearch?: boolean;
  /** 最大高度 */
  maxHeight?: string;
}

export function ConversationList({
  type,
  sessionId,
  activeConversationId,
  onSelect,
  emptyContent,
  showSearch = true,
  maxHeight = '400px',
}: ConversationListProps) {
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searchResults, setSearchResults] = useState<ConversationHistory[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  
  const {
    conversations,
    isLoading,
    error,
    loadConversations,
    deleteConversation,
    searchConversations,
  } = useConversationHistory({
    type,
    sessionId,
    autoLoad: true,
    limit: 50,
  });

  // 监听 sessionId 变化，清理搜索状态
  useEffect(() => {
    setSearchKeyword('');
    setSearchResults(null);
    setIsSearching(false);
  }, [sessionId]);

  // 搜索对话
  const handleSearch = useCallback(async () => {
    if (!searchKeyword.trim()) {
      setSearchResults(null);
      return;
    }
    
    setIsSearching(true);
    try {
      const results = await searchConversations({
        keyword: searchKeyword.trim(),
        type,
        sessionId,
        limit: 20,
      });
      setSearchResults(results);
    } catch (err) {
      console.error('Search failed:', err);
    } finally {
      setIsSearching(false);
    }
  }, [searchKeyword, type, sessionId, searchConversations]);

  // 清除搜索
  const clearSearch = useCallback(() => {
    setSearchKeyword('');
    setSearchResults(null);
  }, []);

  // 选择对话
  const handleSelect = useCallback((conversationId: string) => {
    const list = searchResults || conversations;
    const conversation = list.find(c => c.conversationId === conversationId);
    if (conversation) {
      onSelect(conversation);
    }
  }, [conversations, searchResults, onSelect]);

  // 删除对话
  const handleDelete = useCallback(async (conversationId: string) => {
    try {
      await deleteConversation(conversationId);
      // 如果在搜索结果中，也移除
      if (searchResults) {
        setSearchResults(prev => prev?.filter(c => c.conversationId !== conversationId) || null);
      }
    } catch (err) {
      console.error('Delete failed:', err);
    }
  }, [deleteConversation, searchResults]);

  // 显示的列表
  const displayList = searchResults || conversations;

  return (
    <div className="flex flex-col h-full">
      {/* 搜索框 */}
      {showSearch && (
        <div className="p-3 border-b border-divider-light">
          <div className="relative">
            <input
              type="text"
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="搜索对话..."
              className="w-full pl-9 pr-8 py-2 text-sm border border-divider rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1C1B19] focus:border-transparent"
            />
            <svg 
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted"
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            {searchKeyword && (
              <button
                onClick={clearSearch}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink-secondary"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          {searchResults !== null && (
            <div className="mt-2 flex items-center justify-between text-xs text-ink-muted">
              <span>找到 {searchResults.length} 个结果</span>
              <button onClick={clearSearch} className="text-[#5C5A55] hover:text-[#1C1B19]">
                清除搜索
              </button>
            </div>
          )}
        </div>
      )}

      {/* 列表区域 */}
      <div 
        className="flex-1 overflow-y-auto p-2"
        style={{ maxHeight }}
      >
        {isLoading || isSearching ? (
          <div className="flex items-center justify-center py-8">
            <div className="flex gap-1">
              <div className="w-2 h-2 bg-ink-muted rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <div className="w-2 h-2 bg-ink-muted rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <div className="w-2 h-2 bg-ink-muted rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        ) : error ? (
          <div className="text-center py-8">
            <p className="text-sm text-vermilion mb-2">{error}</p>
            <button
              onClick={() => loadConversations()}
              className="text-sm text-[#5C5A55] hover:text-[#1C1B19]"
            >
              重试
            </button>
          </div>
        ) : displayList.length === 0 ? (
          emptyContent || (
            <div className="text-center py-8">
              <div className="text-3xl mb-2">💬</div>
              <p className="text-sm text-ink-muted">
                {searchResults !== null ? '没有找到匹配的对话' : '暂无对话记录'}
              </p>
            </div>
          )
        ) : (
          <div className="space-y-1">
            {displayList.map((conversation) => (
              <ConversationItem
                key={conversation.conversationId}
                conversation={conversation}
                isActive={conversation.conversationId === activeConversationId}
                onSelect={handleSelect}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>

      {/* 底部统计 */}
      {!isLoading && displayList.length > 0 && (
        <div className="p-2 border-t border-divider-light text-center">
          <span className="text-xs text-ink-muted">
            共 {conversations.length} 个对话
          </span>
        </div>
      )}
    </div>
  );
}
