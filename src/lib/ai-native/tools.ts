import type { TranscriptSegment } from '@/types';
import type { AppPluginTools, SearchTranscriptParams } from './types';

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function scoreSegment(segment: TranscriptSegment, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 0;
  const segmentTokens = new Set(tokenize(segment.text));
  let score = 0;

  for (const token of queryTokens) {
    if (segmentTokens.has(token)) {
      score += 1;
    }
  }

  return score;
}

function searchTranscript({
  transcript,
  query,
  limit = 5,
}: SearchTranscriptParams): TranscriptSegment[] {
  const queryTokens = tokenize(query);
  const ranked = transcript
    .map((segment) => ({ segment, score: scoreSegment(segment, queryTokens) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.segment.startMs - b.segment.startMs)
    .slice(0, Math.max(1, limit));

  return ranked.map((item) => item.segment);
}

function summarizeSegments(segments: TranscriptSegment[], maxChars: number = 260): string {
  const merged = segments
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(' ');

  if (merged.length <= maxChars) return merged;
  return `${merged.slice(0, Math.max(0, maxChars - 3))}...`;
}

export function createPluginTools(): AppPluginTools {
  return {
    searchTranscript,
    summarizeSegments,
    now: () => new Date().toISOString(),
  };
}
