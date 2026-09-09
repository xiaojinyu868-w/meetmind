import { describe, expect, it } from 'vitest';
import {
  buildClipGroupKey,
  buildPocketCaptureInput,
  buildPocketClipDraft,
  deriveClipTitle,
  describeClipSource,
  htmlToMarkdown,
  markdownToPlain,
} from './pocket-clip-service';

/** ChatGPT 网页真实结构的缩影：KaTeX 公式 + 带工具条的代码块 + 复制按钮 */
const CHATGPT_HTML = `
<div class="markdown prose">
  <p>条件概率的定义是 <span class="katex"><span class="katex-mathml"><math><semantics><mrow></mrow><annotation encoding="application/x-tex">P(A\\mid B)=\\frac{P(A\\cap B)}{P(B)}</annotation></semantics></math></span><span class="katex-html" aria-hidden="true"><span class="base">P(A∣B)=P(B)P(A∩B)</span></span></span>，注意分母。</p>
  <span class="katex-display"><span class="katex"><span class="katex-mathml"><math><semantics><mrow></mrow><annotation encoding="application/x-tex">P(A\\mid B)=\\frac{P(B\\mid A)P(A)}{P(B)}</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">P(A∣B)=…</span></span></span>
  <pre class="overflow-visible!"><div class="contain-inline-size rounded-2xl"><div class="flex items-center">python</div><div class="sticky"><button aria-label="复制"><svg></svg>复制代码</button></div><div class="overflow-y-auto"><code class="whitespace-pre! language-python">def bayes(pa, pb, pba):
    return pba * pa / pb
</code></div></div></pre>
  <ul><li><strong>先验</strong> P(A)</li><li>似然 P(B|A)</li></ul>
  <table><thead><tr><th>符号</th><th>含义</th></tr></thead><tbody><tr><td>P(A)</td><td>先验</td></tr></tbody></table>
</div>`;

describe('htmlToMarkdown', () => {
  it('抓回 KaTeX 的原始 TeX：行内 $…$、块级 $$…$$', () => {
    const { markdown, hasMath } = htmlToMarkdown(CHATGPT_HTML);
    expect(hasMath).toBe(true);
    expect(markdown).toContain('$P(A\\mid B)=\\frac{P(A\\cap B)}{P(B)}$');
    expect(markdown).toContain('$$\nP(A\\mid B)=\\frac{P(B\\mid A)P(A)}{P(B)}\n$$');
    // 可见的伪文本（katex-html）不应重复出现
    expect(markdown).not.toContain('P(B)P(A∩B)');
  });

  it('ChatGPT 带工具条的 <pre> 也能出带语言的围栏代码块，「复制代码」不残留', () => {
    const { markdown } = htmlToMarkdown(CHATGPT_HTML);
    expect(markdown).toContain('```python\ndef bayes(pa, pb, pba):\n    return pba * pa / pb\n```');
    expect(markdown).not.toContain('复制代码');
    expect(markdown).not.toMatch(/^python$/m);
  });

  it('保留列表、加粗与表格', () => {
    const { markdown } = htmlToMarkdown(CHATGPT_HTML);
    expect(markdown).toContain('- **先验** P(A)');
    expect(markdown).toContain('| 符号 | 含义 |');
    expect(markdown).toContain('| P(A) | 先验 |');
  });

  it('空 / 非法输入返回空串而不抛', () => {
    expect(htmlToMarkdown('')).toEqual({ markdown: '', hasMath: false });
    expect(htmlToMarkdown('   ').markdown).toBe('');
  });
});

describe('markdownToPlain', () => {
  it('去掉标记只留可读文本', () => {
    expect(markdownToPlain('# 标题\n\n- **重点** 内容\n\n```py\nx = 1\n```\n\n$$a^2$$')).toBe('标题\n重点 内容\nx = 1\na^2');
  });
});

