import type { TranscriptSegment } from '@/types';

export interface LiveTranslationLine {
  id: string;
  text: string;
  startMs: number;
}

interface RecentLine {
  id: string;
  text: string;
  startMs: number;
}

export function buildLiveTranslationRows({
  segments = [],
  recentLines = [],
  maxFinalRows = 2,
}: {
  segments?: TranscriptSegment[];
  recentLines?: RecentLine[];
  interimText?: string;
  maxFinalRows?: number;
}): LiveTranslationLine[] {
  const source = segments.length > 0
    ? segments.map((segment, index) => ({
        id: String(segment.id ?? `segment-${index}`),
        text: segment.text,
        startMs: segment.startMs,
      }))
    : recentLines;

  return source
    .filter((line) => line.text.trim().length > 0)
    .slice(-Math.max(1, maxFinalRows))
    .map((line) => ({
      id: line.id,
      text: line.text.trim(),
      startMs: Math.max(0, line.startMs),
    }));
}
