/**
 * Jina Reader 服务 - 通过 https://r.jina.ai/{url} 抓取网页正文
 *
 * 适用于低反爬平台（GitHub、掘金、简书、CSDN、少数派、36氪、Notion 公开页等）
 * 和通用博客/个人网站。
 *
 * 强反爬平台（小红书、微博、知乎、微信公众号）几乎必定失败，
 * 这里会静默跳过，不影响主流程。
 */

import prisma from '@/lib/prisma';
import workspaceContextService from '@/lib/services/workspace-context-service';
import { detectLinkProvider } from '@/lib/context-reach/link-provider';
import {
  extractWebArticle,
  markdownToPlainText,
  WebArticleExtractError,
} from '@/lib/services/web-article-extract-service';
import { chat, DEFAULT_WORKSHOP_MODEL_ID, type ChatMessage } from '@/lib/services/llm-service';
import { createLogger } from '@/lib/logger';
const log = createLogger('jina-reader');


// 已知强反爬、Jina Reader 大概率失败的平台
const SKIP_JINA_PROVIDERS = new Set([
  'xiaohongshu',
  'weibo',
  'zhihu',
  'wechat-article',
  'toutiao',
]);

// 正文长度上限（字符），避免单条上下文过大导致 LLM 费用飙升
const MAX_BODY_CHARS = 6000;

// 喂给 AI 摘要的正文上限（节省 token）
const MAX_SUMMARY_INPUT_CHARS = 3000;

// Jina 请求超时（ms）
const JINA_TIMEOUT_MS = 15_000;

/**
 * 尝试通过 Jina Reader 获取 URL 的 Markdown 正文。
 * 返回 null 表示失败或不适用。
 */
export async function fetchJinaReaderContent(url: string): Promise<string | null> {
  const provider = detectLinkProvider(url);
  if (SKIP_JINA_PROVIDERS.has(provider.id)) {
    return null;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), JINA_TIMEOUT_MS);

    const response = await fetch(`https://r.jina.ai/${encodeURIComponent(url)}`, {
      method: 'GET',
      headers: {
        Accept: 'text/markdown',
        'X-Return-Format': 'markdown',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      log.warn(`[jina-reader] HTTP ${response.status} for ${url}`);
      return null;
    }

    const text = await response.text();
    const trimmed = text.trim();

    // 太短的内容视为抓取失败（反爬返回的空壳页面通常很短）
    if (trimmed.length < 80) {
      log.warn(`[jina-reader] content too short (${trimmed.length} chars) for ${url}`);
      return null;
    }

    // 截断过长的正文
    if (trimmed.length > MAX_BODY_CHARS) {
      return trimmed.slice(0, MAX_BODY_CHARS) + '\n\n[正文已截断]';
    }

    return trimmed;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      log.warn(`[jina-reader] timeout for ${url}`);
    } else {
      log.warn(`[jina-reader] fetch failed for ${url}:`, error);
    }
    return null;
  }
}

/**
 * 用 LLM 对正文生成一句话摘要 + 关联分析。
 * 返回 { summary, insight } 或 null。
 */
async function generateLinkSummary(
  title: string,
  content: string,
  providerLabel: string
): Promise<{ summary: string; insight: string } | null> {
  try {
    const truncatedContent = content.length > MAX_SUMMARY_INPUT_CHARS
      ? content.slice(0, MAX_SUMMARY_INPUT_CHARS) + '\n...[已截断]'
      : content;

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `你是一个学习助手。用户收集了一条来自${providerLabel}的内容。请用中文输出 JSON，格式如下：
{"summary":"一句话概括这篇内容的核心观点（30字以内）","insight":"这条内容可能和学习者的哪类学习场景相关？给出一句简短的关联提示（40字以内）"}
只输出 JSON，不要多余解释。`,
      },
      {
        role: 'user',
        content: `标题：${title}\n\n正文：\n${truncatedContent}`,
      },
    ];

    const response = await chat(messages, DEFAULT_WORKSHOP_MODEL_ID, {
      temperature: 0.3,
      maxTokens: 200,
      responseFormat: 'json_object',
    });

    const parsed = JSON.parse(response.content) as { summary?: string; insight?: string };
    if (!parsed.summary) return null;

    return {
      summary: parsed.summary,
      insight: parsed.insight || '',
    };
  } catch (error) {
    log.warn('[jina-reader] AI summary generation failed:', error);
    return null;
  }
}

/**
 * 异步提取 article-link 正文（含微信文章），更新 WechatInboxMessage 和 WorkspaceCapture/Echo。
 *
 * 该函数设计为 fire-and-forget，调用方无需 await。
 * 仅在 article-link 类型且 sourceUrl 存在时工作。
 * 文章提取策略由 extractWebArticle 统一调度（Firecrawl → OpenClaw fallback → Jina → Direct）。
 */
