'use client';

/**
 * ConsultMarkdown —— Consult 场景专用的 Markdown 渲染器
 *
 * 目标：
 *   - AI 回复里 # / ## / *粗体* / `code` / - 列表 / 表格都要能正常渲染
 *   - 公式（inline $...$ 和 block $$...$$）要能渲染，因为 CV 诊断里经常出现数值评分
 *   - 样式跟 Consult 设计系统对齐（text-ink / text-ink-muted / border-divider / 无 Tailwind prose 的默认灰蓝色）
 *   - 流式态尾部挂光标
 *
 * 与 src/components/StreamingMarkdown.tsx 不同：
 *   - 不包含时间戳按钮（那是 MeetMind 听课产品的功能，Consult 用不着）
 *   - 不包含资料引用 bookmark
 *   - 字号/行距按 Consult 阅读密度调校
 *   - 为了让"学生端对话气泡"和"showDraft 文档体"都能复用，导出一个 size 变体
 */

import React, { memo, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import type { Components } from 'react-markdown';

type Density = 'chat' | 'draft';

interface ConsultMarkdownProps {
  content: string;
  density?: Density;
  className?: string;
}

const CONTAINER_CLASSES: Record<Density, string> = {
  // 对话气泡：紧凑行距，13.5/1.75
  chat: 'consult-md-chat text-[13.5px] leading-[1.75] text-ink',
  // showDraft 文档体：更舒展，13/1.8
  draft: 'consult-md-draft text-[13px] leading-[1.8] text-ink',
};

function buildComponents(density: Density): Components {
  const h2Size = density === 'draft' ? 'text-[14px]' : 'text-[13.5px]';
  const h3Size = density === 'draft' ? 'text-[13px]' : 'text-[12.5px]';
  return {
    p: ({ children, ...p }) => (
      <p {...p} className="mb-2.5 last:mb-0">
        {children}
      </p>
    ),
    h1: ({ children, ...p }) => (
      <h1 {...p} className="mb-2 mt-4 text-[15px] font-semibold text-ink first:mt-0">
        {children}
      </h1>
    ),
    h2: ({ children, ...p }) => (
      <h2 {...p} className={`mb-2 mt-4 ${h2Size} font-semibold text-ink first:mt-0`}>
        {children}
      </h2>
    ),
    h3: ({ children, ...p }) => (
      <h3 {...p} className={`mb-1.5 mt-3 ${h3Size} font-semibold text-ink first:mt-0`}>
        {children}
      </h3>
    ),
    ul: ({ children, ...p }) => (
      <ul {...p} className="mb-2.5 list-disc space-y-1 pl-5 marker:text-ink-muted">
        {children}
      </ul>
    ),
    ol: ({ children, ...p }) => (
      <ol {...p} className="mb-2.5 list-decimal space-y-1 pl-5 marker:text-ink-muted">
        {children}
      </ol>
    ),
    li: ({ children, ...p }) => (
      <li {...p} className="leading-[1.7]">
        {children}
      </li>
    ),
    strong: ({ children, ...p }) => (
      <strong {...p} className="font-semibold text-ink">
        {children}
      </strong>
    ),
    em: ({ children, ...p }) => (
      <em {...p} className="italic text-ink-secondary">
        {children}
      </em>
    ),
    code: ({ children, className, ...p }) => {
      const isInline = !className || !/^language-/.test(className);
      if (isInline) {
        return (
          <code
            {...p}
            className="rounded bg-hover px-1 py-0.5 text-[0.86em] font-mono text-ink"
          >
            {children}
          </code>
        );
      }
      return (
        <code {...p} className={`${className} block overflow-x-auto text-[12px]`}>
          {children}
        </code>
      );
    },
    pre: ({ children, ...p }) => (
      <pre
        {...p}
        className="mb-2.5 overflow-x-auto rounded-lg border border-divider bg-canvas/60 p-3 text-[12px] leading-[1.6]"
      >
        {children}
      </pre>
    ),
    blockquote: ({ children, ...p }) => (
      <blockquote
        {...p}
        className="my-2 border-l-2 border-ink/30 pl-3 text-ink-secondary"
      >
        {children}
      </blockquote>
    ),
    a: ({ children, href, ...p }) => (
      <a
        {...p}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-ink underline decoration-ink-muted underline-offset-2 hover:decoration-ink"
      >
        {children}
      </a>
    ),
    hr: (p) => <hr {...p} className="my-3 border-divider" />,
    table: ({ children, ...p }) => (
      <div className="mb-2.5 overflow-x-auto">
        <table {...p} className="min-w-full border-collapse text-[12.5px]">
          {children}
        </table>
      </div>
    ),
    thead: ({ children, ...p }) => (
      <thead {...p} className="border-b border-divider">
        {children}
      </thead>
    ),
    th: ({ children, ...p }) => (
      <th {...p} className="px-2.5 py-1.5 text-left font-semibold text-ink">
        {children}
      </th>
    ),
    td: ({ children, ...p }) => (
      <td {...p} className="border-b border-divider/60 px-2.5 py-1.5 align-top text-ink">
        {children}
      </td>
    ),
  };
}

export const ConsultMarkdown = memo(function ConsultMarkdown({
  content,
  density = 'chat',
  className = '',
}: ConsultMarkdownProps) {
  const components = useMemo(() => buildComponents(density), [density]);
  return (
    <div className={`${CONTAINER_CLASSES[density]} ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});

export default ConsultMarkdown;
