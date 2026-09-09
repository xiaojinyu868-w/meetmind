/**
 * pocket-clip-service — 口袋剪藏：把"任何应用里选中的一段"变成一条有根、格式不丢的收集
 *
 * 桌面壳只送原料（纯文本 + 剪贴板 HTML + 来源三元组），转换全在这里：
 *   - HTML → Markdown（turndown + gfm 表格），三条专门规则：KaTeX 的原始 TeX 抓回来、
 *     ChatGPT 带工具条的 <pre> 也能出围栏代码块、UI 渣（按钮 / svg / 「复制代码」）清掉
 *   - 标题从第一行或来源页标题推；来源映射成 platformLabel（chatgpt.com → ChatGPT）
 *   - groupKey：同一来源 30 分钟内连续几条归一组（收集流 P2 成组展示用）
 *
 * 剪藏的网址**不放** UpsertWorkspaceCaptureInput.sourceUrl——那是链接导入的去重键，
 * 同一对话里划的第二条会覆盖第一条；网址放 metadata.pocket.source.url。
 *
 * 纯函数为主，便于单测；只有 createPocketClip 碰服务层。
 */

import TurndownService from 'turndown';
// turndown-plugin-gfm 没有类型声明；只用它的 tables 规则
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { tables as gfmTables } from 'turndown-plugin-gfm';
import { buildSourceProvenance } from '@/lib/capture/source-provenance';
import { detectLinkProvider } from '@/lib/context-reach/link-provider';
import type { UpsertWorkspaceCaptureInput } from '@/lib/services/workspace-context-types';
import workspaceContextService from '@/lib/services/workspace-context-service';

/** 进口袋的来源：桌面壳三条路 + 口袋窗 / 小窗手打的随手记（GET /api/workspace/pocket 用） */
export const POCKET_SOURCE_TYPES = ['desktop-clip', 'desktop-screenshot', 'desktop-drop', 'manual-note'];

export interface ClipSource {
  /** 前台应用名（Google Chrome / Preview / WeChat / Microsoft Word…） */
  app?: string;
  /** 前台窗口标题 */
  windowTitle?: string;
  /** 浏览器当前网址（能问到时） */
  url?: string;
  /** 页面标题（浏览器场景；剪贴板 bookmark 也带） */
  pageTitle?: string;
}

export interface PocketClipInput {
  text?: string;
  html?: string;
  source?: ClipSource;
  occurredAt?: string;
  /** 客户端生成的幂等 id：离线队列补传时不重复落库 */
  clientId?: string;
}

export interface PocketClipDraft {
  markdown: string;
  plainText: string;
  title: string;
  previewText: string;
  hasMath: boolean;
  source: ClipSource;
  sourceLabel: string;
  platformId?: string;
  groupKey: string;
}

const GROUP_WINDOW_MS = 30 * 60 * 1000;
const MAX_TITLE_WIDTH = 24;

/** 常见 AI / 学习站点：浏览器 URL → 用户认得的名字。其余交给 link-provider 表，再不行用应用名 */
const HOST_LABELS: Array<[RegExp, string, string]> = [
  [/(^|\.)chatgpt\.com$|(^|\.)chat\.openai\.com$/i, 'chatgpt', 'ChatGPT'],
  [/(^|\.)claude\.ai$/i, 'claude', 'Claude'],
  [/(^|\.)gemini\.google\.com$/i, 'gemini', 'Gemini'],
  [/(^|\.)kimi\.(com|moonshot\.cn)$/i, 'kimi', 'Kimi'],
  [/(^|\.)doubao\.com$/i, 'doubao', '豆包'],
  [/(^|\.)deepseek\.com$/i, 'deepseek', 'DeepSeek'],
  [/(^|\.)tongyi\.aliyun\.com$|(^|\.)qianwen\.com$/i, 'qwen', '通义千问'],
  [/(^|\.)perplexity\.ai$/i, 'perplexity', 'Perplexity'],
  [/(^|\.)notion\.so$|(^|\.)notion\.site$/i, 'notion', 'Notion'],
  [/(^|\.)wikipedia\.org$/i, 'wikipedia', 'Wikipedia'],
  [/(^|\.)arxiv\.org$/i, 'arxiv', 'arXiv'],
  [/(^|\.)github\.com$/i, 'github', 'GitHub'],
  [/(^|\.)bilibili\.com$|(^|\.)b23\.tv$/i, 'bilibili', 'B站'],
  [/(^|\.)youtube\.com$|(^|\.)youtu\.be$/i, 'youtube', 'YouTube'],
];

