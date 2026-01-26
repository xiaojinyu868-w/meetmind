'use client';

/**
 * 会话历史列表组件
 * 展示当前用户的录音/上传历史会话，支持选择进入复习模式
 */

import { useState, useEffect, useCallback } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { getAllSessions, deleteSession, ANONYMOUS_USER_ID, type AudioSession } from '@/lib/db';
import { cn } from '@/lib/utils';

interface SessionHistoryListProps {
  /** 当前用户ID（未登录时为 undefined） */
  userId?: string;
  /** 选择会话回调 */
  onSessionSelect: (session: AudioSession) => void;
  /** 关闭面板回调 */
  onClose?: () => void;
  /** 当前选中的会话ID */
  activeSessionId?: string;
  /** 最大高度 */
  maxHeight?: string;
  /** 是否显示头部 */
  showHeader?: boolean;
  /** 自定义类名 */
  className?: string;
}

/** 格式化时长显示 */
function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return '0:00';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** 会话列表项组件 */
function SessionItem({
  session,
  isActive,
  onSelect,
  onDelete,
}: {
  session: AudioSession;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm('确定要删除这条录音记录吗？相关的转录、笔记等数据也会被删除。')) {
      onDelete();
    }
  };

  const timeAgo = formatDistanceToNow(new Date(session.createdAt), {
    addSuffix: true,
    locale: zhCN,
  });

  // 生成标题：优先使用 topic，否则使用日期
  const title = session.topic || session.subject || 
    new Date(session.createdAt).toLocaleDateString('zh-CN', {
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  return (
    <div
      onClick={onSelect}
      className={cn(
        'group p-3 rounded-lg cursor-pointer transition-all duration-200',
        isActive 
          ? 'bg-amber-50 border border-amber-200 shadow-sm' 
          : 'hover:bg-gray-50 border border-transparent'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          {/* 标题 */}
          <div className="flex items-center gap-2">
            <span className="text-sm">🎙️</span>
            <h4 className={cn(
              'text-sm font-medium truncate',
              isActive ? 'text-amber-900' : 'text-gray-900'
            )}>
              {title}
            </h4>
          </div>
          
          {/* 元信息 */}
          <div className="mt-1.5 flex items-center gap-2 text-xs text-gray-400">
            <span>{timeAgo}</span>
            <span>·</span>
            <span>{formatDuration(session.duration)}</span>
            {session.subject && (
              <>
                <span>·</span>
                <span className="text-gray-500">{session.subject}</span>
              </>
            )}
          </div>
        </div>
        
        {/* 状态标签 */}
        <div className="flex items-center gap-2">
          {session.status === 'completed' && (
            <span className="px-1.5 py-0.5 text-[10px] font-medium bg-green-100 text-green-700 rounded">
              已完成
            </span>
          )}
          
          {/* 删除按钮 */}
          <button
            onClick={handleDelete}
            className={cn(
              'p-1.5 rounded-md transition-all duration-200',
              'opacity-0 group-hover:opacity-100',
              'text-gray-400 hover:text-red-500 hover:bg-red-50'
            )}
            title="删除记录"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

export function SessionHistoryList({
  userId,
  onSessionSelect,
  onClose,
  activeSessionId,
  maxHeight = '400px',
  showHeader = true,
  className,
}: SessionHistoryListProps) {
  const [sessions, setSessions] = useState<AudioSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 加载会话列表（按用户过滤）
  const loadSessions = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const currentUserId = userId || ANONYMOUS_USER_ID;
      const data = await getAllSessions(currentUserId);
      setSessions(data);
    } catch (err) {
      console.error('加载会话历史失败:', err);
      setError('加载失败，请重试');
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // 删除会话
  const handleDelete = useCallback(async (sessionId: string) => {
    try {
      await deleteSession(sessionId);
      setSessions(prev => prev.filter(s => s.sessionId !== sessionId));
    } catch (err) {
      console.error('删除会话失败:', err);
      alert('删除失败，请重试');
    }
  }, []);

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* 头部 - 可选显示 */}
      {showHeader && (
        <div className="p-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">录音历史</h3>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* 列表区域 */}
      <div 
        className="flex-1 overflow-y-auto p-2"
        style={{ maxHeight }}
      >
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="flex gap-1">
              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        ) : error ? (
          <div className="text-center py-8">
            <p className="text-sm text-red-600 mb-2">{error}</p>
            <button
              onClick={loadSessions}
              className="text-sm text-amber-600 hover:text-amber-700"
            >
              重试
            </button>
          </div>
        ) : sessions.length === 0 ? (
          <div className="text-center py-8">
            <div className="text-3xl mb-2">🎙️</div>
            <p className="text-sm text-gray-500">暂无录音记录</p>
            <p className="text-xs text-gray-400 mt-1">录音或上传音频后会自动保存</p>
          </div>
        ) : (
          <div className="space-y-1">
            {sessions.map((session) => (
              <SessionItem
                key={session.sessionId}
                session={session}
                isActive={session.sessionId === activeSessionId}
                onSelect={() => onSessionSelect(session)}
                onDelete={() => handleDelete(session.sessionId)}
              />
            ))}
          </div>
        )}
      </div>

      {/* 底部统计 */}
      {!isLoading && sessions.length > 0 && (
        <div className="p-2 border-t border-gray-100 text-center">
          <span className="text-xs text-gray-400">
            共 {sessions.length} 条录音记录
          </span>
        </div>
      )}
    </div>
  );
}
