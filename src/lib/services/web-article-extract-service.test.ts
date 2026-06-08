import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseOpenClawWechatResponse,
  htmlToText,
  extractWebArticle,
  WebArticleExtractError,
  getOpenClawConfig,
} from './web-article-extract-service';

describe('parseOpenClawWechatResponse', () => {
  it('parses standard title + blank line + body format', () => {
    const raw = '深度学习入门指南\n\n这是正文第一段，需要超过二十个字符才能被判定为有效内容。\n\n这是第二段，同样需要足够长。';
    const result = parseOpenClawWechatResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.title).toBe('深度学习入门指南');
    expect(result!.content).toBe('这是正文第一段，需要超过二十个字符才能被判定为有效内容。\n\n这是第二段，同样需要足够长。');
  });

  it('parses markdown bold title', () => {
    const raw = '**Transformer 架构详解**\n\n正文开始，这一段文字的长度必须超过二十个字符才不会被过滤掉。';
    const result = parseOpenClawWechatResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.title).toBe('Transformer 架构详解');
    expect(result!.content).toBe('正文开始，这一段文字的长度必须超过二十个字符才不会被过滤掉。');
  });

  it('parses explicit title marker', () => {
    const raw = '标题：PyTorch 快速上手\n\n正文内容在这里，这一段文字的长度必须超过二十个字符。';
    const result = parseOpenClawWechatResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.title).toBe('PyTorch 快速上手');
    expect(result!.content).toBe('正文内容在这里，这一段文字的长度必须超过二十个字符。');
  });

  it('skips prefix chitchat lines', () => {
    const raw = '好的\n已抓取\n\n**实际标题**\n\n正文内容需要超过二十个字符才能通过最低长度检查要求。';
    const result = parseOpenClawWechatResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.title).toBe('实际标题');
    expect(result!.content).toBe('正文内容需要超过二十个字符才能通过最低长度检查要求。');
  });

  it('uses first 60 chars as title when first line is超长', () => {
    const longLine = 'A'.repeat(150);
    expect(longLine.length).toBe(150);
    const raw = `${longLine}\n\n这是第二段正文，内容需要足够长才能通过二十个字符的最低长度检查要求。`;
    const result = parseOpenClawWechatResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.title).toBe(longLine.slice(0, 60));
    expect(result!.content).toContain('第二段');
  });

  it('returns null when body is too short', () => {
    const raw = '短标题\n\nhi';
    const result = parseOpenClawWechatResponse(raw);
    expect(result).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(parseOpenClawWechatResponse('')).toBeNull();
    expect(parseOpenClawWechatResponse('   \n   \n   ')).toBeNull();
  });

  it('strips leading separators from body', () => {
    const raw = '标题\n\n---\n\n正文第一段内容需要超过二十个字符才能通过最低长度检查。';
    const result = parseOpenClawWechatResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.content).toBe('正文第一段内容需要超过二十个字符才能通过最低长度检查。');
  });
});

describe('htmlToText', () => {
  it('removes script and style tags', () => {
    const html = '<script>alert(1)</script><p>正文</p><style>body{}</style>';
    expect(htmlToText(html)).toBe('正文');
  });

  it('converts br to newline', () => {
    const html = 'a<br>b<br/>c';
    expect(htmlToText(html)).toBe('a\nb\nc');
  });

  it('converts closing p to double newline', () => {
    const html = '<p>第一段</p><p>第二段</p>';
    expect(htmlToText(html)).toBe('第一段\n\n第二段');
  });

  it('decodes HTML entities', () => {
    const html = '&lt;div&gt;&amp;&nbsp;&quot;x&quot;&#39;y&#39;';
    expect(htmlToText(html)).toBe('<div>& "x"\'y\'');
  });

  it('collapses excessive whitespace', () => {
    const html = '<p>a</p>\n\n\n\n<p>b</p>';
    expect(htmlToText(html)).toBe('a\n\nb');
  });
});

