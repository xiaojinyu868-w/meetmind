/**
 * 通用网页文章提取服务
 *
 * 支持从微信公众号、小红书、知乎等图文平台提取正文内容。
 *
 * 提取策略（按优先级）：
 * 1. OpenClaw Gateway（仅微信文章）— 通过真实微信客户端环境 + MicroMessenger UA 绕过反爬
 * 2. Jina Reader API（r.jina.ai）— 自带反爬能力，返回 Markdown
 * 3. 直接 fetch HTML + 本地解析 — 适合无反爬的平台
 *
 * 平台适配说明：
 * - 微信公众号：OpenClaw Gateway 优先 → Jina Reader → 本地 fetch（weui-msg 反爬严格）
 * - 小红书：Jina Reader → 本地 fetch（需 xsec_token）
 * - 通用网页：Jina Reader → 本地通用 HTML 解析
 */

import { createLogger } from '@/lib/logger';
const log = createLogger('web-article-extract');

export class WebArticleExtractError extends Error {
  code: string;
  detail?: string;

  constructor(code: string, message: string, detail?: string) {
    super(message);
    this.name = 'WebArticleExtractError';
    this.code = code;
    this.detail = detail;
  }
}

export interface ExtractedArticle {
  title: string;
  content: string;          // Markdown 正文
  description?: string;     // 摘要描述
  author?: string;          // 作者/公众号名
  publishedAt?: string;     // 发布时间
  coverUrl?: string;        // 封面图
  imageUrls?: string[];     // 正文中的图片
  sourceUrl: string;        // 原始链接
  provider: string;         // 来源平台 ID
  providerLabel: string;    // 来源平台名
  extractMethod: 'jina' | 'direct' | 'openclaw' | 'fallback';
  wordCount: number;        // 字数
}

const JINA_READER_BASE = 'https://r.jina.ai/';
const EXTRACT_TIMEOUT_MS = Number.parseInt(
  process.env.WEB_ARTICLE_EXTRACT_TIMEOUT_MS || '30000', 10
);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

// OpenClaw Gateway（用于绕过微信公众号反爬）
const OPENCLAW_GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || '';
const OPENCLAW_TOKEN = process.env.OPENCLAW_TOKEN || '';
const OPENCLAW_ENABLED = Boolean(OPENCLAW_GATEWAY_URL && OPENCLAW_TOKEN);

/**
 * 通过 Jina Reader API 提取网页内容为 Markdown。
 */