export async function enrichArticleLinkContent(linkToken: string, url: string): Promise<void> {
  try {
    const message = await prisma.wechatInboxMessage.findUnique({
      where: { linkToken },
      select: {
        title: true,
        reachChannel: true,
        normalizedText: true,
        workspaceId: true,
      },
    });

    if (!message || message.reachChannel !== 'article-link') {
      return;
    }

    const article = await extractWebArticle(url, 'wechat-article', '微信公众号');
    const plainContent = markdownToPlainText(article.content);

    // 如果原始内容看起来只是一个 URL 或很短，直接丢弃，不再拼在正文前面。
    // 用户发的原始文字如果带有自己的备注（>100 字且不像 URL），才保留拼接。
    const existingText = message.normalizedText || '';
    const isJustUrlOrShort = !existingText || existingText.length < 100 || /^https?:\/\//i.test(existingText.trim());
    const enrichedText = isJustUrlOrShort
      ? plainContent
      : `${existingText}\n\n---\n\n${plainContent}`;

    // 更新 WechatInboxMessage
    await prisma.wechatInboxMessage.update({
      where: { linkToken },
      data: { normalizedText: enrichedText },
    });

    // 如果已绑定 workspace，同步更新 WorkspaceCapture
    if (message.workspaceId) {
      await workspaceContextService.syncWechatInboxMessageArtifacts(linkToken);
    }

    // 异步生成 AI 摘要（不阻塞正文写入）
    if (message.workspaceId && article.title) {
      const summaryResult = await generateLinkSummary(
        article.title,
        article.content,
        '微信公众号'
      );

      if (summaryResult) {
        const sourceKey = `wechat:${linkToken}`;
        const capture = await prisma.workspaceCapture.findUnique({
          where: { sourceKey },
          select: { id: true },
        });

        if (capture) {
          await prisma.workspaceEcho.upsert({
            where: { sourceKey },
            update: {
              title: summaryResult.summary,
              body: summaryResult.insight
                ? `${summaryResult.insight}\n\n原文已解析，可以随时回看。`
                : '原文已解析，可以随时回看。',
              status: 'active',
            },
            create: {
              workspaceId: message.workspaceId,
              captureId: capture.id,
              sourceKey,
              title: summaryResult.summary,
              body: summaryResult.insight
                ? `${summaryResult.insight}\n\n原文已解析，可以随时回看。`
                : '原文已解析，可以随时回看。',
              status: 'active',
            },
          });
        }
      }
    }
  } catch (error) {
    if (error instanceof WebArticleExtractError) {
      log.warn(`[jina-reader] enrichArticleLinkContent ${error.code}: ${error.message}`);
    } else {
      log.error('[jina-reader] enrichArticleLinkContent failed:', error);
    }
  }
}

/**
 * 异步抓取链接正文 + AI 摘要，更新 WechatInboxMessage 和 WorkspaceCapture/Echo。
 *
 * 该函数设计为 fire-and-forget，调用方无需 await。
 * 仅在 web-link 类型且 sourceUrl 存在时工作。
 */
export async function enrichLinkContent(linkToken: string): Promise<void> {
  try {
    const message = await prisma.wechatInboxMessage.findUnique({
      where: { linkToken },
      select: {
        sourceUrl: true,
        title: true,
        reachChannel: true,
        normalizedText: true,
        workspaceId: true,
      },
    });

    if (!message?.sourceUrl || message.reachChannel !== 'web-link') {
      return;
    }

    const content = await fetchJinaReaderContent(message.sourceUrl);
    if (!content) return;
    const plainContent = markdownToPlainText(content);

    // 如果原始内容看起来只是一个 URL 或很短，直接丢弃，不再拼在正文前面
    const existingText = message.normalizedText || '';
    const isJustUrlOrShort = !existingText || existingText.length < 100 || /^https?:\/\//i.test(existingText.trim());
    const enrichedText = isJustUrlOrShort
      ? plainContent
      : `${existingText}\n\n---\n\n${plainContent}`;

    // 更新 WechatInboxMessage
    await prisma.wechatInboxMessage.update({
      where: { linkToken },
      data: { normalizedText: enrichedText },
    });

    // 如果已绑定 workspace，同步更新 WorkspaceCapture
    if (message.workspaceId) {
      await workspaceContextService.syncWechatInboxMessageArtifacts(linkToken);
    }

    // 异步生成 AI 摘要（不阻塞正文写入）
    if (message.workspaceId && message.title) {
      const provider = detectLinkProvider(message.sourceUrl);
      const summaryResult = await generateLinkSummary(message.title, content, provider.label);

      if (summaryResult) {
        const sourceKey = `wechat:${linkToken}`;
        const capture = await prisma.workspaceCapture.findUnique({
          where: { sourceKey },
          select: { id: true },
        });

        if (capture) {
          // 更新 Echo：用 AI 摘要替换模板化的 Echo
          await prisma.workspaceEcho.upsert({
            where: { sourceKey },
            update: {
              title: summaryResult.summary,
              body: summaryResult.insight
                ? `${summaryResult.insight}\n\n原文已解析，可以随时回看。`
                : '原文已解析，可以随时回看。',
              status: 'active',
            },
            create: {
              workspaceId: message.workspaceId,
              captureId: capture.id,
              sourceKey,
              title: summaryResult.summary,
              body: summaryResult.insight
                ? `${summaryResult.insight}\n\n原文已解析，可以随时回看。`
                : '原文已解析，可以随时回看。',
              status: 'active',
            },
          });

        }
      }
    }
  } catch (error) {
    log.error('[jina-reader] enrichLinkContent failed:', error);
  }
}