describe('extractWebArticle fallback strategy', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OPENCLAW_GATEWAY_URL;
    delete process.env.OPENCLAW_TOKEN;
  });

  it('wechat-article: prefers OpenClaw and skips Jina when OpenClaw succeeds', async () => {
    process.env.OPENCLAW_GATEWAY_URL = 'https://gateway.example.com/v1/chat/completions';
    process.env.OPENCLAW_TOKEN = 'tk_test';
    expect(getOpenClawConfig().enabled).toBe(true);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '**微信文章标题**\n\n这是通过微信 Gateway 抓取的微信文章内容，长度必须超过五十个字符才能通过 extractWebArticle 的内容长度检查要求。' } }],
      }),
    }));

    const result = await extractWebArticle(
      'https://mp.weixin.qq.com/s/xxx',
      'wechat-article',
      '微信公众号'
    );

    expect(result.extractMethod).toBe('openclaw');
    expect(result.title).toBe('微信文章标题');
    expect(result.content).toContain('微信 Gateway');
  });

  it('wechat-article: falls back to Jina when OpenClaw is disabled', async () => {
    // no OPENCLAW env set
    expect(getOpenClawConfig().enabled).toBe(false);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => 'Title: Jina Title\nURL Source: https://mp.weixin.qq.com/s/xxx\nMarkdown Content:\n正文来自 Jina Reader，内容必须足够长，超过五十个字符才不会被判定为空壳页面，所以继续补充文字长度。',
    }));

    const result = await extractWebArticle(
      'https://mp.weixin.qq.com/s/xxx',
      'wechat-article',
      '微信公众号'
    );

    expect(result.extractMethod).toBe('jina');
    expect(result.title).toBe('Jina Title');
  });

  it('wechat-article: falls back to direct fetch when OpenClaw and Jina both fail', async () => {
    process.env.OPENCLAW_GATEWAY_URL = 'https://gateway.example.com/v1/chat/completions';
    process.env.OPENCLAW_TOKEN = 'tk_test';

    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: string | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('gateway.example.com')) {
        return { ok: false, status: 502 };
      }
      if (url.startsWith('https://r.jina.ai/')) {
        return { ok: false, status: 429 };
      }
      // direct fetch to mp.weixin.qq.com
      if (url.includes('mp.weixin.qq.com')) {
        return {
          ok: true,
          text: async () => '<html><head><title>直接抓取标题</title></head><body><script>var msg_title = "直接抓取标题";</script><div id="js_content" class="rich_media_content">直接抓取正文内容必须超过五十个字符才能被判定为有效提取结果，所以继续补充文字长度直到满足所有检查要求。' + 'x'.repeat(300) + '</div><script></script></body></html>',
        };
      }
      return { ok: false, status: 500 };
    }));

    const result = await extractWebArticle(
      'https://mp.weixin.qq.com/s/xxx',
      'wechat-article',
      '微信公众号'
    );

    expect(result.extractMethod).toBe('direct');
    expect(result.title).toBe('直接抓取标题');
    expect(result.content).toContain('直接抓取正文');
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(3);
  });

  it('non-wechat article never calls OpenClaw', async () => {
    process.env.OPENCLAW_GATEWAY_URL = 'https://gateway.example.com/v1/chat/completions';
    process.env.OPENCLAW_TOKEN = 'tk_test';

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => 'Title: 知乎文章\nMarkdown Content:\n正文内容必须超过五十个字符才不会被 Jina Reader 判定为空壳页面而拒绝使用，所以继续补充文字长度。',
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await extractWebArticle(
      'https://zhuanlan.zhihu.com/p/123',
      'zhihu',
      '知乎'
    );

    expect(result.extractMethod).toBe('jina');
    // OpenClaw should not be called for non-wechat
    const openclawCalls = mockFetch.mock.calls.filter(
      ([url]) => typeof url === 'string' && url.includes('gateway.example.com')
    );
    expect(openclawCalls).toHaveLength(0);
  });

  it('throws WebArticleExtractError when all strategies fail', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    }));

    await expect(
      extractWebArticle('https://example.com/x', 'generic', '网页')
    ).rejects.toThrow(WebArticleExtractError);
  });
});
