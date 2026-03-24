/**
 * 通用网页文章提取服务
 *
 * 支持从微信公众号、小红书、知乎等图文平台提取正文内容。
 *
 * 提取策略（按优先级）：
 * 1. Jina Reader API（r.jina.ai）— 自带反爬能力，返回 Markdown
 * 2. 直接 fetch HTML + 本地解析 — 适合无反爬的平台
 *
 * 为什么用 Jina Reader：
 * - 微信公众号：服务端直接 fetch 返回空白 weui-msg 页面（严格反爬）
 * - 小红书：服务端直接 fetch 被 302 到安全检查页（需 xsec_token）
 * - Jina Reader 通过 headless browser 绕过反爬，返回干净的 Markdown
 */

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
  extractMethod: 'jina' | 'direct' | 'fallback';
  wordCount: number;        // 字数
}

const JINA_READER_BASE = 'https://r.jina.ai/';
const EXTRACT_TIMEOUT_MS = Number.parseInt(
  process.env.WEB_ARTICLE_EXTRACT_TIMEOUT_MS || '30000', 10
);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

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
      console.warn(`[web-article-extract] Jina Reader HTTP ${response.status} for ${url}`);
      return null;
    }

    const text = await response.text();
    if (!text || text.length < 50) {
      console.warn(`[web-article-extract] Jina Reader returned too short content (${text.length} chars)`);
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
      console.warn(`[web-article-extract] Jina returned useless content for ${url}`);
      return null;
    }

    return { title, content, rawMarkdown: text };
  } catch (error) {
    if ((error as { name?: string })?.name === 'AbortError') {
      console.warn(`[web-article-extract] Jina Reader timeout for ${url}`);
    } else {
      console.warn(`[web-article-extract] Jina Reader error for ${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
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
    `url: ${url}, provider: ${provider}, jina: ${jinaResult ? 'empty' : 'failed'}, direct: ${directResult ? 'empty' : 'failed'}`
  );
}
