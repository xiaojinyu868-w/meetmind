/**
 * 知乎搜索 → 「继续看」候选（server-only）。
 *
 * 两个消费方：今日情报的外部检索层（feed-retrieval-service 把它当一个 provider，补"不同视角 / 亲历者经验"那一格）
 * 和考后补货（/api/zhihu/continue：学生还没稳的概念 → 知乎上讲得最清楚的几条）。
 *
 * 排序只用知乎给的信号：权威等级（1–4）、赞同、评论、是否有精选评论——这些是通用网页搜索没有的。
 * 摘要里的 <em> 高亮去掉；utm 保留（知乎溯源用，去重时按 canonical 比）。额度：站内搜索 5,000 次/天。
 */

import { canonicalizeSourceUrl } from '@/lib/capture/source-provenance';
import { getZhihuConfig, type ZhihuConfig } from '@/lib/config/zhihu.config';
import { createLogger } from '@/lib/logger';
import { getZhihuOpenClient, ZhihuApiError, type ZhihuOpenClient, type ZhihuSearchItem } from './zhihu-open-client';

const log = createLogger('zhihu-discovery');

export interface ZhihuDiscoveryCandidate {
  title: string;
  url: string;
  /** 去掉 <em> 的摘要 */
  snippet: string;
  contentType: string;
  author: string;
  authorityLevel: 1 | 2 | 3 | 4 | null;
  voteUpCount: number;
  commentCount: number;
  featuredComments: string[];
  /** 秒级 */
  editTime: number;
  /** 5–12 分，给 feed 的 sourceScore 与自己排序共用 */
  score: number;
  /** 人话一行：为什么是它（权威 / 赞同 / 有反方评论） */
  reason: string;
}

export function isZhihuSearchEnabled(config: ZhihuConfig = getZhihuConfig()): boolean {
  return Boolean(config.enabled && config.accessSecret);
}

export function stripEm(text: string): string {
  return text.replace(/<\/?em>/g, '').replace(/\s+/g, ' ').trim();
}

/** 基础 5 分（知乎本身是有作者、有社区校验的一手经验源）+ 权威等级 ×1.5 + log10(赞同+1) + 有精选评论 +0.5，上限 12 */
export function scoreZhihuItem(item: Pick<ZhihuSearchItem, 'authorityLevel' | 'voteUpCount' | 'featuredComments'>): number {
  let score = 5;
  if (item.authorityLevel) score += item.authorityLevel * 1.5;
  score += Math.log10(Math.max(0, item.voteUpCount) + 1);
  if (item.featuredComments.length) score += 0.5;
  return Math.min(12, Math.round(score * 10) / 10);
}

const AUTHORITY_LABEL: Record<1 | 2 | 3 | 4, string> = { 1: '一般作者', 2: '有一定权威', 3: '高权威作者', 4: '领域内公认' };

export function reasonFor(item: Pick<ZhihuSearchItem, 'authorityLevel' | 'voteUpCount' | 'featuredComments' | 'contentType'>): string {
  const parts: string[] = [];
  if (item.authorityLevel && item.authorityLevel >= 2) parts.push(AUTHORITY_LABEL[item.authorityLevel]);
  if (item.voteUpCount >= 1000) parts.push(`${(item.voteUpCount / 1000).toFixed(1).replace(/\.0$/, '')}k 赞同`);
  else if (item.voteUpCount >= 50) parts.push(`${item.voteUpCount} 赞同`);
  if (item.featuredComments.length) parts.push('评论区有不同看法');
  if (!parts.length) parts.push(item.contentType === 'Article' ? '一篇成体系的文章' : '一条切题的回答');
  return parts.join(' · ');
}

export function toCandidate(item: ZhihuSearchItem): ZhihuDiscoveryCandidate {
  return {
    title: item.title,
    url: item.url,
    snippet: stripEm(item.summary),
    contentType: item.contentType,
    author: item.authorName,
    authorityLevel: item.authorityLevel,
    voteUpCount: item.voteUpCount,
    commentCount: item.commentCount,
    featuredComments: item.featuredComments,
    editTime: item.editTime,
    score: scoreZhihuItem(item),
    reason: reasonFor(item),
  };
}

export interface SearchZhihuCandidatesOptions {
  count?: number;
  /** 已经在学生材料里的链接（canonical 比对），不再推 */
  excludeUrls?: string[];
  client?: ZhihuOpenClient;
  config?: ZhihuConfig;
}

export async function searchZhihuCandidates(query: string, opts: SearchZhihuCandidatesOptions = {}): Promise<ZhihuDiscoveryCandidate[]> {
  const config = opts.config ?? getZhihuConfig();
  if (!isZhihuSearchEnabled(config)) return [];
  const client = opts.client ?? getZhihuOpenClient();
  const q = query.trim().slice(0, 100);
  if (q.length < 2) return [];
  const exclude = new Set((opts.excludeUrls ?? []).map((u) => canonicalizeSourceUrl(u) ?? u));
  try {
    const result = await client.searchZhihu(q, { count: opts.count ?? 8 });
    const seen = new Set<string>();
    return result.items
      .filter((item) => item.url && item.title)
      .filter((item) => {
        const canonical = canonicalizeSourceUrl(item.url) ?? item.url;
        if (exclude.has(canonical) || seen.has(canonical)) return false;
        seen.add(canonical);
        return true;
      })
      .map(toCandidate)
      .sort((a, b) => b.score - a.score);
  } catch (error) {
    // 检索失败宁可少推（产品论点 §5）：记日志返回空，不让情报流或补货卡整体报错
    log.warn('zhihu search failed', { kind: (error as ZhihuApiError)?.kind, code: (error as ZhihuApiError)?.code });
    return [];
  }
}

export interface ContinueReadingInput {
  /** 学生还没稳的概念（考后来自 assessment），最多取前 3 个 */
  concepts: string[];
  /** 课题 / 收藏夹名，拼进检索词让结果落在同一学科语境 */
  topic?: string;
  /** 材料包里已有的链接，不重复推 */
  excludeUrls?: string[];
  perConcept?: number;
}

export interface ContinueReadingGroup {
  concept: string;
  candidates: ZhihuDiscoveryCandidate[];
}

/** 考后补货：每个没稳的概念搜一次（≤3 次），各留 1–2 条最有根的；一条链接只出现一次 */
export async function continueReading(input: ContinueReadingInput, opts: Pick<SearchZhihuCandidatesOptions, 'client' | 'config'> = {}): Promise<ContinueReadingGroup[]> {
  const concepts = [...new Set(input.concepts.map((c) => c.trim()).filter((c) => c.length >= 2))].slice(0, 3);
  const perConcept = Math.max(1, Math.min(3, input.perConcept ?? 2));
  const topic = input.topic?.trim() ?? '';
  const taken = new Set<string>();
  const groups: ContinueReadingGroup[] = [];
  for (const concept of concepts) {
    const query = topic && !concept.includes(topic) ? `${concept} ${topic}` : concept;
    const candidates = await searchZhihuCandidates(query, { ...opts, count: 8, excludeUrls: input.excludeUrls });
    const picked: ZhihuDiscoveryCandidate[] = [];
    for (const candidate of candidates) {
      const key = canonicalizeSourceUrl(candidate.url) ?? candidate.url;
      if (taken.has(key)) continue;
      taken.add(key);
      picked.push(candidate);
      if (picked.length >= perConcept) break;
    }
    if (picked.length) groups.push({ concept, candidates: picked });
  }
  return groups;
}
