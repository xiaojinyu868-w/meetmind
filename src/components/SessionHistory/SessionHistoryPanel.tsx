'use client';

/**
 * SessionHistoryPanel - 课程记录主面板（Manus 风格）
 * 
 * 世界级用户体验设计：
 * - 左侧列表 + 右侧预览的分屏布局
 * - 优雅的动画过渡
 * - 精致的视觉层次
 * - 沉浸式交互体验
 */

import { useState, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { useUserSessions } from '@/hooks/useAudioSessions';
import { SessionCard } from './SessionCard';
import type { AudioSession } from '@/lib/db';

export interface SessionHistoryPanelProps {
  /** 是否显示 */
  isOpen: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 选择会话进入复习 */
  onSelectSession: (session: AudioSession) => void;
  /** 新建录音回调 */
  onNewRecording?: () => void;
  /** 当前会话 ID */
  currentSessionId?: string;
}

/** 格式化时长 */
function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}秒`;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** 格式化日期 */
function formatDate(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }
  if (diffDays === 1) return '昨天';
  if (diffDays < 7) return `${diffDays}天前`;
  
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

/** 获取分组标签 */
function getGroupLabel(date: Date): string {
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

export function SessionHistoryPanel({
  isOpen,
  onClose,
  onSelectSession,
  onNewRecording,
  currentSessionId,
}: SessionHistoryPanelProps) {
  const { sessions, isLoading, deleteSession, userId } = useUserSessions();
  const [searchKeyword, setSearchKeyword] = useState('');
  const [selectedSession, setSelectedSession] = useState<AudioSession | null>(null);
  const [isSearchFocused, setIsSearchFocused] = useState(false);

  // 过滤会话
  const filteredSessions = searchKeyword.trim()
    ? sessions.filter(s => 
        s.topic?.toLowerCase().includes(searchKeyword.toLowerCase()) ||
        s.subject?.toLowerCase().includes(searchKeyword.toLowerCase())
      )
    : sessions;

  // 分组会话
  const groupedSessions = (() => {
    const groups: { label: string; sessions: AudioSession[] }[] = [];
    const groupMap = new Map<string, AudioSession[]>();
    
    filteredSessions.forEach(session => {
      const date = session.createdAt instanceof Date ? session.createdAt : new Date(session.createdAt);
      const label = getGroupLabel(date);
      if (!groupMap.has(label)) groupMap.set(label, []);
      groupMap.get(label)!.push(session);
    });
    
    const order = ['今天', '昨天', '本周', '本月'];
    Array.from(groupMap.keys())
      .sort((a, b) => {
        const aIdx = order.indexOf(a);
        const bIdx = order.indexOf(b);
        if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
        if (aIdx !== -1) return -1;
        if (bIdx !== -1) return 1;
        return 0;
      })
      .forEach(label => groups.push({ label, sessions: groupMap.get(label)! }));
    
    return groups;
  })();

  // 默认选中第一个
  useEffect(() => {
    if (isOpen && filteredSessions.length > 0 && !selectedSession) {
      setSelectedSession(filteredSessions[0]);
    }
  }, [isOpen, filteredSessions, selectedSession]);

  // 重置状态
  useEffect(() => {
    if (!isOpen) {
      setSelectedSession(null);
      setSearchKeyword('');
    }
  }, [isOpen]);

  const handleSelectSession = useCallback((sessionId: string) => {
    const session = sessions.find(s => s.sessionId === sessionId);
    if (session) {
      setSelectedSession(session);
    }
  }, [sessions]);

  const handleEnterReview = useCallback(() => {
    if (selectedSession) {
      onSelectSession(selectedSession);
      onClose();
    }
  }, [selectedSession, onSelectSession, onClose]);

  const handleDelete = useCallback(async (sessionId: string) => {
    await deleteSession(sessionId);
    if (selectedSession?.sessionId === sessionId) {
      setSelectedSession(filteredSessions.find(s => s.sessionId !== sessionId) || null);
    }
  }, [deleteSession, selectedSession, filteredSessions]);

  // 计算统计数据
  const totalDuration = sessions.reduce((sum, s) => sum + (s.duration || 0), 0);
  const totalMinutes = Math.floor(totalDuration / (1000 * 60));

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* 背景遮罩 */}
      <div 
        className="absolute inset-0 bg-black/20 backdrop-blur-sm animate-fadeIn"
        onClick={onClose}
      />
      
      {/* 主面板 */}
      <div className="relative ml-auto w-full max-w-4xl h-full bg-white shadow-2xl flex animate-slideInRight">
        {/* 左侧列表 */}
        <div className="w-80 h-full flex flex-col border-r border-gray-100">
          {/* 头部 */}
          <div className="flex-shrink-0 p-4 border-b border-gray-100">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-gray-900">课程记录</h2>
              <button
                onClick={onClose}
                className="p-2 -mr-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            {/* 搜索框 */}
            <div className={cn(
              'relative rounded-lg transition-all duration-200',
              isSearchFocused ? 'ring-2 ring-gray-900' : ''
            )}>
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="搜索..."
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                onFocus={() => setIsSearchFocused(true)}
                onBlur={() => setIsSearchFocused(false)}
                className="w-full pl-10 pr-4 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:bg-white"
              />
            </div>
          </div>

          {/* 列表 */}
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="p-4 space-y-2">
                {[1, 2, 3, 4, 5].map(i => (
                  <div key={i} className="flex items-center gap-3 p-3 animate-pulse">
                    <div className="w-2 h-2 rounded-full bg-gray-200" />
                    <div className="flex-1">
                      <div className="h-4 bg-gray-200 rounded w-3/4 mb-1" />
                      <div className="h-3 bg-gray-100 rounded w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : filteredSessions.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full p-8">
                <div className="w-16 h-16 mb-4 rounded-2xl bg-amber-50 flex items-center justify-center">
                  <svg className="w-8 h-8 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-gray-700 mb-1">
                  {searchKeyword ? '没有找到课程' : '还没有课程记录'}
                </p>
                <p className="text-xs text-gray-400 text-center">
                  {searchKeyword ? '尝试其他关键词' : '开始录制你的第一堂课吧'}
                </p>
              </div>
            ) : (
              <div className="py-2">
                {groupedSessions.map((group, gIdx) => (
                  <div key={group.label} className="mb-4">
                    <div className="px-4 py-1.5">
                      <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">
                        {group.label}
                      </span>
                    </div>
                    <div className="px-2">
                      {group.sessions.map((session, sIdx) => (
                        <SessionCard
                          key={session.sessionId}
                          session={session}
                          isActive={selectedSession?.sessionId === session.sessionId}
                          onSelect={handleSelectSession}
                          onDelete={handleDelete}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 底部统计 */}
          {sessions.length > 0 && (
            <div className="flex-shrink-0 px-4 py-3 border-t border-gray-100 bg-gray-50/50">
              <div className="flex items-center justify-between text-xs text-gray-400">
                <span>{sessions.length} 个课程</span>
                <span>{totalMinutes} 分钟</span>
              </div>
            </div>
          )}
        </div>

        {/* 右侧预览 */}
        <div className="flex-1 h-full flex flex-col bg-gray-50">
          {selectedSession ? (
            <>
              {/* 预览头部 */}
              <div className="flex-shrink-0 p-6 bg-white border-b border-gray-100">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-xl font-semibold text-gray-900 mb-2">
                      {selectedSession.topic || selectedSession.subject || '未命名课程'}
                    </h3>
                    <div className="flex items-center gap-3 text-sm text-gray-500">
                      <span className="flex items-center gap-1.5">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {formatDuration(selectedSession.duration)}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        {formatDate(
                          selectedSession.createdAt instanceof Date 
                            ? selectedSession.createdAt 
                            : new Date(selectedSession.createdAt)
                        )}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={handleEnterReview}
                    className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 transition-colors shadow-sm"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    进入复习
                  </button>
                </div>
              </div>

              {/* 预览内容 */}
              <div className="flex-1 overflow-y-auto p-6">
                {/* 课程信息卡片 */}
                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div className="p-4 bg-white rounded-xl border border-gray-100">
                    <div className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">学科</div>
                    <div className="text-sm font-medium text-gray-900">
                      {selectedSession.subject || '未设置'}
                    </div>
                  </div>
                  <div className="p-4 bg-white rounded-xl border border-gray-100">
                    <div className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">状态</div>
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        'w-2 h-2 rounded-full',
                        selectedSession.status === 'completed' ? 'bg-emerald-500' : 'bg-gray-400'
                      )} />
                      <span className="text-sm font-medium text-gray-900">
                        {selectedSession.status === 'completed' ? '已完成' : 
                         selectedSession.status === 'recording' ? '录制中' : '未知'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 快捷操作 */}
                <div className="mb-6">
                  <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">快捷操作</h4>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={handleEnterReview}
                      className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-gray-300 transition-all"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                      查看笔记
                    </button>
                    <button className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-gray-300 transition-all">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      查看转录
                    </button>
                    <button className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-gray-300 transition-all">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                      </svg>
                      分享
                    </button>
                  </div>
                </div>

                {/* 音频波形预览占位 */}
                <div className="p-6 bg-white rounded-xl border border-gray-100">
                  <div className="flex items-center justify-center h-24 bg-gradient-to-r from-amber-50 to-orange-50 rounded-lg">
                    <div className="flex items-center gap-1">
                      {[...Array(40)].map((_, i) => (
                        <div
                          key={i}
                          className="w-1 bg-amber-300 rounded-full"
                          style={{ 
                            height: `${Math.random() * 40 + 10}px`,
                            opacity: 0.5 + Math.random() * 0.5
                          }}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-3 text-xs text-gray-400">
                    <span>00:00</span>
                    <span>{formatDuration(selectedSession.duration)}</span>
                  </div>
                </div>
              </div>
            </>
          ) : (
            // 未选中状态
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-gray-100 flex items-center justify-center">
                  <svg className="w-10 h-10 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <p className="text-sm text-gray-400">选择一个课程查看详情</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
