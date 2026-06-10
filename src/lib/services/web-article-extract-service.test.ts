import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseOpenClawWechatResponse,
  htmlToText,
  extractWebArticle,
  markdownToPlainText,
  WebArticleExtractError,
  getOpenClawConfig,
  getFirecrawlConfig,
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
    delete process.env.FIRECRAWL_API_KEY;
  });

  it('wechat-article: prefers Firecrawl and skips OpenClaw when Firecrawl succeeds', async () => {
    process.env.FIRECRAWL_API_KEY = 'fc_test_key';
    process.env.OPENCLAW_GATEWAY_URL = 'https://gateway.example.com/v1/chat/completions';
    process.env.OPENCLAW_TOKEN = 'tk_test';
    expect(getFirecrawlConfig().enabled).toBe(true);
    expect(getOpenClawConfig().enabled).toBe(true);

    const mockFetch = vi.fn().mockImplementation(async (input: string | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('api.firecrawl.dev')) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: {
              markdown: '# Firecrawl 微信标题\n\n这是通过 Firecrawl 抓取的微信文章内容，长度必须超过五十个字符才能通过 extractWebArticle 的内容长度检查要求，所以继续补充文字长度。',
              metadata: { title: 'Firecrawl 微信标题' },
            },
          }),
        };
      }
      return { ok: false, status: 500 };
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await extractWebArticle(
      'https://mp.weixin.qq.com/s/xxx',
      'wechat-article',
      '微信公众号'
    );

    expect(result.extractMethod).toBe('firecrawl');
    expect(result.title).toBe('Firecrawl 微信标题');
    expect(result.content).toContain('Firecrawl 抓取');
    // OpenClaw should not be called when Firecrawl succeeds
    const openclawCalls = mockFetch.mock.calls.filter(
      ([url]) => typeof url === 'string' && url.includes('gateway.example.com')
    );
    expect(openclawCalls).toHaveLength(0);
  });

  it('wechat-article: falls back to OpenClaw when Firecrawl is disabled', async () => {
    // no FIRECRAWL env set
    expect(getFirecrawlConfig().enabled).toBe(false);
    process.env.OPENCLAW_GATEWAY_URL = 'https://gateway.example.com/v1/chat/completions';
    process.env.OPENCLAW_TOKEN = 'tk_test';

    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: string | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('gateway.example.com')) {
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: '**微信文章标题**\n\n这是通过微信 Gateway 抓取的微信文章内容，长度必须超过五十个字符才能通过 extractWebArticle 的内容长度检查要求。' } }],
          }),
        };
      }
      return { ok: false, status: 500 };
    }));

    const result = await extractWebArticle(
      'https://mp.weixin.qq.com/s/xxx',
      'wechat-article',
      '微信公众号'
    );

    expect(result.extractMethod).toBe('openclaw');
    expect(result.title).toBe('微信文章标题');
  });

  it('wechat-article: falls back to Jina when Firecrawl and OpenClaw both fail', async () => {
    process.env.FIRECRAWL_API_KEY = 'fc_test_key';
    process.env.OPENCLAW_GATEWAY_URL = 'https://gateway.example.com/v1/chat/completions';
    process.env.OPENCLAW_TOKEN = 'tk_test';

    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: string | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('api.firecrawl.dev')) {
        return { ok: false, status: 429 };
      }
      if (url.includes('gateway.example.com')) {
        return { ok: false, status: 502 };
      }
      if (url.startsWith('https://r.jina.ai/')) {
        return {
          ok: true,
          text: async () => 'Title: Jina Title\nURL Source: https://mp.weixin.qq.com/s/xxx\nMarkdown Content:\n正文来自 Jina Reader，内容必须足够长，超过五十个字符才不会被判定为空壳页面，所以继续补充文字长度。',
        };
      }
      return { ok: false, status: 500 };
    }));

    const result = await extractWebArticle(
      'https://mp.weixin.qq.com/s/xxx',
      'wechat-article',
      '微信公众号'
    );

    expect(result.extractMethod).toBe('jina');
    expect(result.title).toBe('Jina Title');
  });

  it('wechat-article: falls back to direct fetch when Firecrawl, OpenClaw and Jina all fail', async () => {
    process.env.FIRECRAWL_API_KEY = 'fc_test_key';
    process.env.OPENCLAW_GATEWAY_URL = 'https://gateway.example.com/v1/chat/completions';
    process.env.OPENCLAW_TOKEN = 'tk_test';

    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: string | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('api.firecrawl.dev')) {
        return { ok: false, status: 429 };
      }
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
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(4);
  });

  it('non-wechat article: prefers Firecrawl then Jina, never calls OpenClaw', async () => {
    process.env.FIRECRAWL_API_KEY = 'fc_test_key';
    process.env.OPENCLAW_GATEWAY_URL = 'https://gateway.example.com/v1/chat/completions';
    process.env.OPENCLAW_TOKEN = 'tk_test';

    const mockFetch = vi.fn().mockImplementation(async (input: string | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('api.firecrawl.dev')) {
        return { ok: false, status: 429 };
      }
      if (url.startsWith('https://r.jina.ai/')) {
        return {
          ok: true,
          text: async () => 'Title: 知乎文章\nMarkdown Content:\n正文内容必须超过五十个字符才不会被 Jina Reader 判定为空壳页面而拒绝使用，所以继续补充文字长度。',
        };
      }
      return { ok: false, status: 500 };
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

describe('markdownToPlainText', () => {
  it('removes markdown images and links', () => {
    const md = '![alt](https://example.com/img.png)\n[link text](https://example.com)';
    expect(markdownToPlainText(md)).toBe('link text');
  });

  it('removes multi-line markdown images (wechat svg garbage)', () => {
    const md = `![cover](data:image/svg+xml,%3Csvg%20xmlns='...'%3E%3Cg%3E%3Crect%20x='249'%20y='126'%20width='1'%20height='1'%20fill='%23FFFFFF'%3E%3C/rect%3E%3C/g%3E%3C/svg%3E)\n\n正文段落。`;
    const result = markdownToPlainText(md);
    expect(result).toContain('正文段落');
    expect(result).not.toContain('rect');
    expect(result).not.toContain('fill=');
    expect(result).not.toContain('%3C');
  });

  it('removes url-encoded html/svg tags', () => {
    const md = `团队荣耀%3Csvg%3E%3Cg%3E%3C/g%3E%3C/svg%3E根据队伍数据统计。`;
    expect(markdownToPlainText(md)).toBe('团队荣耀根据队伍数据统计。');
  });

  it('removes html entities', () => {
    const md = 'Hello&nbsp;World&mdash;test';
    expect(markdownToPlainText(md)).toBe('Hello World test');
  });

  it('removes inline svg attributes', () => {
    const md = `文本 fill='%23FFFFFF' width='1' height='1' 后续内容。`;
    expect(markdownToPlainText(md)).toBe('文本 后续内容。');
  });

  it('removes standard html tags', () => {
    const md = '<div>Hello</div>\n\n<p>World</p>';
    expect(markdownToPlainText(md)).toBe('Hello\n\nWorld');
  });

  it('removes data URIs', () => {
    const md = 'prefix data:image/png;base64,ABC123== suffix';
    expect(markdownToPlainText(md)).toBe('prefix suffix');
  });
});
