/**
 * teach-response.test.tsx — teach 对话渲染层迁移（AI Elements）回归测试。
 *
 * 覆盖两个已核实的风险点 + 一个能力对齐点：
 * 1. CJK 加粗：CommonMark 侧翼规则会让 中文引号贴 ** 的加粗不解析；
 *    迁移前底座靠 remark-cjk-friendly，迁移后由 MessageResponse 内置的
 *    Streamdown cjk 插件通道兜底——两者必须等效（都渲染出加粗）。
 * 2. 半截 ``` 代码块流式兜底：Streamdown（remend）补全未闭合 fence，
 *    渲染为 code-block（data-incomplete="true"），不把原始 ``` 泄进正文。
 * 3. 数学公式：teach 面板在 MessageResponse 上追加 remark-math + rehype-katex，
 *    与迁移前 StreamingMarkdown 能力对齐。
 *
 * 用 renderToStaticMarkup（node 环境，不引 jsdom）：断言语义标签/属性而非样式。
 */

import { describe, it, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { defaultRehypePlugins, defaultRemarkPlugins } from 'streamdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message';
import { StreamingMarkdown } from '@/components/StreamingMarkdown';

/** 与 TeachChatPanel 一致的 math 插件链（默认链 + 追加） */
const TEACH_REMARK_PLUGINS = [...Object.values(defaultRemarkPlugins), remarkMath];
const TEACH_REHYPE_PLUGINS = [...Object.values(defaultRehypePlugins), rehypeKatex];

function renderResponse(children: string, withMath = false): string {
  return renderToStaticMarkup(
    <Message from="assistant">
      <MessageContent>
        <MessageResponse
          {...(withMath
            ? { remarkPlugins: TEACH_REMARK_PLUGINS, rehypePlugins: TEACH_REHYPE_PLUGINS }
            : {})}
        >
          {children}
        </MessageResponse>
      </MessageContent>
    </Message>
  );
}

describe('teach 渲染层迁移 · CJK 加粗（与底座 StreamingMarkdown 等效）', () => {
  const cases = [
    '中文的**"重点"**这里',
    '中文的**「重点」**这里',
    '注意**勾股定理**是核心',
    '这句话的**"临界点"**很关键，**第二个**加粗也要在',
  ];

  for (const text of cases) {
    it(`MessageResponse 解析加粗：${text}`, () => {
      const html = renderResponse(text);
      // Streamdown 把 strong 渲染为 data-streamdown="strong" 的语义等价节点
      expect(html).toContain('data-streamdown="strong"');
      // 不残留字面 **
      expect(html).not.toContain('**');
    });

    it(`底座 StreamingMarkdown 同样解析（对照组）：${text}`, () => {
      const html = renderToStaticMarkup(<StreamingMarkdown content={text} />);
      expect(html).toContain('<strong');
      expect(html).not.toContain('**');
    });
  }

  it('无 cjk 插件时该用例确实不解析（证明测试有效）', () => {
    // 直接调 Streamdown 裸原语（绕过 MessageResponse 的内置插件）
    return import('streamdown').then(({ Streamdown }) => {
      const html = renderToStaticMarkup(
        React.createElement(Streamdown, { mode: 'static' }, '中文的**"重点"**这里')
      );
      expect(html).toContain('**');
    });
  });
});

describe('teach 渲染层迁移 · 流式半截 markdown 兜底', () => {
  it('未闭合 ``` 代码块补全为 code-block，不泄字面 fence', () => {
    const html = renderResponse('看这段代码：\n\n```python\nprint("hello")\n');
    // remend 补全未闭合 fence → 走 code-block 渲染，语言头正确识别
    expect(html).toContain('data-streamdown="code-block"');
    expect(html).toContain('data-language="python"');
    // 原始 ``` 不能以文本形式出现在段落里
    expect(html).not.toMatch(/<p[^>]*>[^<]*```/);
  });

  it('闭合代码块正常渲染', () => {
    const html = renderResponse('看这段代码：\n\n```python\nprint("hello")\n```\n\n完了。');
    expect(html).toContain('data-streamdown="code-block"');
    expect(html).not.toContain('data-incomplete="true"');
    expect(html).toContain('完了。');
  });

  it('流式中途的行内文本原样输出', () => {
    const html = renderResponse('正在讲**杠杆原理**的前半句');
    expect(html).toContain('data-streamdown="strong"');
    expect(html).toContain('杠杆原理');
  });
});

describe('teach 渲染层迁移 · 数学公式（与迁移前能力对齐）', () => {
  it('行内 $ 公式渲染为 KaTeX', () => {
    const html = renderResponse('公式 $E=mc^2$ 很重要', true);
    expect(html).toContain('katex');
    expect(html).not.toContain('$E=mc^2$');
  });

  it('gfm 表格在默认链下仍可用（追加 math 不破坏默认插件）', () => {
    const html = renderResponse('| 概念 | 公式 |\n| --- | --- |\n| 能量 | $E$ |', true);
    expect(html).toContain('data-streamdown="table-wrapper"');
    expect(html).toContain('katex');
  });
});

describe('teach 渲染层迁移 · 消息壳', () => {
  it('user 消息走 vermilion-mist 气泡，文本原样保留', () => {
    const html = renderToStaticMarkup(
      <Message from="user">
        <MessageContent className="whitespace-pre-wrap break-words">
          {'第一行\n第二行'}
        </MessageContent>
      </Message>
    );
    expect(html).toContain('is-user');
    expect(html).toContain('bg-vermilion-mist');
    expect(html).toContain('第一行');
    expect(html).toContain('whitespace-pre-wrap');
  });
});
