'use client';

/**
 * 引用来源展示组件
 * 
 * 用于展示联网检索的引用来源
 */

import { useState } from 'react';
import type { Citation } from '@/types/dify';

interface CitationsProps {
  /** 引用列表 */
  citations: Citation[];
  /** 是否默认展开 */
  defaultExpanded?: boolean;
  /** 最大显示数量（折叠时） */
  maxVisible?: number;
}

export function Citations({
  citations,
  defaultExpanded = false,
  maxVisible = 3,
}: CitationsProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  if (!citations || citations.length === 0) {
    return null;
  }

  const visibleCitations = isExpanded ? citations : citations.slice(0, maxVisible);
  const hasMore = citations.length > maxVisible;

  // 来源类型图标
  const sourceIcons: Record<Citation['source_type'], string> = {
    web: '🌐',
    knowledge_base: '📚',
    transcript: '🎙️',
  };

  const sourceLabels: Record<Citation['source_type'], string> = {
    web: '网页',
    knowledge_base: '知识库',
    transcript: '课堂转录',
  };

  return (
    <div className="bg-gray-50 rounded-lg border border-gray-200 overflow-hidden">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-100 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <span className="text-sm">🔗</span>
          <span className="text-sm font-medium text-gray-700">
            参考来源 ({citations.length})
          </span>
        </div>
        {hasMore && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-xs text-indigo-600 hover:text-indigo-800"
          >
            {isExpanded ? '收起' : `展开全部 +${citations.length - maxVisible}`}
          </button>
        )}
      </div>

      {/* 引用列表 */}
      <div className="divide-y divide-gray-100">
        {visibleCitations.map((citation, index) => (
          <CitationItem key={citation.id || index} citation={citation} />
        ))}
      </div>
    </div>
  );
}

/**
 * 单个引用项
 */
function CitationItem({ citation }: { citation: Citation }) {
  const [isHovered, setIsHovered] = useState(false);

  const sourceIcons: Record<Citation['source_type'], string> = {
    web: '🌐',
    knowledge_base: '📚',
    transcript: '🎙️',
  };

  // 提取域名
  const getDomain = (url: string) => {
    try {
      return new URL(url).hostname.replace('www.', '');
    } catch {
      return url;
    }
  };

  return (
    <a
      href={citation.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`
        block p-3 transition-colors
        ${isHovered ? 'bg-indigo-50' : 'hover:bg-gray-50'}
      `}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="flex items-start gap-3">
        {/* 来源图标 */}
        <span className="text-lg flex-shrink-0">
          {sourceIcons[citation.source_type]}
        </span>

        <div className="flex-1 min-w-0">
          {/* 标题 */}
          <h4 className={`
            text-sm font-medium truncate
            ${isHovered ? 'text-indigo-700' : 'text-gray-900'}
          `}>
            {citation.title}
          </h4>

          {/* 摘要 */}
          <p className="text-xs text-gray-500 mt-1 line-clamp-2">
            {citation.snippet}
          </p>

          {/* 域名 */}
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-gray-400">
              {getDomain(citation.url)}
            </span>
          </div>
        </div>

        {/* 外链图标 */}
        <span className={`
          text-gray-400 transition-colors flex-shrink-0
          ${isHovered ? 'text-indigo-500' : ''}
        `}>
          ↗
        </span>
      </div>
    </a>
  );
}

/**
 * 内联引用标记
 * 用于在文本中标记引用
 */
export function InlineCitation({
  index,
  citation,
  onClick,
}: {
  index: number;
  citation: Citation;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center justify-center w-5 h-5 text-xs bg-indigo-100 text-indigo-700 rounded-full hover:bg-indigo-200 transition-colors align-super"
      title={citation.title}
    >
      {index + 1}
    </button>
  );
}

/**
 * 引用骨架屏
 */
export function CitationsSkeleton() {
  return (
    <div className="bg-gray-50 rounded-lg border border-gray-200 overflow-hidden animate-pulse">
      <div className="px-4 py-2 bg-gray-100 border-b border-gray-200">
        <div className="h-4 bg-gray-200 rounded w-24" />
      </div>
      <div className="divide-y divide-gray-100">
        {[1, 2, 3].map((i) => (
          <div key={i} className="p-3">
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 bg-gray-200 rounded" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-gray-200 rounded w-3/4" />
                <div className="h-3 bg-gray-200 rounded w-full" />
                <div className="h-3 bg-gray-200 rounded w-1/4" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
