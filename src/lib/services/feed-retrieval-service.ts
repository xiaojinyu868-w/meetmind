/**
 * 今日情报的外部检索层。
 *
 * 只返回具有真实 URL 的候选，不负责个性化排序：
 * - 普通网页：现有搜索后端；失败时可用 Qwen Responses API 的 web_search 补充
 * - 论文：Semantic Scholar Academic Graph
 * - 书籍：Open Library Search API
 */

import { createLogger } from '@/lib/logger';
import type { FeedContentKind, FeedPerspective } from '@/types';
import { parseJsonResponse } from '@/lib/utils/json-utils';
import { webSearchExact } from './web-search-service';

const log = createLogger('feed-retrieval');
const REQUEST_TIMEOUT_MS = 10_000;
const DASHSCOPE_SEARCH_URL = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation';
const DEFAULT_DASHSCOPE_SEARCH_TIMEOUT_MS = 12_000;

export interface ExternalDiscoveryBrief {
  query: string;
  academicQuery?: string;
  bookQuery?: string;
  reason: string;
  perspective: FeedPerspective;
  contentKinds: FeedContentKind[];
  sourceCaptureIds?: string[];
  goalLabel?: string;
}

export interface ExternalFeedCandidate {
  title: string;
  url: string;
  snippet: string;
  sourceLabel: string;
  contentKind: FeedContentKind;
  authors?: string[];
  publishedAt?: string;
  coverUrl?: string;
  discovery: ExternalDiscoveryBrief;
  sourceScore: number;
  /** 搜索服务已经结合 query 完成相关性排序，无需再调用一次 LLM。 */
  preRanked?: boolean;
  qualityReason?: string;
  retrievalProvider?: 'dashscope-search' | 'direct';
  retrievalRank?: number;
}

export type FeedRetrievalStrategy = 'auto' | 'dashscope' | 'direct';

export interface FeedRetrievalOptions {
  strategy?: FeedRetrievalStrategy;
  dashscopeApiKey?: string;
  timeoutMs?: number;
}

interface SemanticScholarPaper {
  title?: string;
  url?: string;
  abstract?: string | null;
  year?: number | null;
  publicationDate?: string | null;
  venue?: string | null;
  citationCount?: number;
  authors?: Array<{ name?: string }>;
  openAccessPdf?: { url?: string | null } | null;
}

interface OpenLibraryWork {
  key?: string;
  title?: string;
  author_name?: string[];
  first_publish_year?: number;
  cover_i?: number;
  subject?: string[];
  edition_count?: number;
}

export interface DashScopeSearchSource {
  site_name?: string;
  index?: number;
  title?: string;
  url?: string;
}

export interface DashScopeSearchSummary {
  index?: number;
  summary?: string;
}

interface DashScopeSearchPayload {
  code?: string;
  message?: string;
  output?: {
    choices?: Array<{ message?: { content?: string } }>;
    search_info?: { search_results?: DashScopeSearchSource[] };
  };
}

export function selectDashScopeSearchSources(
  sources: DashScopeSearchSource[],
  summaries: DashScopeSearchSummary[],
): DashScopeSearchSource[] {
  const selectedIndexes = new Set(
    summaries
      .filter((item) => Number.isInteger(item.index) && item.summary?.trim())
      .map((item) => item.index as number),
  );
  if (selectedIndexes.size === 0) return sources.slice(0, 4);
  const matched = sources.filter((source) => selectedIndexes.has(source.index ?? -1));
  return (matched.length > 0 ? matched : sources).slice(0, 4);
}

function resolveRetrievalStrategy(options: FeedRetrievalOptions): Exclude<FeedRetrievalStrategy, 'auto'> {
  if (options.strategy && options.strategy !== 'auto') return options.strategy;
  const configured = process.env.FEED_SEARCH_MODE?.trim().toLowerCase();
  if (configured === 'direct') return 'direct';
  if (configured === 'dashscope') return 'dashscope';
  return (options.dashscopeApiKey || process.env.DASHSCOPE_API_KEY?.trim()) ? 'dashscope' : 'direct';
}