async function extractViaJina(
  url: string
): Promise<{ title: string; content: string; rawMarkdown: string } | null> {
  const jinaUrl = `${JINA_READER_BASE}${url}`;
  const timeoutMs = Math.max(10000, Math.min(60000, EXTRACT_TIMEOUT_MS));

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(jinaUrl, {
      headers: {
        'Accept': 'text/plain',
        'X-Return-Format': 'markdown',
        'X-With-Images': 'true',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      log.warn(`[web-article-extract] Jina Reader HTTP ${response.status} for ${url}`);
      return null;
    }

    const text = await response.text();
    if (!text || text.length < 50) {
      log.warn(`[web-article-extract] Jina Reader returned too short content (${text.length} chars)`);
      return null;
    }

    // Jina 返回格式：Title: ...\nURL Source: ...\nMarkdown Content:\n...
    const titleMatch = text.match(/^Title:\s*(.+)$/m);
    const title = titleMatch?.[1]?.trim() || '';

    // 提取 Markdown Content 之后的部分
    const contentStart = text.indexOf('Markdown Content:');
    const content = contentStart >= 0
      ? text.slice(contentStart + 'Markdown Content:'.length).trim()
      : text;

    // 过滤无意义内容
    if (isUselessContent(content)) {
      log.warn(`[web-article-extract] Jina returned useless content for ${url}`);
      return null;
    }

    return { title, content, rawMarkdown: text };
  } catch (error) {
    if ((error as { name?: string })?.name === 'AbortError') {
      log.warn(`[web-article-extract] Jina Reader timeout for ${url}`);
    } else {
      log.warn(`[web-article-extract] Jina Reader error for ${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 通过 OpenClaw Gateway 提取微信公众号文章正文。
 * 利用对方真实的微信客户端环境 + MicroMessenger UA 绕过反爬。
 * 仅用于 wechat-article 平台，且需要 OPENCLAW_GATEWAY_URL 和 OPENCLAW_TOKEN 环境变量。
 */
async function extractViaOpenClaw(
  url: string
): Promise<{ title: string; content: string } | null> {
  if (!OPENCLAW_ENABLED) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120_000); // 120s，Gateway 端 curl+LLM 约 15-30s

  try {
    const response = await fetch(OPENCLAW_GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENCLAW_TOKEN}`,
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true',
      },
      body: JSON.stringify({
        model: 'openclaw',
        messages: [
          {
            role: 'user',
            content:
              `请用MicroMessenger UA抓取这篇微信文章的正文。要求：\n` +
              `1. 用curl加MicroMessenger的User-Agent抓取HTML\n` +
              `2. 从var msg_title提取标题，从js_content div提取正文\n` +
              `3. 返回格式：第一行标题，空一行，正文纯文本\n` +
              `4. 不要加任何其他说明\n` +
              `文章URL：${url}`,
          },
        ],
        temperature: 0.1,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      log.warn(
        `[web-article-extract] OpenClaw Gateway HTTP ${response.status} for ${url}`
      );
      return null;
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const rawContent = data?.choices?.[0]?.message?.content?.trim() || '';

    if (rawContent.length < 50) {
      log.warn(
        `[web-article-extract] OpenClaw returned too short content (${rawContent.length} chars) for ${url}`
      );
      return null;
    }

    // 解析返回的「标题\n\n正文」格式
    const parsed = parseOpenClawWechatResponse(rawContent);
    if (!parsed || parsed.content.length < 20) {
      log.warn(
        `[web-article-extract] OpenClaw parsed content too short for ${url}`
      );
      return null;
    }

    return parsed;
  } catch (error) {
    if ((error as { name?: string })?.name === 'AbortError') {
      log.warn(`[web-article-extract] OpenClaw Gateway timeout for ${url}`);
    } else {
      log.warn(
        `[web-article-extract] OpenClaw Gateway error for ${url}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 解析 OpenClaw Gateway 返回的微信文章文本。
 * 预期格式：标题行 + 空行 + 正文，可能带有 Markdown 加粗/分隔线。
 */
function parseOpenClawWechatResponse(raw: string): { title: string; content: string } | null {
  const lines = raw.split('\n');

  let title = '';
  let bodyStartIdx = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // 跳过可能的前缀说明行（如 "好的"、"已抓取"）
    if (/^(好的|已抓取|OK|Here|Title|标题)[：:.，,;；]*/i.test(line) && line.length < 30) {
      continue;
    }

    // 如果当前行是标题标记行，取下一行非空内容作为标题
    if (/^(Title|标题)[：:]\s*/i.test(line)) {
      const clean = line.replace(/^\*?\*?(Title|标题)[：:]\s*\*?\*?/i, '').trim();
      if (clean) {
        title = clean;
        bodyStartIdx = i + 1;
        break;
      }
      continue;
    }

    // Markdown 加粗行通常就是标题
    if (/^\*\*(.+?)\*\*$/.test(line) && line.length < 120) {
      title = line.replace(/^\*\*|\*\*$/g, '').trim();
      bodyStartIdx = i + 1;
      break;
    }

    // 第一行有意义的非空内容且不太长，视为标题
    if (line.length > 0 && line.length < 120) {
      title = line;
      bodyStartIdx = i + 1;
      break;
    }

    // 第一行就超过 120 字符，可能整个内容没有标题行，取前 60 字符做标题
    if (line.length >= 120) {
      title = line.slice(0, 60);
      bodyStartIdx = i;
      break;
    }
  }

  if (!title) return null;

  // 收集正文：从 bodyStartIdx 开始，跳过开头的空行和分隔线
  const bodyLines: string[] = [];
  let started = false;
  for (let i = bodyStartIdx; i < lines.length; i++) {
    const line = lines[i];
    if (!started && (line.trim() === '' || line.trim() === '---')) continue;
    started = true;
    bodyLines.push(line);
  }

  const content = bodyLines.join('\n').trim();
  if (content.length < 20) return null;

  return { title, content };
}

/**
 * 直接 fetch HTML 并本地解析正文。
 * 适用于无反爬或反爬较弱的平台。
 */
async function extractViaDirect(
  url: string,
  provider: string
): Promise<{ title: string; content: string; author?: string } | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
      redirect: 'follow',
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const html = await response.text();
    if (html.length < 500) return null;

    // 微信公众号特殊处理
    if (provider === 'wechat-article') {
      return parseWechatArticleHtml(html);
    }

    // 小红书特殊处理
    if (provider === 'xiaohongshu') {
      return parseXiaohongshuHtml(html);
    }

    // 通用 HTML → 纯文本
    return parseGenericHtml(html);
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 解析微信公众号文章 HTML。
 * 微信文章结构：
 * - var msg_title = "..."; / <h1 class="rich_media_title">
 * - <div id="js_content" class="rich_media_content">...
 * - var nickname = "..."; （公众号名称）
 */
function parseWechatArticleHtml(html: string): { title: string; content: string; author?: string } | null {
  // 如果是 weui-msg 错误页面，直接返回 null
  if (html.includes('weui-msg') && !html.includes('rich_media_content')) {
    return null;
  }

  // 提取标题
  let title = '';
  const titleMatch = html.match(/var\s+msg_title\s*=\s*['"](.+?)['"]\s*[;\n]/)
    || html.match(/<h1[^>]*class="rich_media_title"[^>]*>([\s\S]*?)<\/h1>/);
  if (titleMatch) {
    title = titleMatch[1].replace(/<[^>]+>/g, '').trim();
  }

  // 提取公众号名称
  let author: string | undefined;
  const nicknameMatch = html.match(/var\s+nickname\s*=\s*['"](.+?)['"]\s*[;\n]/)
    || html.match(/profile_nickname\s*=\s*['"](.+?)['"]/);
  if (nicknameMatch) {
    author = nicknameMatch[1].trim();
  }

  // 提取正文
  const contentMatch = html.match(
    /id="js_content"[^>]*>([\s\S]*?)(?:<\/div>\s*<(?:script|div\s+class="rich_media_tool"))/
  );
  if (!contentMatch) return null;

  const content = htmlToText(contentMatch[1]);
  if (content.length < 20) return null;

  return { title, content, author };
}

/**
 * 解析小红书笔记 HTML。
 * 小红书页面是 CSR，但 __INITIAL_STATE__ 中可能有笔记数据。
 */
function parseXiaohongshuHtml(html: string): { title: string; content: string } | null {
  // 检查是否被重定向到 404/安全检查
  if (html.includes('/404/sec_') || html.includes('error_code=300031')) {
    return null;
  }

  // 提取 __INITIAL_STATE__
  const stateMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*({[\s\S]+?})\s*<\/script>/);
  if (!stateMatch) return null;

  try {
    const raw = stateMatch[1].replace(/\\u002F/g, '/').replace(/undefined/g, 'null');
    const data = JSON.parse(raw);
    const noteMap = data?.note?.noteDetailMap;
    if (!noteMap) return null;

    for (const nval of Object.values(noteMap)) {
      const n = (nval as Record<string, unknown>)?.note as Record<string, unknown> | undefined;
      if (!n) continue;

      const title = (n.title as string) || '';
      const desc = (n.desc as string) || '';
      const content = [title, desc].filter(Boolean).join('\n\n');
      if (content.length < 10) continue;

      return { title: title || '小红书笔记', content };
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * 通用 HTML 解析。
 */
function parseGenericHtml(html: string): { title: string; content: string } | null {
  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/);
  const title = titleMatch ? titleMatch[1].trim() : '';

  // 尝试找 article/main 标签
  const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/)
    || html.match(/<main[^>]*>([\s\S]*?)<\/main>/);

  const rawContent = articleMatch ? articleMatch[1] : html;
  const content = htmlToText(rawContent);

  if (content.length < 50) return null;
  return { title, content };
}

/**
 * 简单的 HTML → 纯文本转换。
 */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/**
 * 从 Markdown 中提取图片 URL。
 */
function extractImageUrls(markdown: string): string[] {
  const urls: string[] = [];
  const imgPattern = /!\[.*?\]\((.+?)\)/g;
  let match;
  while ((match = imgPattern.exec(markdown)) !== null) {
    if (match[1] && match[1].startsWith('http')) {
      urls.push(match[1]);
    }
  }
  return urls;
}

/**
 * 判断提取的内容是否无意义（错误页面、验证页面等）。
 */
function isUselessContent(content: string): boolean {
  const lower = content.toLowerCase();
  const uselessPatterns = [
    'parameter error',
    '环境异常',
    '请完成验证',
    '请在微信客户端打开',
    '该内容已被发布者删除',
    'page not found',
    '当前笔记暂时无法浏览',
  ];
  // 如果正文非常短，并且匹配到无意义模式
  if (content.length < 200) {
    for (const p of uselessPatterns) {
      if (lower.includes(p.toLowerCase())) return true;
    }
  }
  return false;
}

/**
 * Markdown → 纯文本（移除 Markdown 语法）。
 */
function markdownToPlainText(md: string): string {
  return md
    .replace(/!\[.*?\]\(.*?\)/g, '')           // 图片
    .replace(/\[([^\]]+)\]\(.*?\)/g, '$1')     // 链接
    .replace(/#{1,6}\s+/g, '')                 // 标题
    .replace(/[*_]{1,3}(.+?)[*_]{1,3}/g, '$1') // 加粗/斜体
    .replace(/`{1,3}[^`]*`{1,3}/g, '')         // 代码
    .replace(/^[-*+]\s+/gm, '')                // 列表
    .replace(/^\d+\.\s+/gm, '')                // 有序列表
    .replace(/^>\s+/gm, '')                    // 引用
    .replace(/---+/g, '')                      // 分隔线
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 主入口：提取网页文章内容。
 *
 * @param url - 文章 URL
 * @param provider - 平台 ID（如 'wechat-article', 'xiaohongshu', 'zhihu'）
 * @param providerLabel - 平台名称
 */
export async function extractWebArticle(
  url: string,
  provider: string,
  providerLabel: string
): Promise<ExtractedArticle> {

  // 微信公众号：优先走 OpenClaw Gateway（绕过微信反爬）
  if (provider === 'wechat-article') {
    const openclawResult = await extractViaOpenClaw(url);
    if (openclawResult && openclawResult.content.length > 50) {
      return {
        title: openclawResult.title,
        content: openclawResult.content,
        description: openclawResult.content.slice(0, 200),
        sourceUrl: url,
        provider,
        providerLabel,
        extractMethod: 'openclaw',
        wordCount: openclawResult.content.length,
      };
    }
  }

  // 策略 1: Jina Reader
  const jinaResult = await extractViaJina(url);
  if (jinaResult && jinaResult.content.length > 50) {
    const plainText = markdownToPlainText(jinaResult.content);
    const imageUrls = extractImageUrls(jinaResult.content);

    return {
      title: jinaResult.title,
      content: jinaResult.content,
      description: plainText.slice(0, 200),
      imageUrls,
      sourceUrl: url,
      provider,
      providerLabel,
      extractMethod: 'jina',
      wordCount: plainText.length,
    };
  }

  // 策略 2: 直接 fetch + 本地解析
  const directResult = await extractViaDirect(url, provider);
  if (directResult && directResult.content.length > 50) {

    return {
      title: directResult.title,
      content: directResult.content,
      description: directResult.content.slice(0, 200),
      author: directResult.author,
      sourceUrl: url,
      provider,
      providerLabel,
      extractMethod: 'direct',
      wordCount: directResult.content.length,
    };
  }

  // 全部失败
  throw new WebArticleExtractError(
    'ARTICLE_EXTRACT_FAILED',
    `无法提取文章内容`,
    `url: ${url}, provider: ${provider}, openclaw: ${provider === 'wechat-article' ? (OPENCLAW_ENABLED ? 'failed' : 'disabled') : 'skipped'}, jina: ${jinaResult ? 'empty' : 'failed'}, direct: ${directResult ? 'empty' : 'failed'}`
  );
}
