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
  interimText = '',
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

  const stableRows = source
    .filter((line) => line.text.trim().length > 0)
    .slice(-Math.max(1, maxFinalRows))
    .map((line) => ({
      id: line.id,
      text: line.text.trim(),
      startMs: Math.max(0, line.startMs),
    }));

  const interim = interimText.trim();
  if (!interim) return stableRows;

  const lastStableText = stableRows[stableRows.length - 1]?.text.trim();
  if (lastStableText && lastStableText === interim) return stableRows;

  return [
    ...stableRows,
    {
      id: 'live-interim',
      text: interim,
      startMs: stableRows[stableRows.length - 1]?.startMs ?? 0,
    },
  ];
}
