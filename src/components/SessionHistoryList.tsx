'use client';

/**
 * 会话历史列表组件
 * 展示当前用户的录音/上传历史会话，支持选择进入复习模式
 * 支持重命名和删除功能
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { getAllSessions, deleteSession, updateSessionTopic, ANONYMOUS_USER_ID, type AudioSession } from '@/lib/db';
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

/**
 * 会话去重：
 * - 同一个 sessionId 可能因历史写入出现重复记录
 * - 保留 updatedAt 最新的一条，避免 React key 冲突
 */
function dedupeSessionsBySessionId(list: AudioSession[]): AudioSession[] {
  const map = new Map<string, AudioSession>();
  for (const item of list) {
    const existed = map.get(item.sessionId);
    if (!existed) {
      map.set(item.sessionId, item);
      continue;
    }
    const existedTime = new Date(existed.updatedAt).getTime();
    const nextTime = new Date(item.updatedAt).getTime();
    if (Number.isFinite(nextTime) && nextTime >= existedTime) {
      map.set(item.sessionId, item);
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

/** 格式化时长显示 */
function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return '0:00';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** 确认弹窗组件 */
function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmText = '确定',
  cancelText = '取消',
  onConfirm,
  onCancel,
  variant = 'danger',
}: {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: 'danger' | 'warning';
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-5 animate-scale-in">
        <div className="flex items-center gap-3 mb-3">
          <div className={cn(
            'w-10 h-10 rounded-full flex items-center justify-center',
            variant === 'danger' ? 'bg-red-100' : 'bg-amber-100'
          )}>
            {variant === 'danger' ? (
              <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            ) : (
              <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            )}
          </div>
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        </div>
        <p className="text-sm text-gray-600 mb-5">{message}</p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={cn(
              'flex-1 px-4 py-2.5 text-sm font-medium text-white rounded-xl transition-colors',
              variant === 'danger' 
                ? 'bg-red-600 hover:bg-red-700' 
                : 'bg-amber-600 hover:bg-amber-700'
            )}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 重命名输入框组件 */
function RenameInput({
  isOpen,
  currentName,
  onConfirm,
  onCancel,
}: {
  isOpen: boolean;
  currentName: string;
  onConfirm: (newName: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(currentName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setValue(currentName);
      // 延迟聚焦，等待动画
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, currentName]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim()) {
      onConfirm(value.trim());
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-5 animate-scale-in">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
            <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-gray-900">重命名录音</h3>
        </div>
        
        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-full px-4 py-3 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 mb-4"
            placeholder="输入新名称"
          />
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!value.trim()}
              className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-amber-600 rounded-xl hover:bg-amber-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              确定
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** 会话列表项组件 */
function SessionItem({
  session,
  isActive,
  onSelect,
  onRename,
  onDelete,
}: {
  session: AudioSession;
  isActive: boolean;
  onSelect: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
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
  const isVideoSession = session.sourceType === 'video-link';

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
            <span className="inline-flex rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">
              {isVideoSession ? 'VIDEO' : 'AUDIO'}
            </span>
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
            <span>·</span>
            <span>{isVideoSession ? 'video-link' : 'audio'}</span>
            {session.subject && (
              <>
                <span>·</span>
                <span className="text-gray-500">{session.subject}</span>
              </>
            )}
          </div>
        </div>
        
        {/* 操作按钮 */}
        <div className="flex items-center gap-1">
          {session.status === 'completed' && (
            <span className="px-1.5 py-0.5 text-[10px] font-medium bg-green-100 text-green-700 rounded mr-1">
              已完成
            </span>
          )}
          
          {/* 重命名按钮 */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRename();
            }}
            className={cn(
              'p-1.5 rounded-md transition-all duration-200',
              'opacity-0 group-hover:opacity-100',
              'text-gray-400 hover:text-amber-600 hover:bg-amber-50'
            )}
            title="重命名"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          
          {/* 删除按钮 */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
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
  
  // 弹窗状态
  const [deleteTarget, setDeleteTarget] = useState<AudioSession | null>(null);
  const [renameTarget, setRenameTarget] = useState<AudioSession | null>(null);

  // 加载会话列表（按用户过滤）
  const loadSessions = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const currentUserId = userId || ANONYMOUS_USER_ID;
      const data = await getAllSessions(currentUserId);
      setSessions(dedupeSessionsBySessionId(data));
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
  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteSession(deleteTarget.sessionId);
      setSessions(prev => prev.filter(s => s.sessionId !== deleteTarget.sessionId));
      setDeleteTarget(null);
    } catch (err) {
      console.error('删除会话失败:', err);
      alert('删除失败，请重试');
    }
  }, [deleteTarget]);

  // 重命名会话
  const handleRename = useCallback(async (newName: string) => {
    if (!renameTarget) return;
    try {
      await updateSessionTopic(renameTarget.sessionId, newName);
      setSessions(prev => prev.map(s => 
        s.sessionId === renameTarget.sessionId 
          ? { ...s, topic: newName } 
          : s
      ));
      setRenameTarget(null);
    } catch (err) {
      console.error('重命名会话失败:', err);
      toast.error('重命名失败，请重试');
    }
  }, [renameTarget]);

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
                key={`${session.sessionId}-${session.id ?? session.createdAt}`}
                session={session}
                isActive={session.sessionId === activeSessionId}
                onSelect={() => onSessionSelect(session)}
                onRename={() => setRenameTarget(session)}
                onDelete={() => setDeleteTarget(session)}
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

      {/* 删除确认弹窗 */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        title="删除录音记录"
        message="确定要删除这条录音记录吗？相关的转录、笔记等数据也会被删除，此操作无法撤销。"
        confirmText="删除"
        cancelText="取消"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        variant="danger"
      />

      {/* 重命名弹窗 */}
      <RenameInput
        isOpen={!!renameTarget}
        currentName={renameTarget?.topic || renameTarget?.subject || ''}
        onConfirm={handleRename}
        onCancel={() => setRenameTarget(null)}
      />
    </div>
  );
}
