/**
 * 文章导入 API
 *
 * POST /api/article/import
 *
 * 接收图文链接（微信公众号、小红书、知乎等），提取文章正文并返回。
 * 这是 video/import 的姊妹路由——前者处理视频/音频，本路由处理图文。
 *
 * 请求体：
 * {
 *   url: string;          // 文章 URL
 *   provider?: string;    // 平台 ID（可选，自动检测）
 * }
 *
 * 响应：
 * {
 *   success: true;
 *   title: string;
 *   content: string;      // Markdown 正文
 *   text: string;          // 纯文本（用于搜索和 AI 上下文）
 *   description: string;
 *   author?: string;
 *   wordCount: number;
 *   source: {
 *     provider: string;
 *     providerLabel: string;
 *     originalUrl: string;
 *     extractMethod: string;
 *   };
 *   segments: Array<{     // 按段落切分的 segments（兼容 video/import 的数据格式）
 *     id: string;
 *     text: string;
 *     startMs: number;
 *     endMs: number;
 *   }>;
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { detectLinkProvider } from '@/lib/context-reach/link-provider';
import {
  extractWebArticle,
  WebArticleExtractError,
} from '@/lib/services/web-article-extract-service';

interface ImportRequestBody {
  url?: string;
  provider?: string;
}

/**
 * 将文章正文切分为段落 segments。
 * 模拟 video/import 的 segment 格式，使前端可以复用相同的数据结构。
 * 图文没有时间轴，所以 startMs/endMs 按段落顺序生成伪时间轴。
 */
function textToSegments(text: string): Array<{
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  confidence: number;
  isFinal: boolean;
}> {
  // 按双换行或 Markdown 标题分段
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (paragraphs.length === 0) return [];

  // 按段落生成伪时间轴（每段约 5 秒阅读时间，按字数比例分配）
  const totalChars = paragraphs.reduce((sum, p) => sum + p.length, 0);
  const totalDurationMs = Math.max(5000, totalChars * 100); // 100ms per char ≈ 阅读速度

  const segments: Array<{ id: string; text: string; startMs: number; endMs: number; confidence: number; isFinal: boolean }> = [];
  let cursor = 0;

  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    const proportion = p.length / totalChars;
    const durationMs = Math.max(1000, Math.round(proportion * totalDurationMs));
    const startMs = cursor;
    const endMs = cursor + durationMs;
    cursor = endMs;

    segments.push({
      id: `seg-${i}`,
      text: p,
      startMs,
      endMs,
      confidence: 1.0,
      isFinal: true,
    });
  }

  return segments;
}

/**
 * Markdown → 纯文本。
 */
function markdownToText(md: string): string {
  return md
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\[([^\]]+)\]\(.*?\)/g, '$1')
    .replace(/#{1,6}\s+/g, '')
    .replace(/[*_]{1,3}(.+?)[*_]{1,3}/g, '$1')
    .replace(/`{1,3}[^`]*`{1,3}/g, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/^>\s+/gm, '')
    .replace(/---+/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ImportRequestBody;
    const url = body.url?.trim() || '';

    if (!url) {
      return NextResponse.json(
        { error: '缺少文章链接', code: 'MISSING_URL' },
        { status: 400 }
      );
    }

    // 识别平台
    const detectedProvider = detectLinkProvider(url);
    const provider = body.provider || detectedProvider.id;
    const providerLabel = detectedProvider.label;

    console.log(`[article-import] url=${url}, provider=${provider} (${providerLabel})`);

    // 提取文章内容
    const article = await extractWebArticle(url, provider, providerLabel);

    // 转为纯文本
    const plainText = markdownToText(article.content);

    // 切分为 segments
    const segments = textToSegments(plainText);
    const totalDuration = segments.length > 0 ? segments[segments.length - 1].endMs : 0;

    return NextResponse.json({
      success: true,
      title: article.title,
      content: article.content,
      text: plainText,
      description: article.description,
      author: article.author,
      wordCount: article.wordCount,
      imageUrls: article.imageUrls,
      totalDuration,
      source: {
        provider: article.provider,
        providerLabel: article.providerLabel,
        originalUrl: url,
        extractMethod: article.extractMethod,
      },
      segments,
      sentences: segments.map((seg) => ({
        id: seg.id,
        text: seg.text,
        beginTime: seg.startMs,
        endTime: seg.endMs,
        confidence: 1.0,
      })),
    });
  } catch (error) {
    if (error instanceof WebArticleExtractError) {
      console.error(`[article-import] ${error.code}: ${error.message} | ${error.detail}`);
      return NextResponse.json(
        { error: error.message, code: error.code, detail: error.detail },
        { status: 422 }
      );
    }

    const message = error instanceof Error ? error.message : String(error);
    console.error(`[article-import] unexpected error: ${message}`);
    return NextResponse.json(
      { error: '文章导入失败', code: 'ARTICLE_IMPORT_FAILED', detail: message },
      { status: 500 }
    );
  }
}