export async function retrieveExternalCandidates(
  discoveries: ExternalDiscoveryBrief[],
  options: FeedRetrievalOptions = {},
): Promise<ExternalFeedCandidate[]> {
  const strategy = resolveRetrievalStrategy(options);
  const apiKey = options.dashscopeApiKey || process.env.DASHSCOPE_API_KEY?.trim() || '';
  const activeDiscoveries = discoveries.slice(0, 3);
  const groups = strategy === 'dashscope' && apiKey
    ? await Promise.all(activeDiscoveries.map((discovery) => (
      searchWithDashScope(discovery, apiKey, options.timeoutMs)
    )))
    : await Promise.all(activeDiscoveries.map(async (discovery) => {
      const tasks: Array<Promise<ExternalFeedCandidate[]>> = [searchWeb(discovery)];
      if (discovery.contentKinds.includes('paper')) tasks.push(searchPapers(discovery));
      if (discovery.contentKinds.includes('book')) tasks.push(searchBooks(discovery));
      const settled = await Promise.allSettled(tasks);
      return settled.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
    }));

  const seen = new Set<string>();
  const candidates = groups.flat()
    .filter((candidate) => candidate.title && candidate.snippet && isHttpUrl(candidate.url))
    .sort((a, b) => {
      if (a.preRanked && b.preRanked) {
        return (a.retrievalRank ?? 99) - (b.retrievalRank ?? 99)
          || b.sourceScore - a.sourceScore;
      }
      return b.sourceScore - a.sourceScore;
    })
    .filter((candidate) => {
      const normalized = normalizeUrl(candidate.url);
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    })
    .slice(0, 24);

  log.info('external retrieval completed', {
    strategy,
    discoveries: activeDiscoveries.length,
    candidates: candidates.length,
  });
  return candidates;
}

async function searchWeb(discovery: ExternalDiscoveryBrief): Promise<ExternalFeedCandidate[]> {
  const results = await webSearchExact(discovery.query, {
    maxResults: 8,
    language: 'zh-CN',
    market: 'zh-CN',
  });

  return results.map((result) => ({
    title: result.title,
    url: result.url,
    snippet: result.snippet ?? '',
    sourceLabel: hostnameOf(result.url),
    contentKind: inferWebContentKind(result.url),
    discovery,
    sourceScore: scoreSource(result.url),
  }));
}

async function searchPapers(discovery: ExternalDiscoveryBrief): Promise<ExternalFeedCandidate[]> {
  const query = discovery.academicQuery || discovery.query;
  const url = new URL('https://api.semanticscholar.org/graph/v1/paper/search');
  url.searchParams.set('query', query.slice(0, 180));
  url.searchParams.set('limit', '6');
  url.searchParams.set('fields', 'title,url,abstract,authors,year,publicationDate,venue,openAccessPdf,citationCount');
  const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Semantic Scholar ${response.status}`);
  const data = await response.json() as { data?: SemanticScholarPaper[] };

  return (data.data ?? []).flatMap((paper): ExternalFeedCandidate[] => {
    if (!paper.title || !paper.url) return [];
    const authors = (paper.authors ?? []).map((author) => author.name ?? '').filter(Boolean).slice(0, 4);
    const metadata = [paper.venue, paper.year ? String(paper.year) : undefined].filter(Boolean).join(' · ');
    return [{
      title: paper.title,
      url: paper.openAccessPdf?.url || paper.url,
      snippet: (paper.abstract || metadata || '论文目录记录').slice(0, 520),
      sourceLabel: paper.venue || 'Semantic Scholar',
      contentKind: 'paper',
      authors,
      publishedAt: paper.publicationDate || (paper.year ? String(paper.year) : undefined),
      discovery,
      sourceScore: 8 + Math.min(2, Math.log10((paper.citationCount ?? 0) + 1)),
    }];
  });
}

async function searchBooks(discovery: ExternalDiscoveryBrief): Promise<ExternalFeedCandidate[]> {
  const url = new URL('https://openlibrary.org/search.json');
  url.searchParams.set('q', (discovery.bookQuery || discovery.query).slice(0, 180));
  url.searchParams.set('limit', '6');
  url.searchParams.set('fields', 'key,title,author_name,first_publish_year,cover_i,subject,edition_count');
  const response = await fetch(url, {
    headers: { 'user-agent': 'MeetMind/1.0 (learning information discovery)' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Open Library ${response.status}`);
  const data = await response.json() as { docs?: OpenLibraryWork[] };

  return (data.docs ?? []).flatMap((book): ExternalFeedCandidate[] => {
    if (!book.key || !book.title) return [];
    const authors = (book.author_name ?? []).slice(0, 4);
    const subjects = (book.subject ?? []).slice(0, 3).join('、');
    return [{
      title: book.title,
      url: `https://openlibrary.org${book.key}`,
      // 作者与年份已经作为结构化元数据展示，正文只保留主题。
      snippet: subjects || '图书目录记录',
      sourceLabel: 'Open Library',
      contentKind: 'book',
      authors,
      publishedAt: book.first_publish_year ? String(book.first_publish_year) : undefined,
      coverUrl: book.cover_i ? `https://covers.openlibrary.org/b/id/${book.cover_i}-M.jpg` : undefined,
      discovery,
      sourceScore: 7 + Math.min(2, Math.log10((book.edition_count ?? 1) + 1)),
    }];
  });
}

