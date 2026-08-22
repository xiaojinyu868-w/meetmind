'use client';

import React, { useMemo, useCallback, useEffect, useState, useDeferredValue } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
// CJK 友好强调：CommonMark 侧翼规则会让 `的**"xxx"**这` 这类
// 中文引号紧贴 ** 的加粗不解析（时灵时不灵的根因），统一放松
import remarkCjkFriendly from 'remark-cjk-friendly';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import type { Components } from 'react-markdown';
import { Play } from 'lucide-react';
import type { Citation } from '@/types/dify';
import { CitationDetailSheet, resolveCitations } from './CitationReferenceSheet';
import { ChatCodeBlock } from './chat/ChatCodeBlock';
import { ChatMermaidBlock } from './chat/ChatMermaidBlock';
import { ChatImageLightbox } from './chat/ChatImageLightbox';

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
  // useDeferredValue：streaming 中频繁的 token 更新不阻塞主线程交互
  // 非 streaming 时立刻更新（无副作用）；这是 React 18 顶级实践（对标 Cursor / ChatGPT）
  const deferredContent = useDeferredValue(content);

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

        // R9-2 时间戳顶级 UX 重做（2026-06-01）：
        //
        // 用户反馈直击痛点：「pine 极淡 underline → 用户区分不出，嵌入正文影响观感。
        // 颜色深一些适合嵌入正文里面」。
        //
        // 行业黄金标准（Notion @mention / Linear issue ref / GitHub PR ref）：
        //   默认中性深色 mono pill + 极淡同色 tint bg + 紧凑 px + hover 才召唤主签名色
        //
        // 三态决策：
        //   default — bg-ink/[0.055] 极淡墨黑 tint + text-ink-secondary 深灰文字 +
        //             rounded-[5px] 小圆角 + px-1.5 py-[1px] 紧凑 + 无图标
        //             → 嵌入正文不喧闹，但有清晰的视觉边界让用户「认得出」
        //   hover   — bg-pine/[0.10] + text-pine（"AI 在场"信号召唤）+ ring-pine/15
        //             → 才出现可点感，符合"信号节制"
        //   active  — bg-pine 实底 + text-white + Play 8px 小图标（仅此态显示）
        //             → 当前播放点，独占图标语义，让"现在"被清楚标记
        //
        // 关键产品决策：去掉默认态的 Play 三角图标。它让 chip 永远像按钮，
        // 破坏阅读节奏。无图标的深色 mono pill 才是真正的"嵌入式资产引用"。
        parts.push(
          <button
            key={`ts-${keyIndex++}`}
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onTimestampClick?.(startMs);
            }}
            className={
              isActive
                ? 'mx-[2px] inline-flex items-center gap-1 rounded-[5px] bg-pine px-1.5 py-[1px] align-baseline font-mono text-[11.5px] font-medium tabular-nums tracking-[0.01em] text-white shadow-[0_1px_2px_rgba(45,79,62,0.25)] transition-all'
                : 'mx-[2px] inline-flex items-center rounded-[5px] bg-ink/[0.055] px-1.5 py-[1px] align-baseline font-mono text-[11.5px] font-medium tabular-nums tracking-[0.01em] text-ink-secondary ring-[0.5px] ring-ink/[0.08] transition-all duration-150 hover:bg-pine/[0.10] hover:text-pine hover:ring-pine/25 hover:-translate-y-[0.5px] active:translate-y-0 active:bg-pine/15'
            }
            title={`跳到 ${fullTime}`}
            aria-label={`跳到课堂 ${fullTime}`}
          >
            {isActive ? (
              <Play
                size={8}
                strokeWidth={2.4}
                fill="currentColor"
                className="translate-y-[-0.5px]"
                aria-hidden
              />
            ) : null}
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
            ? 'bg-ink text-white shadow-sm'
            : 'bg-paper-deep text-ink-muted hover:bg-divider hover:text-ink-secondary',
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
              className="ml-0.5 inline-flex h-4.5 min-w-[18px] -translate-y-[0.42em] items-center justify-center rounded-full bg-paper-deep px-1 align-super text-[10px] font-semibold leading-none text-ink-muted"
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

  // 自定义渲染器（v7 R9 顶级产品打磨：呼吸感 + 双签名色 + 信息层级）
  const components: Components = useMemo(() => ({
    // 段落：leading-[1.85] 让中文阅读舒适，段落间 mb-3.5 给呼吸
    p: ({ children, ...props }) => (
      <p {...props} className="mb-3.5 last:mb-0 leading-[1.85] text-[14.5px] text-ink">
        {processChildren(children)}
      </p>
    ),

    // 列表项：行距统一 1.85，pl-1 让 marker 不挤
    li: ({ children, ...props }) => (
      <li {...props} className="leading-[1.85] text-[14.5px] text-ink pl-1">
        {processChildren(children)}
      </li>
    ),

    // 标题：与正文有清晰对比，但不喧宾夺主
    h2: ({ children, ...props }) => (
      <h2 {...props} className="mb-3 mt-5 text-[16px] font-semibold tracking-[-0.012em] text-ink first:mt-0 leading-snug">
        {processChildren(children)}
      </h2>
    ),
    h3: ({ children, ...props }) => (
      <h3 {...props} className="mb-2 mt-4 text-[14.5px] font-semibold text-ink first:mt-0 leading-snug">
        {processChildren(children)}
      </h3>
    ),

    // 列表：用 marker:text-pine 让 dot/数字带主签名色，而不是普通灰
    ul: ({ children, ...props }) => (
      <ul {...props} className="mb-3.5 list-disc space-y-1.5 pl-5 marker:text-pine/55 marker:text-[0.95em]">
        {children}
      </ul>
    ),
    ol: ({ children, ...props }) => (
      <ol {...props} className="mb-3.5 list-decimal space-y-1.5 pl-5 marker:font-mono marker:text-pine/70 marker:text-[0.92em] marker:font-medium">
        {children}
      </ol>
    ),

    // 强调：bold 用 ink + 微 letter-spacing 紧致；italic 用 ink-secondary
    strong: ({ children, ...props }) => (
      <strong {...props} className="font-semibold tracking-[-0.005em] text-ink">
        {processChildren(children)}
      </strong>
    ),
    em: ({ children, ...props }) => (
      <em {...props} className="italic text-ink-secondary">
        {processChildren(children)}
      </em>
    ),

    // 代码：行内薄底；块级走 ChatCodeBlock（Shiki 高亮 + 复制 + 行号 + 语言 badge）
    code: ({ children, className: codeClassName, ...props }) => {
      const isInline = !codeClassName;
      if (isInline) {
        return (
          <code {...props} className="rounded bg-paper-warm px-1.5 py-[1px] font-mono text-[12.5px] text-ink">
            {children}
          </code>
        );
      }
      // block code：从 className 提取 language（react-markdown 形如 "language-typescript"）
      const langMatch = /language-([\w+-]+)/.exec(codeClassName || '');
      const lang = langMatch?.[1];
      const codeStr = String(children).replace(/\n$/, '');
      // M14.5: ```mermaid → 走专门的图表渲染（svg 输出，节点图/序列图/流程图等）
      if (lang === 'mermaid') {
        return <ChatMermaidBlock code={codeStr} isStreaming={isStreaming} />;
      }
      return <ChatCodeBlock code={codeStr} lang={lang} isStreaming={isStreaming} />;
    },
    // pre 直接返回 children——ChatCodeBlock 自带完整 wrapper，不要 react-markdown 默认的 <pre> 再包一层
    pre: ({ children }) => <>{children}</>,

    // 图片：lazy-load + click-to-zoom lightbox
    img: ({ src, alt }) => {
      if (typeof src !== 'string' || !src) return null;
      return <ChatImageLightbox src={src} alt={alt} />;
    },

    // 引用块：去掉 v6 黄底，用极淡 pine 衬底 + 极细 pine 左竖线
    blockquote: ({ children, ...props }) => (
      <blockquote {...props} className="my-3 rounded-r-md border-l-2 border-pine/40 bg-pine/[0.03] py-1.5 pl-3.5 pr-2 text-[14px] text-ink-secondary leading-[1.75]">
        {children}
      </blockquote>
    ),

    // 链接：去掉 v6 黄色 underline，改 pine 主签名色
    a: ({ children, href, ...props }) => (
      <a
        {...props}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-pine underline decoration-pine/35 decoration-1 underline-offset-[3px] transition-all hover:decoration-pine hover:decoration-2"
      >
        {children}
      </a>
    ),

    table: ({ children, ...props }) => (
      <div className="my-4 w-full overflow-x-auto rounded-lg border border-divider bg-card">
        <table {...props} className="min-w-full border-collapse text-left text-[13.5px] leading-[1.7]">
          {children}
        </table>
      </div>
    ),
    thead: ({ children, ...props }) => (
      <thead {...props} className="bg-paper-warm text-ink-secondary">
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
      <hr {...props} className="my-4 border-divider" />
    ),

    // 任务列表项
    input: ({ ...props }) => (
      <input
        {...props}
        disabled
        className="mr-2 accent-[#1C1B19]"
      />
    ),
  }), [processChildren, isStreaming]);

  return (
    <>
      <div className={`streaming-markdown ${className}`}>
        <ReactMarkdown
          remarkPlugins={[remarkCjkFriendly, remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
          components={components}
        >
          {deferredContent}
        </ReactMarkdown>

        {/* 流式输出时显示光标 */}
        {isStreaming && (
          // v7 typing-caret：墨绿 + steps blink（"AI 在场"信号，不是冷冰冰黑色 cursor）
          <span className="typing-caret align-middle" aria-hidden />
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
