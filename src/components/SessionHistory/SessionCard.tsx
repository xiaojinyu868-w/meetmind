'use client';

/**
 * SessionCard - 会话卡片组件（Manus 风格）
 * 
 * 极简设计，突出内容：
 * - 简洁的列表项样式
 * - 优雅的 hover 效果
 * - 流畅的过渡动画
 */

import { useState, useRef } from 'react';
import { cn } from '@/lib/utils';
import type { AudioSession } from '@/lib/db';

export interface SessionCardProps {
  session: AudioSession;
  isActive?: boolean;
  isHovered?: boolean;
  onSelect: (sessionId: string) => void;
  onDelete: (sessionId: string) => void;
  compact?: boolean;
}

/** 格式化时长 */
function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  
  if (minutes === 0) return `${seconds}秒`;
  return seconds > 0 ? `${minutes}:${seconds.toString().padStart(2, '0')}` : `${minutes}分钟`;
}

/** 格式化相对时间 */
function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) {
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours === 0) {
      const diffMinutes = Math.floor(diffMs / (1000 * 60));
      return diffMinutes <= 1 ? '刚刚' : `${diffMinutes}分钟前`;
    }
    return `${diffHours}小时前`;
  }
  
  if (diffDays === 1) return '昨天';
  if (diffDays < 7) return `${diffDays}天前`;
  
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

export function SessionCard({
  session,
  isActive = false,
  isHovered = false,
  onSelect,
  onDelete,
  compact = false,
}: SessionCardProps) {
  const [showActions, setShowActions] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsDeleting(true);
    try {
      await onDelete(session.sessionId);
    } finally {
      setIsDeleting(false);
      setShowActions(false);
    }
  };

  const createdAt = session.createdAt instanceof Date 
    ? session.createdAt 
    : new Date(session.createdAt);

  const title = session.topic || session.subject || '未命名课程';

  // 获取状态图标颜色
  const getStatusColor = () => {
    if (session.status === 'completed') return 'bg-emerald-500';
    if (session.status === 'recording') return 'bg-red-500 animate-pulse';
    return 'bg-gray-400';
  };

  return (
    <div
      className={cn(
        'group relative flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all duration-200',
        isActive 
          ? 'bg-gray-900 text-white' 
          : 'hover:bg-gray-50 text-gray-700',
        compact ? 'py-2' : 'py-2.5'
      )}
      onClick={() => onSelect(session.sessionId)}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {/* 状态指示器 */}
      <div className={cn(
        'flex-shrink-0 w-2 h-2 rounded-full transition-colors',
        isActive ? 'bg-white' : getStatusColor()
      )} />

      {/* 内容区 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={cn(
            'text-sm font-medium truncate',
            isActive ? 'text-white' : 'text-gray-800'
          )}>
            {title}
          </span>
        </div>
        <div className={cn(
          'flex items-center gap-1.5 mt-0.5 text-xs',
          isActive ? 'text-gray-300' : 'text-gray-400'
        )}>
          <span>{formatRelativeTime(createdAt)}</span>
          <span className="opacity-50">·</span>
          <span>{formatDuration(session.duration)}</span>
        </div>
      </div>

      {/* 操作按钮 - 悬停显示 */}
      <div className={cn(
        'flex-shrink-0 flex items-center gap-0.5 transition-opacity duration-150',
        showActions && !isActive ? 'opacity-100' : 'opacity-0'
      )}>
        <button
          onClick={handleDelete}
          disabled={isDeleting}
          className={cn(
            'p-1.5 rounded-md transition-colors',
            'text-gray-400 hover:text-red-500 hover:bg-red-50',
            isDeleting && 'opacity-50 cursor-not-allowed'
          )}
          title="删除"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>

      {/* 激活状态的箭头指示器 */}
      {isActive && (
        <svg className="w-4 h-4 text-white/60 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      )}
    </div>
  );
}