/** 前台应用名 → 简短中文 / 常用名（macOS 进程名常带 "Microsoft" 等前缀） */
const APP_LABELS: Array<[RegExp, string]> = [
  [/^google chrome/i, 'Chrome'],
  [/^microsoft edge/i, 'Edge'],
  [/^microsoft word/i, 'Word'],
  [/^microsoft powerpoint/i, 'PowerPoint'],
  [/^wechat|^微信/i, '微信'],
  [/^preview|^预览/i, '预览'],
  [/^acrobat|^adobe acrobat/i, 'Acrobat'],
  [/^zotero/i, 'Zotero'],
  [/^obsidian/i, 'Obsidian'],
  [/^notes|^备忘录/i, '备忘录'],
];

function compact(value: unknown, max: number): string {
  const normalized = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return normalized.length <= max ? normalized : `${normalized.slice(0, Math.max(1, max - 1))}…`;
}

function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) width += /[\u2e80-\u9fff\uac00-\ud7af\uff00-\uffef]/u.test(ch) ? 1 : 0.5;
  return width;
}

function clipToWidth(text: string, maxWidth: number): string {
  let width = 0;
  let out = '';
  for (const ch of text) {
    const w = /[\u2e80-\u9fff\uac00-\ud7af\uff00-\uffef]/u.test(ch) ? 1 : 0.5;
    if (width + w > maxWidth) return `${out.trimEnd()}…`;
    width += w;
    out += ch;
  }
  return out;
}

// ── HTML → Markdown ────────────────────────────────────────────────

/** 「复制代码 / Copy code / 已复制」这类工具条残留，转换后按行清掉 */
const UI_RESIDUE_LINE = /^(复制代码|复制|已复制|Copy code|Copy|Copied!?|window\.__oai_\w+.*)$/i;

let turndownInstance: TurndownService | null = null;

