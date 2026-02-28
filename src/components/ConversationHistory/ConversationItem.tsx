'use client';

/**
 * 对话历史列表项组件
 */

import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import type { ConversationHistory } from '@/types/conversation';

interface ConversationItemProps {
  conversation: ConversationHistory;
  isActive?: boolean;
  onSelect: (conversationId: string) => void;
  onDelete?: (conversationId: string) => void;
}

export function ConversationItem({
  conversation,
  isActive = false,
  onSelect,
  onDelete,
}: ConversationItemProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowDeleteConfirm(true);
  };

  const handleDeleteConfirm = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowDeleteConfirm(false);
    onDelete?.(conversation.conversationId);
  };

  const handleDeleteCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowDeleteConfirm(false);
  };

  const timeAgo = formatDistanceToNow(new Date(conversation.updatedAt), {
    addSuffix: true,
    locale: zhCN,
  });

  return (
    <div
      onClick={() => onSelect(conversation.conversationId)}
      className={`
        group p-3 rounded-lg cursor-pointer transition-all duration-200
        ${isActive 
          ? 'bg-amber-50 border border-amber-200 shadow-sm' 
          : 'hover:bg-gray-50 border border-transparent'
        }
      `}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          {/* 标题 */}
          <div className="flex items-center gap-2">
            <span className="text-sm">
              {conversation.type === 'tutor' ? '🎯' : '💬'}
            </span>
            <h4 className={`
              text-sm font-medium truncate
              ${isActive ? 'text-amber-900' : 'text-gray-900'}
            `}>
              {conversation.title}
            </h4>
          </div>
          
          {/* 最后消息预览 */}
          {conversation.lastMessage && (
            <p className="mt-1 text-xs text-gray-500 truncate">
              {conversation.lastMessage}
            </p>
          )}
          
          {/* 元信息 */}
          <div className="mt-1.5 flex items-center gap-2 text-xs text-gray-400">
            <span>{timeAgo}</span>
            <span>·</span>
            <span>{conversation.messageCount} 条消息</span>
            {conversation.model && (
              <>
                <span>·</span>
                <span className="text-gray-300">{conversation.model}</span>
              </>
            )}
          </div>
        </div>
        
        {/* 删除按钮 / 确认 */}
        {onDelete && !showDeleteConfirm && (
          <button
            onClick={handleDeleteClick}
            className={`
              p-1.5 rounded-md transition-all duration-200
              opacity-0 group-hover:opacity-100
              text-gray-400 hover:text-red-500 hover:bg-red-50
            `}
            title="删除对话"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        )}
        {showDeleteConfirm && (
          <div className="flex items-center gap-1 animate-in fade-in duration-150" onClick={e => e.stopPropagation()}>
            <button
              onClick={handleDeleteConfirm}
              className="px-2 py-1 text-xs font-medium text-white bg-red-500 rounded-md hover:bg-red-600 transition-colors"
            >
              删除
            </button>
            <button
              onClick={handleDeleteCancel}
              className="px-2 py-1 text-xs font-medium text-gray-500 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
            >
              取消
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