describe('describeClipSource', () => {
  it('浏览器网址映射成用户认得的名字', () => {
    expect(describeClipSource({ app: 'Google Chrome', url: 'https://chatgpt.com/c/abc' })).toEqual({ label: 'ChatGPT', platformId: 'chatgpt' });
    expect(describeClipSource({ url: 'https://claude.ai/chat/1' }).label).toBe('Claude');
    expect(describeClipSource({ url: 'https://www.bilibili.com/video/BV1' }).label).toBe('B站');
    expect(describeClipSource({ url: 'https://example.org/a' })).toEqual({ label: 'example.org', platformId: 'web' });
  });

  it('没有网址时用应用名（长进程名收短）', () => {
    expect(describeClipSource({ app: 'Microsoft Word' }).label).toBe('Word');
    expect(describeClipSource({ app: 'WeChat' }).label).toBe('微信');
    expect(describeClipSource({ app: 'Zotero' }).label).toBe('Zotero');
    expect(describeClipSource(undefined).label).toBe('桌面');
  });
});

describe('deriveClipTitle', () => {
  it('第一句够具体就用第一句，按显示宽度截', () => {
    expect(deriveClipTitle('条件概率的分母是 P(B)，不是 P(A)。后面还有。', undefined)).toBe('条件概率的分母是 P(B)，不是 P(A)');
    expect(deriveClipTitle('机器学习中的过拟合是指模型在训练集上表现很好但在测试集上表现差', undefined).endsWith('…')).toBe(true);
  });

  it('第一句太短就用来源页标题（去掉 " - ChatGPT" 之类后缀）', () => {
    expect(deriveClipTitle('好的', { pageTitle: '贝叶斯公式推导 - ChatGPT' })).toBe('贝叶斯公式推导');
  });
});

describe('buildClipGroupKey', () => {
  it('同一网址（忽略 query）30 分钟内同组，跨窗不同组', () => {
    const t0 = new Date('2026-09-09T10:00:00Z');
    const t1 = new Date('2026-09-09T10:20:00Z');
    const t2 = new Date('2026-09-09T11:10:00Z');
    const a = buildClipGroupKey({ url: 'https://chatgpt.com/c/abc?x=1' }, t0);
    const b = buildClipGroupKey({ url: 'https://chatgpt.com/c/abc?x=2' }, t1);
    const c = buildClipGroupKey({ url: 'https://chatgpt.com/c/abc' }, t2);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('buildPocketClipDraft / buildPocketCaptureInput', () => {
  it('HTML 优先，网址不进 sourceUrl 而进 metadata.pocket（避免被链接去重覆盖）', () => {
    const draft = buildPocketClipDraft({
      text: '条件概率的定义是 P(A|B)=P(A∩B)/P(B)，注意分母。',
      html: CHATGPT_HTML,
      source: { app: 'Google Chrome', url: 'https://chatgpt.com/c/abc', pageTitle: '贝叶斯 - ChatGPT' },
      occurredAt: '2026-09-09T10:00:00Z',
    });
    expect(draft).not.toBeNull();
    expect(draft!.hasMath).toBe(true);
    expect(draft!.sourceLabel).toBe('ChatGPT');
    const input = buildPocketCaptureInput(draft!, { occurredAt: new Date('2026-09-09T10:00:00Z'), clientId: 'abc-123' });
    expect(input.sourceType).toBe('desktop-clip');
    expect(input.sourceKey).toBe('clip-abc-123');
    expect(input.sourceUrl).toBeUndefined();
    const pocket = (input.metadata as { pocket: { source: { url: string }; groupKey: string } }).pocket;
    expect(pocket.source.url).toBe('https://chatgpt.com/c/abc');
    expect(pocket.groupKey).toContain('chatgpt.com/c/abc');
    const provenance = (input.metadata as { provenance: { platformLabel: string; contentState: string } }).provenance;
    expect(provenance.platformLabel).toBe('ChatGPT');
    expect(provenance.contentState).toBe('complete');
  });

  it('HTML 转出来明显残缺时以纯文本为准；两者都空返回 null', () => {
    const draft = buildPocketClipDraft({ text: '这是一段很长的纯文本说明，HTML 里只有一个按钮。'.repeat(3), html: '<button>复制</button>' });
    expect(draft!.markdown.startsWith('这是一段很长的纯文本')).toBe(true);
    expect(buildPocketClipDraft({ text: '', html: '<svg></svg>' })).toBeNull();
  });
});
