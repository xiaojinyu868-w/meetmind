// 知识库搜索服务
// 集成 Open Notebook 向量搜索 + LongCut 本地搜索降级

import { 
  buildTranscriptIndex, 
  findTextInTranscript,
  type TranscriptSegment 
} from '@/lib/longcut';

const NOTEBOOK_API = process.env.NEXT_PUBLIC_NOTEBOOK_API || 'http://localhost:5055';
const SEARCH_TIMEOUT = 5000;

export interface SearchResult {
  content: string;
  score: number;
  source: 'notebook' | 'local';
  timestamp?: number;
  metadata?: Record<string, any>;
}

/**
 * 检查 Open Notebook 是否可用
 */
export async function isNotebookAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${NOTEBOOK_API}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * 向量搜索（Open Notebook）
 */
async function vectorSearch(query: string): Promise<SearchResult[]> {
  const response = await fetch(`${NOTEBOOK_API}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(SEARCH_TIMEOUT),
  });

  if (!response.ok) {
    throw new Error(`Search failed: ${response.status}`);
  }

  const data = await response.json();
  
  return (data.results || []).map((r: any) => ({
    content: r.content || r.text,
    score: r.score || r.similarity || 0,
    source: 'notebook' as const,
    timestamp: r.metadata?.timestamp,
    metadata: r.metadata,
  }));
}

/**
 * 本地搜索（LongCut quote-matcher）
 */
function localSearch(
  query: string, 
  segments: TranscriptSegment[]
): SearchResult[] {
  if (!segments || segments.length === 0) {
    return [];
  }

  const index = buildTranscriptIndex(segments);
  const match = findTextInTranscript(segments, query, index, {
    strategy: 'all',
    minSimilarity: 0.5,
  });

  if (!match?.found) {
    return [];
  }

  const matchedSegments = segments.slice(
    match.startSegmentIdx, 
    match.endSegmentIdx + 1
  );
  
  const content = matchedSegments.map(s => s.text).join(' ');
  const timestamp = matchedSegments[0]?.start * 1000;

  return [{
    content,
    score: match.similarity,
    source: 'local',
    timestamp,
  }];
}

/**
 * 统一搜索接口（自动降级）
 */
export async function search(
  query: string,
  options: {
    segments?: TranscriptSegment[];
    forceLocal?: boolean;
  } = {}
): Promise<SearchResult[]> {
  const { segments, forceLocal = false } = options;

  // 强制本地搜索
  if (forceLocal && segments) {
    return localSearch(query, segments);
  }

  // 尝试向量搜索
  try {
    const results = await vectorSearch(query);
    if (results.length > 0) {
      return results;
    }
  } catch (error) {
    console.warn('Vector search failed, falling back to local search:', error);
  }

  // 降级到本地搜索
  if (segments && segments.length > 0) {
    return localSearch(query, segments);
  }

  return [];
}

/**
 * 搜索并高亮结果
 */
export function highlightSearchResult(
  content: string, 
  query: string
): string {
  if (!query.trim()) return content;
  
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escapedQuery})`, 'gi');
  
  return content.replace(regex, '<mark>$1</mark>');
}
