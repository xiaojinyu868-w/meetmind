/**
 * AI 精选片段面板组件
 * 
 * 显示从课堂录音中提取的关键片段
 * 支持播放单个片段或连续播放全部
 */

'use client';

import React, { useState, useMemo } from 'react';
import type { HighlightTopic, TopicGenerationMode } from '@/types';

// ============ 类型定义 ============

interface HighlightsPanelProps {
  topics: HighlightTopic[];
  selectedTopic: HighlightTopic | null;
  onTopicSelect: (topic: HighlightTopic) => void;
  onPlayTopic?: (topic: HighlightTopic) => void;
  onSeek: (timeMs: number) => void;
  onPlayAll?: () => void;
  isPlayingAll?: boolean;
  playAllIndex?: number;
  currentTime: number;  // 当前播放时间（毫秒）
  totalDuration: number;  // 总时长（毫秒）
  isLoading?: boolean;
  onGenerate?: (mode: TopicGenerationMode) => void;
  onRegenerateByTheme?: (theme: string) => void;
}

// ============ 工具函数 ============

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}秒`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes}分${seconds}秒` : `${minutes}分钟`;
}

function getImportanceColor(importance: string): string {
  switch (importance) {
    case 'high':
      return 'bg-red-100 text-red-700 border-red-200';
    case 'medium':
      return 'bg-yellow-100 text-yellow-700 border-yellow-200';
    case 'low':
      return 'bg-green-100 text-green-700 border-green-200';
    default:
      return 'bg-gray-100 text-gray-700 border-gray-200';
  }
}

function getImportanceLabel(importance: string): string {
  switch (importance) {
    case 'high':
      return '重点';
    case 'medium':
      return '要点';
    case 'low':
      return '补充';
    default:
      return '';
  }
}

// ============ 子组件 ============

interface ProgressBarProps {
  topics: HighlightTopic[];
  currentTime: number;
  totalDuration: number;
  onSeek: (timeMs: number) => void;
}

function ProgressBar({ topics, currentTime, totalDuration, onSeek }: ProgressBarProps) {
  const progress = totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0;
  
  return (
    <div className="relative h-8 bg-gray-100 rounded-lg overflow-hidden mb-4">
      {/* 进度条 */}
      <div 
        className="absolute top-0 left-0 h-full bg-blue-200 transition-all duration-200"
        style={{ width: `${progress}%` }}
      />
      
      {/* 片段标记 */}
      {topics.map((topic, index) => {
        const start = topic.segments[0]?.start ?? 0;
        const end = topic.segments[0]?.end ?? start;
        const left = (start / totalDuration) * 100;
        const width = ((end - start) / totalDuration) * 100;
        
        return (
          <div
            key={topic.id}
            className={`absolute top-1 h-6 rounded cursor-pointer transition-opacity hover:opacity-80 ${
              topic.importance === 'high' 
                ? 'bg-red-400' 
                : topic.importance === 'medium' 
                  ? 'bg-yellow-400' 
                  : 'bg-green-400'
            }`}
            style={{ left: `${left}%`, width: `${Math.max(width, 1)}%` }}
            onClick={() => onSeek(start)}
            title={`${index + 1}. ${topic.title}`}
          />
        );
      })}
      
      {/* 当前时间指示器 */}
      <div 
        className="absolute top-0 w-0.5 h-full bg-blue-600"
        style={{ left: `${progress}%` }}
      />
    </div>
  );
}

interface TopicCardProps {
  topic: HighlightTopic;
  index: number;
  isSelected: boolean;
  isPlaying: boolean;
  onSelect: () => void;
  onPlay: () => void;
}

