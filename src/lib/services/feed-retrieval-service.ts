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
import { webSearchExact } from './web-search-service';

const log = createLogger('feed-retrieval');
const REQUEST_TIMEOUT_MS = 10_000;

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

interface ConnectedSearchItem {
  title?: string;
  url?: string;
  snippet?: string;
  source?: string;
}

export async function retrieveExternalCandidates(
  discoveries: ExternalDiscoveryBrief[],
): Promise<ExternalFeedCandidate[]> {
  const groups = await Promise.all(discoveries.slice(0, 3).map(async (discovery) => {
    const tasks: Array<Promise<ExternalFeedCandidate[]>> = [searchWeb(discovery)];
    if (discovery.contentKinds.includes('paper')) tasks.push(searchPapers(discovery));
    if (discovery.contentKinds.includes('book')) tasks.push(searchBooks(discovery));
    const settled = await Promise.allSettled(tasks);
    return settled.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
  }));

  const seen = new Set<string>();
  return groups.flat()
    .filter((candidate) => candidate.title && candidate.snippet && isHttpUrl(candidate.url))
    .sort((a, b) => b.sourceScore - a.sourceScore)
    .filter((candidate) => {
      const normalized = normalizeUrl(candidate.url);
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    })
    .slice(0, 24);
}

async function searchWeb(discovery: ExternalDiscoveryBrief): Promise<ExternalFeedCandidate[]> {
  let results = await webSearchExact(discovery.query, {
    maxResults: 8,
    language: 'zh-CN',
    market: 'zh-CN',
  });

  if (results.length < 2) {
    const connected = await searchWithQwen(discovery.query);
    results = [...results, ...connected.map((item, index) => ({
      id: `qwen-web-${index}`,
      title: item.title ?? '',
      url: item.url ?? '',
      snippet: item.snippet ?? '',
      source_type: 'web' as const,
    }))];
  }

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
      snippet: [authors.join('、'), book.first_publish_year, subjects].filter(Boolean).join(' · ') || '图书目录记录',
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

async function searchWithQwen(query: string): Promise<ConnectedSearchItem[]> {
  const apiKey = process.env.DASHSCOPE_API_KEY?.trim();
  if (!apiKey) return [];
  const baseUrl = (process.env.LLM_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/$/, '');
  try {
    const response = await fetch(`${baseUrl}/responses`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen3.7-plus',
        input: `联网搜索“${query}”。只返回搜索工具实际找到且可打开的资料，输出 JSON：{"items":[{"title":"","url":"https://...","snippet":"一句事实摘要","source":"站点"}]}。不要编造 URL，最多 6 条。`,
        tools: [{ type: 'web_search' }, { type: 'web_extractor' }],
        store: false,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Qwen web search ${response.status}`);
    const data = await response.json() as { output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
    const text = (data.output ?? []).flatMap((output) => output.content ?? [])
      .filter((content) => content.type === 'output_text' && content.text)
      .map((content) => content.text).join('');
    const parsed = JSON.parse(text.replace(/^```json\s*|\s*```$/g, '')) as { items?: ConnectedSearchItem[] };
    return (parsed.items ?? []).filter((item) => item.title && item.snippet && item.url && isHttpUrl(item.url)).slice(0, 6);
  } catch (error) {
    log.warn('Qwen connected search failed:', error);
    return [];
  }
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
