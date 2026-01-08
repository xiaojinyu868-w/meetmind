'use client';

// 困惑详情展开组件
// 点击热区展开详情，显示转录内容和困惑学生列表

import { useState } from 'react';
import type { Anchor } from '@/types';

export interface ConfusionDetailData {
  timeSlot: string;
  startMs: number;
  endMs: number;
  anchors: Anchor[];
  transcriptText?: string;
}

interface ConfusionDetailProps {
  data: ConfusionDetailData;
  onClose?: () => void;
  onPlaySegment?: (startMs: number) => void;
  onGenerateSuggestion?: (data: ConfusionDetailData) => void;
}

export function ConfusionDetail({
  data,
  onClose,
  onPlaySegment,
  onGenerateSuggestion,
}: ConfusionDetailProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  const formatTime = (ms: number): string => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    return `${minutes.toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
  };

  // 按学生分组
  const studentGroups = data.anchors.reduce((acc, anchor) => {
    const studentId = anchor.studentId || '匿名学生';
    if (!acc[studentId]) {
      acc[studentId] = [];
    }
    acc[studentId].push(anchor);
    return acc;
  }, {} as Record<string, Anchor[]>);

  const uniqueStudents = Object.keys(studentGroups);
  const unresolvedCount = data.anchors.filter(a => !a.resolved).length;

  return (
    <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
      {/* 头部 */}
      <div 
        className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-red-50 to-orange-50 cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
            <span className="text-red-600 font-bold">{data.anchors.length}</span>
          </div>
          <div>
            <div className="font-medium text-gray-900">
              {data.timeSlot}
            </div>
            <div className="text-sm text-gray-500">
              {uniqueStudents.length} 位学生 · {unresolvedCount} 个待解决
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {onPlaySegment && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onPlaySegment(data.startMs);
              }}
              className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
              title="播放此段"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
              </svg>
            </button>
          )}
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

      {/* 展开内容 */}
      {isExpanded && (
        <div className="p-4 space-y-4">
          {/* 转录内容 */}
          {data.transcriptText && (
            <div className="bg-gray-50 rounded-lg p-4">
              <h4 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
                <span>📝</span> 课堂内容
              </h4>
              <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">
                {data.transcriptText}
              </p>
            </div>
          )}

          {/* 学生困惑列表 */}
          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
              <span>👥</span> 困惑学生 ({uniqueStudents.length})
            </h4>
            <div className="space-y-2">
              {uniqueStudents.map((studentId) => {
                const studentAnchors = studentGroups[studentId];
                const hasUnresolved = studentAnchors.some(a => !a.resolved);
                
                return (
                  <div
                    key={studentId}
                    className={`flex items-center justify-between p-3 rounded-lg ${
                      hasUnresolved ? 'bg-red-50' : 'bg-green-50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-medium ${
                        hasUnresolved ? 'bg-red-400' : 'bg-green-400'
                      }`}>
                        {studentId.charAt(0)}
                      </div>
                      <div>
                        <div className="text-sm font-medium text-gray-900">{studentId}</div>
                        <div className="text-xs text-gray-500">
                          {studentAnchors.map(a => formatTime(a.timestamp)).join(', ')}
                        </div>
                      </div>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full ${
                      hasUnresolved 
                        ? 'bg-red-100 text-red-700' 
                        : 'bg-green-100 text-green-700'
                    }`}>
                      {hasUnresolved ? '待解决' : '已解决'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
            {onGenerateSuggestion && (
              <button
                onClick={() => onGenerateSuggestion(data)}
                className="flex-1 px-4 py-2 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition-colors text-sm font-medium"
              >
                🤖 生成教学建议
              </button>
            )}
            {onClose && (
              <button
                onClick={onClose}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors text-sm"
              >
                收起
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 困惑详情列表组件
 */
interface ConfusionDetailListProps {
  details: ConfusionDetailData[];
  onPlaySegment?: (startMs: number) => void;
  onGenerateSuggestion?: (data: ConfusionDetailData) => void;
}

export function ConfusionDetailList({
  details,
  onPlaySegment,
  onGenerateSuggestion,
}: ConfusionDetailListProps) {
  if (!details || details.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400">
        <div className="text-4xl mb-2">🎉</div>
        <p>没有困惑热区</p>
      </div>
    );
  }

  // 按困惑数量排序
  const sortedDetails = [...details].sort((a, b) => b.anchors.length - a.anchors.length);

  return (
    <div className="space-y-4">
      {sortedDetails.map((detail, index) => (
        <ConfusionDetail
          key={`${detail.timeSlot}-${index}`}
          data={detail}
          onPlaySegment={onPlaySegment}
          onGenerateSuggestion={onGenerateSuggestion}
        />
      ))}
    </div>
  );
}
