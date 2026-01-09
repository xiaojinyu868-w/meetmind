/**
 * 课堂摘要面板组件
 * 
 * 显示课堂结构化摘要
 * 包含：概要、主要知识点、重点难点、课堂结构
 */

'use client';

import React, { useState } from 'react';
import type { ClassSummary, SummaryTakeaway } from '@/types';

// ============ 类型定义 ============

interface SummaryPanelProps {
  summary: ClassSummary | null;
  isLoading?: boolean;
  onGenerate?: () => void;
  onSeek?: (timeMs: number) => void;
  onAddNote?: (text: string, takeaway: SummaryTakeaway) => void;
}

// ============ 工具函数 ============

function parseTimestamp(timestamp: string): number | null {
  const match = timestamp.match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return (parseInt(match[1]) * 60 + parseInt(match[2])) * 1000;
}

// ============ 子组件 ============

interface TakeawayCardProps {
  takeaway: SummaryTakeaway;
  index: number;
  onSeek?: (timeMs: number) => void;
  onAddNote?: () => void;
}

function TakeawayCard({ takeaway, index, onSeek, onAddNote }: TakeawayCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div 
        className="p-4 cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-start gap-3">
          <span className="flex-shrink-0 w-6 h-6 flex items-center justify-center bg-blue-100 text-blue-600 text-sm font-medium rounded-full">
            {index + 1}
          </span>
          <div className="flex-1 min-w-0">
            <h4 className="font-medium text-gray-900">{takeaway.label}</h4>
            <p className={`mt-1 text-sm text-gray-600 ${isExpanded ? '' : 'line-clamp-2'}`}>
              {takeaway.insight}
            </p>
          </div>
          <svg 
            className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>
      
      {isExpanded && (
        <div className="px-4 pb-4 pt-0 border-t border-gray-100">
          <div className="flex items-center justify-between mt-3">
            {/* 时间戳 */}
            <div className="flex items-center gap-2">
              {takeaway.timestamps.map((ts, i) => {
                const timeMs = parseTimestamp(ts);
                return (
                  <button
                    key={i}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (timeMs !== null && onSeek) {
                        onSeek(timeMs);
                      }
                    }}
                    className="flex items-center gap-1 px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 rounded transition-colors"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {ts}
                  </button>
                );
              })}
            </div>
            
            {/* 添加笔记 */}
            {onAddNote && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onAddNote();
                }}
                className="flex items-center gap-1 px-2 py-1 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded transition-colors"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                添加笔记
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface SectionProps {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultExpanded?: boolean;
}

function Section({ title, icon, children, defaultExpanded = true }: SectionProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  
  return (
    <div className="bg-gray-50 rounded-lg overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-gray-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="font-medium text-gray-900">{title}</h3>
        </div>
        <svg 
          className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      
      {isExpanded && (
        <div className="px-4 pb-4">
          {children}
        </div>
      )}
    </div>
  );
}

// ============ 主组件 ============

export function SummaryPanel({
  summary,
  isLoading = false,
  onGenerate,
  onSeek,
  onAddNote
}: SummaryPanelProps) {
  // 空状态
  if (!isLoading && !summary) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
        <div className="w-16 h-16 mb-4 bg-gray-100 rounded-full flex items-center justify-center">
          <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-gray-900 mb-2">暂无课堂摘要</h3>
        <p className="text-gray-500 mb-6 max-w-sm">
          AI 将自动生成课堂概要，帮助家长快速了解今天讲了什么
        </p>
        
        {onGenerate && (
          <button
            onClick={onGenerate}
            className="px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-lg transition-colors"
          >
            生成课堂摘要
          </button>
        )}
      </div>
    );
  }
  
  // 加载状态
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4">
        <div className="w-12 h-12 mb-4 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-600">正在生成课堂摘要...</p>
        <p className="text-sm text-gray-400 mt-1">AI 正在分析课堂内容</p>
      </div>
    );
  }
  
  if (!summary) return null;
  
  return (
    <div className="flex flex-col h-full overflow-y-auto p-4 space-y-4">
      {/* 课堂概要 */}
      <div className="bg-blue-50 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-2">
          <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h3 className="font-medium text-blue-900">课堂概要</h3>
        </div>
        <p className="text-blue-800">{summary.overview}</p>
      </div>
      
      {/* 主要知识点 */}
      <Section
        title="主要知识点"
        icon={
          <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
        }
      >
        <div className="space-y-3">
          {summary.takeaways.map((takeaway, index) => (
            <TakeawayCard
              key={index}
              takeaway={takeaway}
              index={index}
              onSeek={onSeek}
              onAddNote={onAddNote ? () => onAddNote(takeaway.insight, takeaway) : undefined}
            />
          ))}
        </div>
      </Section>
      
      {/* 重点难点 */}
      {summary.keyDifficulties.length > 0 && (
        <Section
          title="重点难点"
          icon={
            <svg className="w-5 h-5 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          }
          defaultExpanded={false}
        >
          <ul className="space-y-2">
            {summary.keyDifficulties.map((difficulty, index) => (
              <li key={index} className="flex items-start gap-2">
                <span className="flex-shrink-0 w-1.5 h-1.5 mt-2 bg-orange-500 rounded-full" />
                <span className="text-gray-700">{difficulty}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      
      {/* 课堂结构 */}
      {summary.structure.length > 0 && (
        <Section
          title="课堂结构"
          icon={
            <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
            </svg>
          }
          defaultExpanded={false}
        >
          <div className="flex flex-wrap gap-2">
            {summary.structure.map((item, index) => (
              <React.Fragment key={index}>
                <span className="px-3 py-1.5 bg-purple-100 text-purple-700 text-sm rounded-full">
                  {item}
                </span>
                {index < summary.structure.length - 1 && (
                  <span className="flex items-center text-gray-300">→</span>
                )}
              </React.Fragment>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

export default SummaryPanel;
