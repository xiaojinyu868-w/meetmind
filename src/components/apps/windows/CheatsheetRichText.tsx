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

/**
 * 只给语义标签，不带样式：这张纸的排印（booktabs 表格、圆点层级、居中公式）
 * 全部由 cheatsheet-paper-styles.ts 里的 .cs-page / .cs-flow 选择器决定，屏幕与打印同一套。
 */
const components: Components = {
  p: ({ children }) => <p>{children}</p>,
  h1: ({ children }) => <h4>{children}</h4>,
  h2: ({ children }) => <h4>{children}</h4>,
  h3: ({ children }) => <h5>{children}</h5>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
  ),
  table: ({ children }) => (
    <div className="cheatsheet-table-wrap">
      <table>{children}</table>
    </div>
  ),
  pre: ({ children }) => <>{children}</>,
  code: ({ className, children, ...props }) => {
    const source = String(children).replace(/\n$/, '');
    const language = className?.match(/language-([\w-]+)/)?.[1];
    if (language === 'mermaid') {
      return <ChatMermaidBlock code={source} className="cheatsheet-mermaid rounded-none" />;
    }
    if (language || source.includes('\n')) {
      return <code className="cheatsheet-codeblock" {...props}>{children}</code>;
    }
    return <code {...props}>{children}</code>;
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
