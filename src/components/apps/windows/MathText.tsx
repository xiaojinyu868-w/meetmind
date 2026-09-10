'use client';

/**
 * MathText — 一段可能夹着 TeX 的短文本（闪卡正反面、测验题干这类"一句话"），
 * `$…$` / `\(…\)` 行内公式与 `$$…$$` / `\[…\]` 块公式用 KaTeX 渲染，其余原样输出。
 * 不走 react-markdown：牌面不需要段落 / 列表语义，也不想为一行字引入整条 markdown 管线。
 * 渲染失败（throwOnError: false）退回原文，不让一张卡因为公式写错而空白。
 */

import { useMemo } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

const TEX_PATTERN = /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^$\n]+?\$)/g;

interface Segment { kind: 'text' | 'inline' | 'block'; value: string }

export function splitMathText(text: string): Segment[] {
  const segments: Segment[] = [];
  let last = 0;
  for (const match of text.matchAll(TEX_PATTERN)) {
    const start = match.index ?? 0;
    if (start > last) segments.push({ kind: 'text', value: text.slice(last, start) });
    const raw = match[0];
    if (raw.startsWith('$$')) segments.push({ kind: 'block', value: raw.slice(2, -2) });
    else if (raw.startsWith('\\[')) segments.push({ kind: 'block', value: raw.slice(2, -2) });
    else if (raw.startsWith('\\(')) segments.push({ kind: 'inline', value: raw.slice(2, -2) });
    else segments.push({ kind: 'inline', value: raw.slice(1, -1) });
    last = start + raw.length;
  }
  if (last < text.length) segments.push({ kind: 'text', value: text.slice(last) });
  return segments;
}

export function MathText({ text, className }: { text: string; className?: string }) {
  const segments = useMemo(() => splitMathText(text), [text]);
  if (segments.every((segment) => segment.kind === 'text')) return <span className={className}>{text}</span>;
  return (
    <span className={className}>
      {segments.map((segment, index) => {
        if (segment.kind === 'text') return <span key={index}>{segment.value}</span>;
        const html = katex.renderToString(segment.value, { throwOnError: false, displayMode: segment.kind === 'block', output: 'html' });
        return (
          <span
            key={index}
            className={segment.kind === 'block' ? 'my-2 block overflow-x-auto' : 'inline-block max-w-full overflow-x-auto align-baseline'}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      })}
    </span>
  );
}
