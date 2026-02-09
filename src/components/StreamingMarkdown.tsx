'use client';

import React, { useMemo, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import type { Components } from 'react-markdown';

interface StreamingMarkdownProps {
  content: string;
  isStreaming?: boolean;
  onTimestampClick?: (timestampMs: number) => void;
  currentTime?: number;
  className?: string;
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
}: StreamingMarkdownProps) {
  
  // 解析时间戳为毫秒
  const parseTimeToMs = useCallback((time: string): number => {
    const parts = time.split(':');
    if (parts.length === 2) {
      return (parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10)) * 1000;
    } else if (parts.length === 3) {
      return (parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseInt(parts[2], 10)) * 1000;
    }
    return 0;
  }, []);

  // 渲染包含时间戳的文本
  const renderTextWithTimestamps = useCallback((text: string): React.ReactNode => {
    // 匹配时间戳格式：[MM:SS] 或 [MM:SS-MM:SS] 或 [引用 MM:SS]
    const timestampRegex = /\[(?:引用\s*)?((\d{1,2}:\d{2})(?:-(\d{1,2}:\d{2}))?)\]/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;
    let keyIndex = 0;

    while ((match = timestampRegex.exec(text)) !== null) {
      // 添加时间戳前的文本
      if (match.index > lastIndex) {
        parts.push(text.slice(lastIndex, match.index));
      }

      const [, fullTime, startTime] = match;
      const startMs = parseTimeToMs(startTime);
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

      lastIndex = match.index + match[0].length;
    }

    // 添加剩余文本
    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }

    return parts.length > 0 ? parts : text;
  }, [currentTime, onTimestampClick, parseTimeToMs]);

  // 递归处理 children，将字符串中的时间戳转换为按钮
  // 跳过 KaTeX 渲染的数学公式元素，避免破坏其 DOM 结构
  const processChildren = useCallback((children: React.ReactNode): React.ReactNode => {
    return React.Children.map(children, (child) => {
      if (typeof child === 'string') {
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
  }, [renderTextWithTimestamps]);

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