function TopicCard({ topic, index, isSelected, isPlaying, onSelect, onPlay }: TopicCardProps) {
  const startTime = topic.segments[0]?.start ?? 0;
  
  return (
    <div
      className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
        isSelected 
          ? 'border-blue-500 bg-blue-50' 
          : 'border-gray-200 hover:border-gray-300 bg-white'
      } ${isPlaying ? 'ring-2 ring-blue-400 ring-offset-2' : ''}`}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {/* 标题行 */}
          <div className="flex items-center gap-2 mb-2">
            <span className="flex-shrink-0 w-6 h-6 flex items-center justify-center bg-gray-200 text-gray-600 text-sm font-medium rounded-full">
              {index + 1}
            </span>
            <h3 className="font-medium text-gray-900 truncate">{topic.title}</h3>
            <span className={`flex-shrink-0 px-2 py-0.5 text-xs font-medium rounded border ${getImportanceColor(topic.importance)}`}>
              {getImportanceLabel(topic.importance)}
            </span>
          </div>
          
          {/* 时间信息 */}
          <div className="flex items-center gap-3 text-sm text-gray-500">
            <span className="flex items-center gap-1">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {formatTime(startTime)}
            </span>
            <span className="text-gray-300">|</span>
            <span>{formatDuration(topic.duration)}</span>
          </div>
          
          {/* 引用预览 */}
          {topic.quote && (
            <p className="mt-2 text-sm text-gray-600 line-clamp-2">
              "{topic.quote.text.slice(0, 100)}..."
            </p>
          )}
        </div>
        
        {/* 播放按钮 */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPlay();
          }}
          className="flex-shrink-0 w-10 h-10 flex items-center justify-center bg-blue-500 hover:bg-blue-600 text-white rounded-full transition-colors"
          title="播放此片段"
        >
          {isPlaying ? (
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}

// ============ 主组件 ============

export function HighlightsPanel({
  topics,
  selectedTopic,
  onTopicSelect,
  onPlayTopic,
  onSeek,
  onPlayAll,
  isPlayingAll = false,
  playAllIndex,
  currentTime,
  totalDuration,
  isLoading = false,
  onGenerate,
  onRegenerateByTheme
}: HighlightsPanelProps) {
  const [generationMode, setGenerationMode] = useState<TopicGenerationMode>('smart');
  const [themeInput, setThemeInput] = useState('');
  const [showThemeInput, setShowThemeInput] = useState(false);
  
  // 按时间排序的主题
  const sortedTopics = useMemo(() => {
    return [...topics].sort((a, b) => {
      const aStart = a.segments[0]?.start ?? 0;
      const bStart = b.segments[0]?.start ?? 0;
      return aStart - bStart;
    });
  }, [topics]);
  
  // 空状态
  if (!isLoading && topics.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
        <div className="w-16 h-16 mb-4 bg-gray-100 rounded-full flex items-center justify-center">
          <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-gray-900 mb-2">暂无精选片段</h3>
        <p className="text-gray-500 mb-6 max-w-sm">
          AI 将自动从课堂录音中提取关键知识点，帮助你快速复习
        </p>
        
        {onGenerate && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setGenerationMode('smart')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  generationMode === 'smart'
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                智能模式
              </button>
              <button
                onClick={() => setGenerationMode('fast')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  generationMode === 'fast'
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                快速模式
              </button>
            </div>
            <button
              onClick={() => onGenerate(generationMode)}
              className="w-full px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-lg transition-colors"
            >
              生成精选片段
            </button>
          </div>
        )}
      </div>
    );
  }
  
  // 加载状态
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4">
        <div className="w-12 h-12 mb-4 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-600">正在分析课堂内容...</p>
        <p className="text-sm text-gray-400 mt-1">AI 正在提取关键知识点</p>
      </div>
    );
  }
  
  return (
    <div className="flex flex-col h-full">
      {/* 进度条 */}
      <div className="px-4 pt-4">
        <ProgressBar
          topics={sortedTopics}
          currentTime={currentTime}
          totalDuration={totalDuration}
          onSeek={onSeek}
        />
      </div>
      
      {/* 工具栏 */}
      <div className="flex items-center justify-between px-4 py-2 border-b">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">
            共 {topics.length} 个片段
          </span>
        </div>
        
        <div className="flex items-center gap-2">
          {/* 按主题筛选 */}
          {onRegenerateByTheme && (
            <>
              {showThemeInput ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={themeInput}
                    onChange={(e) => setThemeInput(e.target.value)}
                    placeholder="输入主题关键词"
                    className="w-32 px-3 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && themeInput.trim()) {
                        onRegenerateByTheme(themeInput.trim());
                        setShowThemeInput(false);
                        setThemeInput('');
                      }
                    }}
                  />
                  <button
                    onClick={() => {
                      if (themeInput.trim()) {
                        onRegenerateByTheme(themeInput.trim());
                        setShowThemeInput(false);
                        setThemeInput('');
                      }
                    }}
                    className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                  >
                    筛选
                  </button>
                  <button
                    onClick={() => {
                      setShowThemeInput(false);
                      setThemeInput('');
                    }}
                    className="px-2 py-1.5 text-sm text-gray-500 hover:text-gray-700"
                  >
                    取消
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowThemeInput(true)}
                  className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  按主题筛选
                </button>
              )}
            </>
          )}
          
          {/* 播放全部 */}
          {onPlayAll && topics.length > 0 && (
            <button
              onClick={onPlayAll}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                isPlayingAll
                  ? 'bg-red-500 hover:bg-red-600 text-white'
                  : 'bg-blue-500 hover:bg-blue-600 text-white'
              }`}
            >
              {isPlayingAll ? (
                <>
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                  </svg>
                  停止
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                  播放全部
                </>
              )}
            </button>
          )}
        </div>
      </div>
      
      {/* 片段列表 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {sortedTopics.map((topic, index) => (
          <TopicCard
            key={topic.id}
            topic={topic}
            index={index}
            isSelected={selectedTopic?.id === topic.id}
            isPlaying={isPlayingAll && playAllIndex === index}
            onSelect={() => onTopicSelect(topic)}
            onPlay={() => onPlayTopic?.(topic)}
          />
        ))}
      </div>
    </div>
  );
}

export default HighlightsPanel;
