'use client';

import React, { useMemo, useCallback, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import type { Components } from 'react-markdown';
import type { Citation } from '@/types/dify';
import { CitationDetailSheet, resolveCitations } from './CitationReferenceSheet';

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
 * - 资料引用 [资料N] 渲染为可点击数字上标
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
  const resolvedCitations = useMemo(() => resolveCitations(citations), [citations]);
  const citationByIndex = useMemo(
    () => new Map(resolvedCitations.map((item) => [item.index, item])),
    [resolvedCitations]
  );
  const [activeCitationIndex, setActiveCitationIndex] = useState<number | null>(
    resolvedCitations[0]?.index ?? null
  );
  const [isCitationSheetOpen, setIsCitationSheetOpen] = useState(false);

  useEffect(() => {
    if (!resolvedCitations.length) {
      setActiveCitationIndex(null);
      setIsCitationSheetOpen(false);
      return;
    }

    if (activeCitationIndex === null || !citationByIndex.has(activeCitationIndex)) {
      setActiveCitationIndex(resolvedCitations[0].index);
    }
  }, [activeCitationIndex, citationByIndex, resolvedCitations]);

  const openCitation = useCallback(
    (citationIndex: number) => {
      if (!citationByIndex.has(citationIndex)) return;
      setActiveCitationIndex(citationIndex);
      setIsCitationSheetOpen(true);
    },
    [citationByIndex]
  );

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
    const tokenRegex = /\[(?:引用\s*|t=)?((\d{1,2}(?::\d{2}){1,2})(?:-(\d{1,2}(?::\d{2}){1,2}))?)\]|\[资料\s*(\d+)\]/g;
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
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onTimestampClick?.(startMs);
            }}
            className={`
              inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-xs font-mono transition-all duration-200
              ${isActive
                ? 'scale-105 border-[#232322] bg-[#232322] text-white'
                : 'border-[#E9E9E7] bg-[#FDF3C0] text-[#232322] hover:border-[#232322] hover:shadow-sm'
              }
            `}
          >
            <span className={isActive ? 'animate-pulse' : ''}>▶</span>
            {fullTime}
          </button>
        );
      } else if (citationIndex) {
        const citationNumber = Number.parseInt(citationIndex, 10);
        const citationItem = Number.isFinite(citationNumber)
          ? citationByIndex.get(citationNumber)
          : undefined;
        const isActive = citationNumber === activeCitationIndex && isCitationSheetOpen;
        const badgeClasses = [
          'ml-0.5 inline-flex h-4.5 min-w-[18px] -translate-y-[0.42em] items-center justify-center rounded-full px-1 align-super text-[10px] font-semibold leading-none transition-all',
          isActive
            ? 'bg-slate-800 text-white shadow-sm'
            : 'bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700',
        ].join(' ');

        if (citationItem) {
          parts.push(
            <button
              key={`cite-${keyIndex++}`}
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                openCitation(citationNumber);
              }}
              className={badgeClasses}
              title={`资料${citationNumber}：${citationItem.title}`}
              aria-label={`资料${citationNumber}：${citationItem.title}，点击查看详情`}
            >
              {citationIndex}
            </button>
          );
        } else {
          parts.push(
            <span
              key={`cite-missing-${keyIndex++}`}
              className="ml-0.5 inline-flex h-4.5 min-w-[18px] -translate-y-[0.42em] items-center justify-center rounded-full bg-slate-100 px-1 align-super text-[10px] font-semibold leading-none text-slate-400"
              aria-label={`资料${citationIndex}`}
            >
              {citationIndex}
            </span>
          );
        }
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
  }, [activeCitationIndex, citationByIndex, currentTime, isCitationSheetOpen, onTimestampClick, openCitation, parseTimeToMs]);

  // 递归处理 children，将字符串中的时间戳转换为按钮
  // 跳过 KaTeX 渲染的数学公式元素，避免破坏其 DOM 结构
  const processChildren = useCallback((children: React.ReactNode): React.ReactNode => {
    return React.Children.map(children, (child) => {
      if (typeof child === 'string') {
        return renderTextWithTimestamps(child);
      }

      if (React.isValidElement<{ className?: string; children?: React.ReactNode }>(child)) {
        // 跳过 KaTeX 渲染的元素（span.katex, span.katex-display 等）
        const className = child.props.className;
        if (
          typeof className === 'string' &&
          (className.includes('katex') || className.includes('math'))
        ) {
          return child;
        }

        if (child.props.children) {
          return React.cloneElement(child, {
            ...child.props,
            children: processChildren(child.props.children),
          });
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
      <h2 {...props} className="mb-2 mt-4 text-base font-semibold text-gray-800 first:mt-0">
        {processChildren(children)}
      </h2>
    ),
    h3: ({ children, ...props }) => (
      <h3 {...props} className="mb-1.5 mt-3 text-sm font-semibold text-gray-700">
        {processChildren(children)}
      </h3>
    ),

    // 列表样式
    ul: ({ children, ...props }) => (
      <ul {...props} className="mb-3 list-inside list-disc space-y-1 text-gray-700">
        {children}
      </ul>
    ),
    ol: ({ children, ...props }) => (
      <ol {...props} className="mb-3 list-inside list-decimal space-y-1 text-gray-700">
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
          <code {...props} className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-mono text-[#232322]">
            {children}
          </code>
        );
      }
      return (
        <code {...props} className={`block overflow-x-auto rounded-lg bg-gray-50 p-3 text-xs ${codeClassName}`}>
          {children}
        </code>
      );
    },

    // 引用块
    blockquote: ({ children, ...props }) => (
      <blockquote {...props} className="my-2 rounded-r border-l-4 border-[#E9E9E7] bg-[#FDF3C0]/20 py-1 pl-3 text-gray-600 italic">
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
        className="text-[#787774] underline decoration-[#FDF3C0] transition-colors hover:text-[#232322] hover:decoration-[#232322]"
      >
        {children}
      </a>
    ),

    table: ({ children, ...props }) => (
      <div className="my-3 w-full overflow-x-auto rounded-xl border border-divider bg-white">
        <table {...props} className="min-w-full border-collapse text-left text-[13px] leading-6">
          {children}
        </table>
      </div>
    ),
    thead: ({ children, ...props }) => (
      <thead {...props} className="bg-canvas text-ink-secondary">
        {children}
      </thead>
    ),
    th: ({ children, ...props }) => (
      <th {...props} className="border-b border-divider px-3 py-2 font-medium text-ink">
        {processChildren(children)}
      </th>
    ),
    td: ({ children, ...props }) => (
      <td {...props} className="border-t border-divider px-3 py-2 align-top text-ink-secondary">
        {processChildren(children)}
      </td>
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
        className="mr-2 accent-[#232322]"
      />
    ),
  }), [processChildren]);

  return (
    <>
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
          <span className="ml-0.5 inline-block h-4 w-2 animate-pulse rounded-sm bg-[#232322] align-middle" />
        )}
      </div>

      <CitationDetailSheet
        citations={citations}
        activeIndex={activeCitationIndex}
        open={isCitationSheetOpen}
        onOpenChange={setIsCitationSheetOpen}
        onSelectIndex={setActiveCitationIndex}
      />
    </>
  );
}

export default StreamingMarkdown;
