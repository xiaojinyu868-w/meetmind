'use client';

import React, { useMemo, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import type { Components } from 'react-markdown';
import type { Citation } from '@/types/dify';

const SUPPORT_CITATION_ID_REGEX = /^support-(\d+)$/i;
const SUPPORT_CITATION_TITLE_REGEX = /(?:导入资料|资料)\s*(\d+)/;

function normalizeTooltipText(value?: string, fallback = ''): string {
  const normalized = (value || '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

interface StreamingMarkdownProps {
  content: string;
  isStreaming?: boolean;
  onTimestampClick?: (timestampMs: number) => void;
  currentTime?: number;
  className?: string;
  citations?: Citation[];
}

/**
 * 流式 Markdown 渲染组件
 * 支持：
 * - 实时渲染流式内容
 * - 时间戳 [MM:SS] 渲染为可点击按钮
 * - GFM (表格、删除线、任务列表等)
 */
export function StreamingMarkdown({
  content,
  isStreaming = false,
  onTimestampClick,
  currentTime = 0,
  className = '',
  citations,
}: StreamingMarkdownProps) {
  const citationTooltipByIndex = useMemo(() => {
    const tooltipByIndex = new Map<number, string>();
    if (!citations?.length) return tooltipByIndex;

    citations.forEach((citation, listIndex) => {
      if (!citation) return;

      const fallbackSnippet = normalizeTooltipText(citation.snippet);
      const titleText = normalizeTooltipText(
        citation.title,
        fallbackSnippet || `资料来源 ${listIndex + 1}`
      );

      const idMatch = citation.id?.match(SUPPORT_CITATION_ID_REGEX);
      if (idMatch) {
        const parsedIndex = Number.parseInt(idMatch[1], 10);
        if (Number.isFinite(parsedIndex) && parsedIndex > 0) {
          tooltipByIndex.set(parsedIndex, titleText);
          return;
        }
      }

      const titleMatch = citation.title?.match(SUPPORT_CITATION_TITLE_REGEX);
      if (titleMatch) {
        const parsedIndex = Number.parseInt(titleMatch[1], 10);
        if (Number.isFinite(parsedIndex) && parsedIndex > 0 && !tooltipByIndex.has(parsedIndex)) {
          tooltipByIndex.set(parsedIndex, titleText);
          return;
        }
      }

      const fallbackIndex = listIndex + 1;
      if (!tooltipByIndex.has(fallbackIndex)) {
        tooltipByIndex.set(fallbackIndex, titleText);
      }
    });

    return tooltipByIndex;
  }, [citations]);

  const shouldProcessInlineTokens = useMemo(() => {
    if (!content.includes('[')) return false;
    return /\[\d{1,2}:\d{2}/.test(content) || /\[资料\s*\d+\]/.test(content) || /\[引用\s*\d{1,2}:\d{2}/.test(content);
  }, [content]);
  
  // 解析时间戳为毫秒
  const parseTimeToMs = useCallback((time: string): number | null => {
    const parts = time.split(':');
    if (parts.length === 2) {
      const minutes = parseInt(parts[0], 10);
      const seconds = parseInt(parts[1], 10);
      if (Number.isFinite(minutes) && Number.isFinite(seconds) && seconds >= 0 && seconds < 60) {
        return (minutes * 60 + seconds) * 1000;
      }
      return null;
    } else if (parts.length === 3) {
      const hours = parseInt(parts[0], 10);
      const minutes = parseInt(parts[1], 10);
      const seconds = parseInt(parts[2], 10);
      if (
        Number.isFinite(hours) &&
        Number.isFinite(minutes) &&
        Number.isFinite(seconds) &&
        minutes >= 0 &&
        minutes < 60 &&
        seconds >= 0 &&
        seconds < 60
      ) {
        return (hours * 3600 + minutes * 60 + seconds) * 1000;
      }
      return null;
    }
    return null;
  }, []);

  // 渲染包含时间戳与资料引用的文本
  const renderTextWithTimestamps = useCallback((text: string): React.ReactNode => {
    // 匹配两类标记：
    // 1) 时间戳 [MM:SS] / [MM:SS-MM:SS] / [引用 MM:SS]
    // 2) 资料引用 [资料N]
    const tokenRegex = /\[(?:引用\s*)?((\d{1,2}:\d{2})(?:-(\d{1,2}:\d{2}))?)\]|\[资料\s*(\d+)\]/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;
    let keyIndex = 0;

    while ((match = tokenRegex.exec(text)) !== null) {
      // 添加时间戳前的文本
      if (match.index > lastIndex) {
        parts.push(text.slice(lastIndex, match.index));
      }

      const fullTime = match[1];
      const startTime = match[2];
      const citationIndex = match[4];

      if (fullTime && startTime) {
        const startMs = parseTimeToMs(startTime);
        if (startMs === null) {
          parts.push(match[0]);
          lastIndex = match.index + match[0].length;
          continue;
        }
        const isActive = currentTime >= startMs && currentTime <= startMs + 5000;

        parts.push(
          <button
            key={`ts-${keyIndex++}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onTimestampClick?.(startMs);
            }}
            className={`
              inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-mono mx-0.5
              transition-all duration-200 border cursor-pointer
              ${isActive 
                ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-white border-amber-500 shadow-md scale-105' 
                : 'bg-gradient-to-r from-amber-100 to-amber-50 text-amber-700 border-amber-200 hover:border-amber-300 hover:shadow-sm'
              }
            `}
          >
            <span className={isActive ? 'animate-pulse' : ''}>▶</span>
            {fullTime}
          </button>
        );
      } else if (citationIndex) {
        const citationNumber = Number.parseInt(citationIndex, 10);
        const citationHint = Number.isFinite(citationNumber)
          ? citationTooltipByIndex.get(citationNumber)
          : undefined;
        const tooltipText = citationHint
          ? `资料${citationIndex}：${citationHint}`
          : `资料来源 ${citationIndex}`;
        const citationKey = keyIndex++;

        parts.push(
          <span key={`cite-wrap-${citationKey}`} className="relative inline-flex align-super ml-0.5 group/cite">
            <span
              className="inline-flex items-center rounded-md border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700"
              title={tooltipText}
              aria-label={tooltipText}
            >
              [{citationIndex}]
            </span>
            {citationHint && (
              <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 w-max max-w-56 -translate-x-1/2 whitespace-nowrap overflow-hidden text-ellipsis rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-normal leading-tight text-slate-600 opacity-0 shadow-sm transition-opacity duration-150 group-hover/cite:opacity-100">
                {citationHint}
              </span>
            )}
          </span>
        );
      } else {
        parts.push(match[0]);
      }

      lastIndex = match.index + match[0].length;
    }

    // 添加剩余文本
    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }

    return parts.length > 0 ? parts : text;
  }, [citationTooltipByIndex, currentTime, onTimestampClick, parseTimeToMs]);

  // 递归处理 children，将字符串中的时间戳转换为按钮
  // 跳过 KaTeX 渲染的数学公式元素，避免破坏其 DOM 结构
  const processChildren = useCallback((children: React.ReactNode): React.ReactNode => {
    if (!shouldProcessInlineTokens) return children;

    return React.Children.map(children, (child) => {
      if (typeof child === 'string') {
        if (!child.includes('[')) return child;
        return renderTextWithTimestamps(child);
      }
      
      if (React.isValidElement(child)) {
        // 跳过 KaTeX 渲染的元素（span.katex, span.katex-display 等）
        const className = child.props.className;
        if (typeof className === 'string' && (
          className.includes('katex') || className.includes('math')
        )) {
          return child;
        }
        
        if (child.props.children) {
          return React.cloneElement(child, {
            ...child.props,
            children: processChildren(child.props.children),
          } as React.Attributes);
        }
      }
      
      return child;
    });
  }, [renderTextWithTimestamps, shouldProcessInlineTokens]);

  // 自定义渲染器
  const components: Components = useMemo(() => ({
    // 段落渲染，处理时间戳
    p: ({ children, ...props }) => (
      <p {...props} className="mb-3 last:mb-0">
        {processChildren(children)}
      </p>
    ),
    
    // 列表项渲染，处理时间戳
    li: ({ children, ...props }) => (
      <li {...props} className="text-sm leading-relaxed">
        {processChildren(children)}
      </li>
    ),
    
    // 标题样式
    h2: ({ children, ...props }) => (
      <h2 {...props} className="text-base font-semibold text-gray-800 mt-4 mb-2 first:mt-0">
        {processChildren(children)}
      </h2>
    ),
    h3: ({ children, ...props }) => (
      <h3 {...props} className="text-sm font-semibold text-gray-700 mt-3 mb-1.5">
        {processChildren(children)}
      </h3>
    ),
    
    // 列表样式
    ul: ({ children, ...props }) => (
      <ul {...props} className="list-disc list-inside space-y-1 mb-3 text-gray-700">
        {children}
      </ul>
    ),
    ol: ({ children, ...props }) => (
      <ol {...props} className="list-decimal list-inside space-y-1 mb-3 text-gray-700">
        {children}
      </ol>
    ),
    
    // 强调样式
    strong: ({ children, ...props }) => (
      <strong {...props} className="font-semibold text-gray-900">
        {processChildren(children)}
      </strong>
    ),
    em: ({ children, ...props }) => (
      <em {...props} className="italic text-gray-600">
        {processChildren(children)}
      </em>
    ),
    
    // 代码块
    code: ({ children, className: codeClassName, ...props }) => {
      const isInline = !codeClassName;
      if (isInline) {
        return (
          <code {...props} className="px-1.5 py-0.5 bg-gray-100 text-amber-700 rounded text-xs font-mono">
            {children}
          </code>
        );
      }
      return (
        <code {...props} className={`block p-3 bg-gray-50 rounded-lg overflow-x-auto text-xs ${codeClassName}`}>
          {children}
        </code>
      );
    },
    
    // 引用块
    blockquote: ({ children, ...props }) => (
      <blockquote {...props} className="border-l-4 border-amber-300 pl-3 py-1 my-2 text-gray-600 italic bg-amber-50/50 rounded-r">
        {children}
      </blockquote>
    ),
    
    // 链接
    a: ({ children, href, ...props }) => (
      <a 
        {...props} 
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-amber-600 hover:text-amber-700 underline decoration-amber-300 hover:decoration-amber-500 transition-colors"
      >
        {children}
      </a>
    ),
    
    // 分隔线
    hr: ({ ...props }) => (
      <hr {...props} className="my-4 border-gray-200" />
    ),
    
    // 任务列表项
    input: ({ ...props }) => (
      <input 
        {...props} 
        disabled 
        className="mr-2 accent-amber-500"
      />
    ),
  }), [processChildren]);

  return (
    <div className={`streaming-markdown ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={components}
      >
        {content}
      </ReactMarkdown>
      
      {/* 流式输出时显示光标 */}
      {isStreaming && (
        <span className="inline-block w-2 h-4 bg-amber-500 animate-pulse ml-0.5 align-middle rounded-sm" />
      )}
    </div>
  );
}

export default StreamingMarkdown;
