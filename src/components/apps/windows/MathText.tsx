'use client';

/**
 * MathText — 一段可能夹着 TeX 的短文本（闪卡正反面、测验题干、上课舞台的字幕 / 提问卡 / 课堂记录这类"一句话"），
 * `$…$` / `\(…\)` 行内公式与 `$$…$$` / `\[…\]` 块公式用 KaTeX 渲染，其余原样输出。
 * 不走 react-markdown：牌面不需要段落 / 列表语义，也不想为一行字引入整条 markdown 管线。
 * 渲染失败（throwOnError: false）退回原文，不让一张卡因为公式写错而空白。
 *
 * 2026-09-11：切分逻辑移到 `lib/utils/math-text.ts`（朗读转换 latexToSpeech 与它共用），并多识别两种情况——
 * 没写 $ 的裸 LaTeX（`\frac{1}{2}mv^2`）也当公式；`$5 和 $10` 这种货币不再被当成公式。
 */

import { useMemo } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { expandColorMacros, splitMathText } from '@/lib/utils/math-text';

export { splitMathText };

export function MathText({ text, className }: { text: string; className?: string }) {
  const segments = useMemo(() => splitMathText(text), [text]);
  if (segments.every((segment) => segment.kind === 'text')) return <span className={className}>{text}</span>;
  return (
    <span className={className}>
      {segments.map((segment, index) => {
        if (segment.kind === 'text') return <span key={index}>{segment.value}</span>;
        const html = katex.renderToString(expandColorMacros(segment.value), { throwOnError: false, strict: 'ignore', displayMode: segment.kind === 'block', output: 'html' });
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