function getTurndown(): TurndownService {
  if (turndownInstance) return turndownInstance;
  const service = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
  });
  service.use(gfmTables);
  // UI 渣：按钮、图标、脚本、样式、辅助隐藏元素
  service.remove(['script', 'style', 'noscript', 'button', 'iframe', 'select', 'textarea']);
  // svg 不在 HTMLElementTagNameMap 里，走 filter 函数；aria-hidden 的辅助元素一并清掉
  service.addRule('uiResidue', {
    filter: (node) => node.nodeType === 1 && (
      node.nodeName.toLowerCase() === 'svg' || (node as Element).getAttribute('aria-hidden') === 'true'
    ),
    replacement: () => '',
  });

  // KaTeX：原始 TeX 在 <annotation encoding="application/x-tex"> 里。
  // 块级（.katex-display）写成 $$…$$，行内写成 $…$；抓不到 TeX 才退回可见文本。
  service.addRule('katex', {
    filter: (node) => {
      if (node.nodeType !== 1) return false;
      const element = node as Element;
      const cls = element.getAttribute('class') || '';
      return /\bkatex(-display)?\b/.test(cls) && !/\bkatex-(html|mathml)\b/.test(cls);
    },
    replacement: (_content, node) => {
      const element = node as Element;
      const annotation = element.querySelector('annotation[encoding="application/x-tex"]');
      const tex = annotation?.textContent?.trim();
      const isDisplay = /\bkatex-display\b/.test(element.getAttribute('class') || '')
        || element.parentElement?.getAttribute('class')?.includes('katex-display') === true;
      if (!tex) return element.textContent?.trim() || '';
      return isDisplay ? `\n\n$$\n${tex}\n$$\n\n` : `$${tex}$`;
    },
  });

  // 代码块：ChatGPT 的 <pre> 里先有一层"语言名 + 复制"工具条 div，默认 fenced 规则只认 pre > code 第一子节点
  service.addRule('preWithToolbar', {
    filter: (node) => {
      if (node.nodeType !== 1 || node.nodeName !== 'PRE') return false;
      return Boolean((node as Element).querySelector('code'));
    },
    replacement: (_content, node) => {
      const element = node as Element;
      const code = element.querySelector('code') as Element | null;
      const className = code?.getAttribute('class') || '';
      const language = className.match(/(?:language|lang)-([\w#+.-]+)/i)?.[1] || '';
      const body = (code?.textContent || '').replace(/\n+$/, '');
      const fence = body.includes('```') ? '````' : '```';
      return `\n\n${fence}${language}\n${body}\n${fence}\n\n`;
    },
  });

  turndownInstance = service;
  return service;
}

export function htmlToMarkdown(html: string): { markdown: string; hasMath: boolean } {
  const source = typeof html === 'string' ? html.trim() : '';
  if (!source) return { markdown: '', hasMath: false };
  let markdown = '';
  try {
    markdown = getTurndown().turndown(source);
  } catch {
    return { markdown: '', hasMath: false };
  }
  const cleaned = markdown
    .split('\n')
    .filter((line) => !UI_RESIDUE_LINE.test(line.trim()))
    .join('\n')
    .replace(/\u00a0/g, ' ')
    // turndown 默认把列表标记后补到 4 格对齐（"-   x"），读起来发虚；收成一个空格
    .replace(/^(\s*)([-*+])\s{2,}(?=\S)/gm, '$1$2 ')
    .replace(/^(\s*\d+\.)\s{2,}(?=\S)/gm, '$1 ')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { markdown: cleaned, hasMath: /(^|[^\\])\$[^$\n]+\$|\$\$[\s\S]+?\$\$/.test(cleaned) };
}

/** Markdown → 供预览 / 标题用的纯文本（去标记，不做渲染） */
export function markdownToPlain(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```\w*\n?/g, '').trim())
    .replace(/\$\$([\s\S]+?)\$\$/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/\*\*|__|~~|`/g, '')
    .replace(/\|/g, ' ')
    .replace(/^-{3,}$/gm, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

// ── 来源 ──────────────────────────────────────────────────────────

export function describeClipSource(source: ClipSource | undefined): { label: string; platformId?: string } {
  const url = source?.url?.trim();
  if (url) {
    try {
      const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
      for (const [pattern, id, label] of HOST_LABELS) {
        if (pattern.test(host)) return { label, platformId: id };
      }
      const detected = detectLinkProvider(url);
      // link-provider 认识的站点用它的名字；认不出（generic / web）就直接给域名——比「网页」有信息
      if (detected && detected.id !== 'web' && detected.id !== 'generic') {
        return { label: detected.label, platformId: detected.id };
      }
      return { label: host, platformId: 'web' };
    } catch {
      // 不是合法 URL，落到应用名
    }
  }
  const app = source?.app?.trim();
  if (app) {
    for (const [pattern, label] of APP_LABELS) {
      if (pattern.test(app)) return { label };
    }
    return { label: app };
  }
  return { label: '桌面' };
}

/** 同一来源（网址去 query / 或窗口标题）在 30 分钟窗内的连续剪藏归一组 */
export function buildClipGroupKey(source: ClipSource | undefined, occurredAt: Date): string {
  let anchor = '';
  const url = source?.url?.trim();
  if (url) {
    try {
      const parsed = new URL(url);
      anchor = `${parsed.hostname}${parsed.pathname}`;
    } catch {
      anchor = url;
    }
  }
  if (!anchor) anchor = compact(source?.windowTitle || source?.pageTitle || source?.app || 'desktop', 120);
  const bucket = Math.floor(occurredAt.getTime() / GROUP_WINDOW_MS);
  return `${anchor.toLowerCase()}#${bucket}`;
}

// ── 标题 ──────────────────────────────────────────────────────────

/**
 * 第一句够具体就用第一句（≤24 显示宽度）；太短（一两个词）而来源有页标题，用页标题。
 * 不编标题：都取不到时留空由服务层用 previewText 补。
 */
export function deriveClipTitle(plainText: string, source: ClipSource | undefined): string {
  const firstLine = plainText.split('\n').map((line) => line.trim()).find(Boolean) || '';
  const firstSentence = firstLine.split(/(?<=[。！？!?；;])\s*/)[0] || firstLine;
  const candidate = firstSentence.replace(/[：:。！？!?；;，,]+$/, '').trim();
  const pageTitle = compact(source?.pageTitle || source?.windowTitle, 60)
    .replace(/\s*[-–—|]\s*(ChatGPT|Claude|Gemini|Google Chrome|Microsoft Edge|Safari)\s*$/i, '')
    .trim();
  if (displayWidth(candidate) >= 4) return clipToWidth(candidate, MAX_TITLE_WIDTH);
  if (pageTitle) return clipToWidth(pageTitle, MAX_TITLE_WIDTH);
  return clipToWidth(candidate, MAX_TITLE_WIDTH);
}

// ── 组装 ──────────────────────────────────────────────────────────

export function buildPocketClipDraft(input: PocketClipInput): PocketClipDraft | null {
  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
  const safeOccurredAt = Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt;
  const converted = htmlToMarkdown(input.html || '');
  const rawText = typeof input.text === 'string' ? input.text.replace(/\r\n/g, '\n').trim() : '';
  // HTML 转出来明显比纯文本短（只剩零碎）说明转换失真，以纯文本为准
  const markdown = converted.markdown && converted.markdown.length >= rawText.length * 0.5
    ? converted.markdown
    : rawText;
  if (!markdown) return null;
  // 标题 / 预览用人读的那版：剪贴板纯文本里公式是渲染后的字符（P(A|B)），Markdown 里是 TeX 源码
  const plainText = markdownToPlain(markdown) || rawText;
  const readable = rawText || plainText;
  const source: ClipSource = {
    app: compact(input.source?.app, 80) || undefined,
    windowTitle: compact(input.source?.windowTitle, 200) || undefined,
    url: compact(input.source?.url, 2_000) || undefined,
    pageTitle: compact(input.source?.pageTitle, 200) || undefined,
  };
  const described = describeClipSource(source);
  return {
    markdown,
    plainText,
    title: deriveClipTitle(readable, source),
    previewText: compact(readable, 180),
    hasMath: converted.markdown === markdown ? converted.hasMath : false,
    source,
    sourceLabel: described.label,
    platformId: described.platformId,
    groupKey: buildClipGroupKey(source, safeOccurredAt),
  };
}

export function buildPocketCaptureInput(
  draft: PocketClipDraft,
  params: { occurredAt: Date; clientId?: string },
): UpsertWorkspaceCaptureInput {
  const ts = params.occurredAt.getTime();
  const key = params.clientId?.replace(/[^\w.-]/g, '').slice(0, 60);
  return {
    sourceType: 'desktop-clip',
    sourceKey: key ? `clip-${key}` : `clip-${ts}-${Math.random().toString(36).slice(2, 8)}`,
    role: 'support',
    contentType: 'text',
    title: draft.title || draft.previewText || draft.sourceLabel,
    previewText: draft.previewText,
    normalizedText: draft.markdown,
    // 网址不进 sourceUrl（链接去重键）；放 metadata.pocket.source.url
    occurredAt: params.occurredAt.toISOString(),
    metadata: {
      channel: 'desktop-pocket',
      pocket: {
        source: draft.source,
        sourceLabel: draft.sourceLabel,
        groupKey: draft.groupKey,
        format: 'markdown',
        hasMath: draft.hasMath,
        charCount: draft.plainText.length,
      },
      provenance: buildSourceProvenance({
        ingressChannel: 'composer',
        normalizedText: draft.markdown,
        platformId: draft.platformId,
        platformLabel: draft.sourceLabel,
        extractionMethod: 'desktop-selection',
        contentState: 'complete',
      }),
    },
  };
}

export async function createPocketClip(userId: string, input: PocketClipInput) {
  const draft = buildPocketClipDraft(input);
  if (!draft) return null;
  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
  const safeOccurredAt = Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt;
  const result = await workspaceContextService.upsertCaptureForUser(
    userId,
    buildPocketCaptureInput(draft, { occurredAt: safeOccurredAt, clientId: input.clientId }),
  );
  return { draft, capture: result.capture };
}