async function searchWithDashScope(
  discovery: ExternalDiscoveryBrief,
  apiKey: string,
  configuredTimeoutMs?: number,
): Promise<ExternalFeedCandidate[]> {
  const parsedTimeout = configuredTimeoutMs
    ?? Number.parseInt(process.env.FEED_SEARCH_TIMEOUT_MS || '', 10);
  const timeoutMs = Number.isFinite(parsedTimeout)
    ? Math.min(20_000, Math.max(3_000, parsedTimeout))
    : DEFAULT_DASHSCOPE_SEARCH_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const sources: DashScopeSearchSource[] = [];
  let content = '';

  try {
    const response = await fetch(DASHSCOPE_SEARCH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-DashScope-SSE': 'enable',
      },
      body: JSON.stringify({
        model: process.env.FEED_SEARCH_MODEL?.trim() || 'qwen-plus',
        input: {
          messages: [{
            role: 'user',
            content: `搜索“${discovery.query}”。只从真实搜索结果中选择 3-4 条与查询最相关、可直接打开的资料。输出 JSON：{"items":[{"index":1,"summary":"基于搜索内容的一句事实简介"}]}。index 必须对应搜索结果序号，不要生成新链接。`,
          }],
        },
        parameters: {
          enable_search: true,
          incremental_output: true,
          result_format: 'message',
          max_tokens: 700,
          search_options: {
            search_strategy: 'turbo',
            enable_source: true,
            prepend_search_result: true,
          },
        },
      }),
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(`DashScope native search ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    while (true) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const lines = pending.split(/\r?\n/);
      pending = done ? '' : lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const payload = JSON.parse(line.slice(5)) as DashScopeSearchPayload;
        if (payload.code) throw new Error(`${payload.code}: ${payload.message || 'search failed'}`);
        const nextSources = payload.output?.search_info?.search_results ?? [];
        if (sources.length === 0 && nextSources.length > 0) sources.push(...nextSources);
        content += payload.output?.choices?.[0]?.message?.content ?? '';
      }
      if (done) break;
    }
  } catch (error) {
    log.warn('DashScope native search failed', {
      query: discovery.query,
      sourceCount: sources.length,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    clearTimeout(timeoutId);
  }

  const parsed = parseJsonResponse<{ items?: DashScopeSearchSummary[] }>(content);
  const summaries = parsed?.items ?? [];
  const summaryByIndex = new Map(
    summaries
      .filter((item) => Number.isInteger(item.index) && item.summary?.trim())
      .map((item) => [item.index as number, item.summary!.trim()]),
  );
  const selectedSources = selectDashScopeSearchSources(sources, summaries);

  log.info('DashScope native search completed', {
    sourceCount: sources.length,
    summaryCount: summaryByIndex.size,
    selectedCount: selectedSources.length,
  });

  return selectedSources.flatMap((source, rank): ExternalFeedCandidate[] => {
    if (!source.title || !source.url || !isHttpUrl(source.url)) return [];
    return [{
      title: source.title,
      url: source.url,
      snippet: summaryByIndex.get(source.index ?? -1) || source.title,
      sourceLabel: source.site_name || hostnameOf(source.url),
      contentKind: inferWebContentKind(source.url),
      discovery,
      sourceScore: scoreSource(source.url),
      preRanked: true,
      qualityReason: discovery.reason,
      retrievalProvider: 'dashscope-search',
      retrievalRank: rank,
    }];
  });
}

export function scoreSource(url: string): number {
  const host = hostnameOf(url).toLowerCase();
  let score = 2;
  if (/\.(edu|ac)\.|\.edu$|\.ac$|\.gov\.|\.gov$|\.org$/.test(host)) score += 3;
  if (/(doi\.org|arxiv\.org|nature\.com|science\.org|ieee\.org|acm\.org|pubmed|jstor\.org|openlibrary\.org|semanticscholar\.org)/.test(host)) score += 4;
  if (/(^|\.)docs\.|developer\.|github\.com/.test(host)) score += 2;
  return score;
}

function inferWebContentKind(url: string): FeedContentKind {
  const value = url.toLowerCase();
  if (/(doi\.org|arxiv\.org|semanticscholar\.org|pubmed|\/paper\/)/.test(value)) return 'paper';
  if (/(openlibrary\.org|books\.google\.|goodreads\.com)/.test(value)) return 'book';
  if (/(\.gov|\/reports?\/|\/research\/|\.pdf($|\?))/.test(value)) return 'report';
  return 'web';
}

function hostnameOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return '外部资料'; }
}

function isHttpUrl(url: string): boolean {
  try { return ['http:', 'https:'].includes(new URL(url).protocol); } catch { return false; }
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'].forEach((key) => parsed.searchParams.delete(key));
    return parsed.toString().replace(/\/$/, '');
  } catch { return url; }
}
