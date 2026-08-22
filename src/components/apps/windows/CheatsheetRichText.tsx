'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkCjkFriendly from 'remark-cjk-friendly';
import rehypeKatex from 'rehype-katex';
import type { Components } from 'react-markdown';
import { ChatMermaidBlock } from '@/components/chat/ChatMermaidBlock';
import 'katex/dist/katex.min.css';

interface CheatsheetRichTextProps {
  content: string;
  formulaOnly?: boolean;
}

const components: Components = {
  p: ({ children }) => <p>{children}</p>,
  h1: ({ children }) => <h4 className="mb-1 mt-1.5 border-b border-divider/70 pb-0.5 text-[1.08em] font-semibold text-ink">{children}</h4>,
  h2: ({ children }) => <h4 className="mb-1 mt-1.5 border-b border-divider/60 pb-0.5 text-[1.04em] font-semibold text-ink">{children}</h4>,
  h3: ({ children }) => <h5 className="mb-0.5 mt-1 font-semibold text-ink">{children}</h5>,
  strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
  em: ({ children }) => <em className="italic text-ink-secondary">{children}</em>,
  ul: ({ children }) => <ul className="my-1 list-disc space-y-0.5 pl-4 marker:text-ink-muted">{children}</ul>,
  ol: ({ children }) => <ol className="my-1 list-decimal space-y-0.5 pl-4 marker:text-ink-muted">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5 leading-[1.35]">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-1 border-l-2 border-pine/45 pl-2 text-ink-secondary">{children}</blockquote>
  ),
  hr: () => <hr className="my-1.5 border-divider" />,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-pine underline decoration-pine/35 underline-offset-2">
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="cheatsheet-table-wrap my-1.5 overflow-x-auto">
      <table className="w-full table-fixed border-collapse text-[0.88em] leading-[1.25]">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border border-divider bg-paper-warm px-1 py-0.5 text-left font-semibold text-ink">{children}</th>,
  td: ({ children }) => <td className="break-words border border-divider/80 px-1 py-0.5 align-top text-ink-secondary">{children}</td>,
  pre: ({ children }) => <>{children}</>,
  code: ({ className, children, ...props }) => {
    const source = String(children).replace(/\n$/, '');
    const language = className?.match(/language-([\w-]+)/)?.[1];
    if (language === 'mermaid') {
      return <ChatMermaidBlock code={source} className="cheatsheet-mermaid my-1.5 rounded-none" />;
    }
    if (language || source.includes('\n')) {
      return (
        <code className="my-1 block overflow-x-auto border-l-2 border-ink-muted/45 bg-paper-warm px-1.5 py-1 font-mono text-[0.88em] leading-[1.35] text-ink" {...props}>
          {children}
        </code>
      );
    }
    return <code className="bg-paper-warm px-0.5 font-mono text-[0.92em] text-ink" {...props}>{children}</code>;
  },
};

export function CheatsheetRichText({ content, formulaOnly = false }: CheatsheetRichTextProps) {
  return (
    <div
      className={formulaOnly ? 'cheatsheet-richtext cheatsheet-richtext-formula' : 'cheatsheet-richtext cheatsheet-item-body'}
    >
      <ReactMarkdown remarkPlugins={[remarkCjkFriendly, remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
