'use client';

/**
 * SessionList - 课程记录列表组件（Manus 风格）
 * 
 * 参考 Manus 设计：
 * - 极简的侧边栏列表
 * - 优雅的分组和时间线
 * - 流畅的动画效果
 * - 精致的空状态
 */

import { useState, useMemo, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { useUserSessions } from '@/hooks/useAudioSessions';
import { SessionCard } from './SessionCard';
import type { AudioSession } from '@/lib/db';

export interface SessionListProps {
  /** 当前激活的会话ID */
  activeSessionId?: string;
  /** 选择会话回调 */
  onSelect: (session: AudioSession) => void;
  /** 返回按钮回调 */
  onBack?: () => void;
  /** 新建会话回调 */
  onNewSession?: () => void;
  /** 自定义空状态内容 */
  emptyContent?: React.ReactNode;
  /** 是否显示搜索框 */
  showSearch?: boolean;
  /** 最大高度 */
  maxHeight?: string;
  /** 自定义类名 */
  className?: string;
}

/** 获取日期分组标签 */
function getDateGroup(date: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor((today.getTime() - target.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return '今天';
  if (diffDays === 1) return '昨天';
  if (diffDays < 7) return '本周';
  if (diffDays < 30) return '本月';
  
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' });
}

export function SessionList({
  activeSessionId,
  onSelect,
  onBack,
  onNewSession,
  emptyContent,
  showSearch = true,
  maxHeight,
  className,
}: SessionListProps) {
  const { sessions, isLoading, deleteSession, userId } = useUserSessions();
  const [searchKeyword, setSearchKeyword] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);

  // 搜索过滤
  const filteredSessions = useMemo(() => {
    if (!searchKeyword.trim()) return sessions;
    
    const keyword = searchKeyword.toLowerCase();
    return sessions.filter(s => 
      (s.topic?.toLowerCase().includes(keyword)) ||
      (s.subject?.toLowerCase().includes(keyword))
    );
  }, [sessions, searchKeyword]);

  // 按日期分组
  const groupedSessions = useMemo(() => {
    const groups: { label: string; sessions: AudioSession[] }[] = [];
    const groupMap = new Map<string, AudioSession[]>();
    
    filteredSessions.forEach(session => {
      const date = session.createdAt instanceof Date 
        ? session.createdAt 
        : new Date(session.createdAt);
      const label = getDateGroup(date);
      
      if (!groupMap.has(label)) {
        groupMap.set(label, []);
      }
      groupMap.get(label)!.push(session);
    });
    
    const order = ['今天', '昨天', '本周', '本月'];
    const sortedLabels = Array.from(groupMap.keys()).sort((a, b) => {
      const aIndex = order.indexOf(a);
      const bIndex = order.indexOf(b);
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
      return 0;
    });
    
    sortedLabels.forEach(label => {
      groups.push({ label, sessions: groupMap.get(label)! });
    });
    
    return groups;
  }, [filteredSessions]);

  const handleSelect = useCallback((sessionId: string) => {
    const session = sessions.find(s => s.sessionId === sessionId);
    if (session) {
      onSelect(session);
    }
  }, [sessions, onSelect]);

  const handleDelete = useCallback(async (sessionId: string) => {
    await deleteSession(sessionId);
  }, [deleteSession]);

  // 格式化总时长
  const totalDuration = useMemo(() => {
    const totalMs = sessions.reduce((sum, s) => sum + (s.duration || 0), 0);
    const totalMinutes = Math.floor(totalMs / (1000 * 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    
    if (hours === 0) return `${minutes}分钟`;
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}小时`;
  }, [sessions]);

  return (
    <div className={cn('flex flex-col h-full bg-white', className)}>
      {/* 顶部区域 */}
      <div className="flex-shrink-0 px-4 pt-4 pb-2">
        {/* 标题行 */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            {onBack && (
              <button
                onClick={onBack}
                className="p-1 -ml-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            <h2 className="text-lg font-semibold text-gray-900">课程记录</h2>
          </div>
          
          {/* 新建按钮 */}
          {onNewSession && (
            <button
              onClick={onNewSession}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-all"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              <span>新建</span>
            </button>
          )}
        </div>

        {/* 搜索框 */}
        {showSearch && sessions.length > 0 && (
          <div className={cn(
            'relative transition-all duration-200',
            isSearchFocused ? 'ring-2 ring-gray-900 ring-offset-1' : ''
          )}>
            <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
              <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <input
              type="text"
              placeholder="搜索课程..."
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              onFocus={() => setIsSearchFocused(true)}
              onBlur={() => setIsSearchFocused(false)}
              className="w-full pl-9 pr-8 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:bg-white transition-all"
            />
            {searchKeyword && (
              <button
                onClick={() => setSearchKeyword('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 rounded"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        )}
      </div>

      {/* 列表区域 */}
      <div 
        className="flex-1 overflow-y-auto px-2 pb-4"
        style={{ maxHeight }}
      >
        {isLoading ? (
          // 骨架屏加载
          <div className="space-y-1 px-2 pt-2">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="flex items-center gap-3 px-3 py-2.5 animate-pulse">
                <div className="w-2 h-2 rounded-full bg-gray-200" />
                <div className="flex-1">
                  <div className="h-4 bg-gray-200 rounded w-3/4 mb-1.5" />
                  <div className="h-3 bg-gray-100 rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : !userId ? (
          // 未登录状态
          <div className="flex flex-col items-center justify-center h-full py-12">
            <div className="w-16 h-16 mb-4 rounded-2xl bg-gray-100 flex items-center justify-center">
              <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <p className="text-sm font-medium text-gray-700 mb-1">请先登录</p>
            <p className="text-xs text-gray-400">登录后查看你的课程记录</p>
          </div>
        ) : filteredSessions.length === 0 ? (
          // 空状态
          emptyContent || (
            <div className="flex flex-col items-center justify-center h-full py-12">
              <div className="w-20 h-20 mb-5 rounded-2xl bg-gradient-to-br from-amber-50 to-orange-50 flex items-center justify-center">
                <svg className="w-10 h-10 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              </div>
              <p className="text-base font-medium text-gray-800 mb-1">
                {searchKeyword ? '没有找到课程' : '还没有课程记录'}
              </p>
              <p className="text-sm text-gray-400 mb-6">
                {searchKeyword ? '尝试其他关键词' : '开始录制你的第一堂课'}
              </p>
              {!searchKeyword && onNewSession && (
                <button
                  onClick={onNewSession}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  开始录音
                </button>
              )}
            </div>
          )
        ) : (
          // 分组列表
          <div className="space-y-4 pt-2">
            {groupedSessions.map((group, groupIndex) => (
              <div key={group.label} className="animate-fadeIn" style={{ animationDelay: `${groupIndex * 50}ms` }}>
                {/* 分组标题 */}
                <div className="flex items-center gap-2 px-3 mb-1">
                  <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                    {group.label}
                  </span>
                  <span className="text-xs text-gray-300">
                    {group.sessions.length}
                  </span>
                </div>
                
                {/* 会话列表 */}
                <div className="space-y-0.5">
                  {group.sessions.map((session, index) => (
                    <div 
                      key={session.sessionId}
                      className="animate-slideInLeft"
                      style={{ animationDelay: `${(groupIndex * 50) + (index * 30)}ms` }}
                    >
                      <SessionCard
                        session={session}
                        isActive={session.sessionId === activeSessionId}
                        onSelect={handleSelect}
                        onDelete={handleDelete}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 底部统计 */}
      {sessions.length > 0 && !isLoading && (
        <div className="flex-shrink-0 px-4 py-3 border-t border-gray-100">
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>{sessions.length} 个课程</span>
            <span>总计 {totalDuration}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/** 格式化总时长 */
function formatTotalDuration(sessions: AudioSession[]): string {
  const totalMs = sessions.reduce((sum, s) => sum + (s.duration || 0), 0);
  const totalMinutes = Math.floor(totalMs / (1000 * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  
  if (hours === 0) return `${minutes}分钟`;
  return minutes > 0 ? `${hours}小时${minutes}分钟` : `${hours}小时`;
}
