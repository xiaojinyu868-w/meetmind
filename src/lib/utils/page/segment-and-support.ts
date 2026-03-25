/**
 * 转录片段处理 + 补充材料管理。
 */

import type { TranscriptSegment } from '@/types';
import type { SourceIngestItem, SupportReferenceItem } from '@/types/page-types';
import { getCollectionContextDisplayTitle } from '@/lib/capture/collection-context';
import { compactText } from './text-and-constants';

// ── Segment helpers ───────────────────────────────────────────────

export function mapSegmentsForAppend(
  incoming: TranscriptSegment[],
  sourceItemId: string,
  offsetMs: number
): TranscriptSegment[] {
  return incoming.map((segment, index) => {
    const rawStart = Number.isFinite(segment.startMs) ? segment.startMs : 0;
    const rawEnd = Number.isFinite(segment.endMs) ? segment.endMs : rawStart + 1000;
    const startMs = Math.max(0, Math.floor(rawStart + offsetMs));
    const endMs = Math.max(startMs + 300, Math.floor(rawEnd + offsetMs));

    return {
      ...segment,
      id: segment.id || `${sourceItemId}-seg-${index + 1}`,
      sourceItemId,
      startMs,
      endMs,
      confidence: Number.isFinite(segment.confidence) ? segment.confidence : 0.9,
      isFinal: true,
    };
  });
}

export function getSegmentBatchDurationMs(segments: TranscriptSegment[]): number {
  if (!Array.isArray(segments) || segments.length === 0) return 0;
  const startMs = segments[0]?.startMs || 0;
  const endMs = segments[segments.length - 1]?.endMs || 0;
  return Math.max(0, endMs - startMs);
}

// ── Support reference helpers ─────────────────────────────────────

export function buildSupportReferenceSnippet(
  segments: TranscriptSegment[],
  maxLength: number = 2800
): string {
  const chunks = (segments || [])
    .map((segment) => compactText(segment.text || '', 240))
    .filter((item) => item.length > 0);

  if (chunks.length === 0) return '';

  const full = compactText(chunks.join(' '), maxLength);
  if (full.length < maxLength * 0.95 || chunks.length <= 24) {
    return full;
  }

  const head = chunks.slice(0, 10);
  const tail = chunks.slice(Math.max(chunks.length - 6, 10));
  const middleStart = Math.max(10, Math.floor(chunks.length * 0.45));
  const middle = chunks.slice(middleStart, Math.min(middleStart + 8, chunks.length - 6));

  return compactText([...head, ...middle, ...tail].join(' '), maxLength);
}

export function mergeSupportReferences(
  previous: SupportReferenceItem[],
  incoming: SupportReferenceItem[],
  limit: number = 10
): SupportReferenceItem[] {
  const normalized = [...incoming, ...previous]
    .map((item) => ({
      id: item.id,
      title: compactText(item.title || '补充材料', 80),
      snippet: compactText(item.snippet || '', 2800),
    }))
    .filter((item) => item.snippet.length > 0);
  const unique: SupportReferenceItem[] = [];
  const seen = new Set<string>();
  for (const item of normalized) {
    const key = `${item.title.toLowerCase()}::${item.snippet.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
    if (unique.length >= limit) break;
  }
  return unique;
}

export function getSupportReferenceDisplayTitle(item: Pick<SourceIngestItem, 'type' | 'title' | 'preview' | 'fullText'>): string {
  return getCollectionContextDisplayTitle(item, 80) || '补充材料';
}
