'use client';

/**
 * CompanionMarkdown — AI 同桌消息的渲染器
 *
 * 设计意图：
 *   AI 同桌经常要讲公式（高中数学/大学专业课）、给 Markdown 列表、偶尔上表格。
 *   之前直接把 content 往 <p> 里塞，导致 $E=mc^2$ 原样显示、`**粗体**` 也看不见。
 *
 *   但我们不希望像 StreamingMarkdown 那样出现"可点击时间戳按钮"——
 *   那是复习态的交互。同桌的话里出现 [MM:SS] 这种字符，应该自然并入正文文本，
 *   不要突兀地变成黄色按钮把用户注意力拽走。
 *
 *   所以这里做一个更克制的 Markdown 渲染：GFM + Math + 纯文字，没有额外交互。
 *
 * 设计系统：零渐变、零阴影、纯平涂
 */

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import type { Components } from 'react-markdown';
import { normalizeCompanionMarkdown } from './companion-markdown-utils';

export interface CompanionMarkdownProps {
  content: string;
  /** 追加在最后一个字符后的闪烁光标（流式中） */
  isStreaming?: boolean;
  className?: string;
}

/**
 * 把 AI 同桌常见的伪时间戳标记（如 [47:36]）去掉——
 * 同桌不应该报时间戳，这是复习态的事。
 * 但保留 [资料N] 这种引用痕迹，因为它让"有根"可见。
 */
const markdownComponents: Components = {
  // 让段落之间更紧凑，与气泡内 padding 和谐
  p: ({ children }) => (
    <p className="text-[13.5px] leading-relaxed text-ink [&:not(:last-child)]:mb-2">
      {children}
    </p>
  ),
  // 列表样式：保留浏览器原生 marker，尤其不能把有序列表渲染成圆点。
  ul: ({ children }) => (
    <ul className="my-2 list-disc space-y-1 pl-5 text-[13.5px] leading-relaxed text-ink marker:text-ink-muted/70">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-2 list-decimal space-y-1 pl-5 text-[13.5px] leading-relaxed text-ink marker:text-ink-muted/80">{children}</ol>
  ),
  li: ({ children }) => (
    <li className="pl-0.5 leading-relaxed">
      {children}
    </li>
  ),
  // 标题
  h1: ({ children }) => (
    <h3 className="mt-2 mb-1.5 text-[14.5px] font-semibold tracking-[-0.01em] text-ink">
      {children}
    </h3>
  ),
  h2: ({ children }) => (
    <h3 className="mt-2 mb-1.5 text-[14px] font-semibold tracking-[-0.005em] text-ink">
      {children}
    </h3>
  ),
  h3: ({ children }) => (
    <h4 className="mt-2 mb-1 text-[13.5px] font-semibold text-ink">{children}</h4>
  ),
  // 强调 / 引用
  strong: ({ children }) => (
    <strong className="font-semibold text-ink">{children}</strong>
  ),
  em: ({ children }) => <em className="italic text-ink-secondary">{children}</em>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-[#E9E9E7] pl-3 text-[13px] italic text-ink-secondary">
      {children}
    </blockquote>
  ),
  // 行内代码 / 代码块
  code: ({ className, children, ...props }) => {
    const isBlock = Boolean(className?.startsWith('language-'));
    if (isBlock) {
      return (
        <code className="block overflow-x-auto rounded-lg bg-[#F4F4F2] px-3 py-2 font-mono text-[12px] leading-relaxed text-ink" {...props}>
          {children}
        </code>
      );
    }
    return (
      <code className="rounded bg-[#F0F0ED] px-1.5 py-0.5 font-mono text-[12px] text-ink" {...props}>
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-lg bg-[#F4F4F2] p-0 text-[12px]">
      {children}
    </pre>
  ),
  // 链接、分隔线、表格（保留最常用的）
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-ink underline decoration-ink-muted/50 underline-offset-2 hover:decoration-ink"
    >
      {children}
    </a>
  ),
  hr: () => <hr className="my-3 border-[#E9E9E7]" />,
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-[12.5px]">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-[#E9E9E7] px-2 py-1.5 text-left font-medium text-ink">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b border-[#E9E9E7]/60 px-2 py-1.5 text-ink-secondary">
      {children}
    </td>
  ),
};

export function CompanionMarkdown({
  content,
  isStreaming = false,
  className = '',
}: CompanionMarkdownProps) {
  const cleaned = normalizeCompanionMarkdown(content);

  return (
    <div className={`companion-markdown ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={markdownComponents}
      >
        {cleaned}
      </ReactMarkdown>
      {isStreaming && (
        <span className="ml-0.5 inline-block h-[13px] w-[2px] translate-y-[2px] bg-ink/60 animate-pulse" />
      )}
    </div>
  );
}

export default CompanionMarkdown;
