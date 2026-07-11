import type { TranscriptSegment } from '@/types';

export interface LiveTranslationLine {
  id: string;
  text: string;
  startMs: number;
  speakerId?: string;
}

interface RecentLine {
  id: string;
  text: string;
  startMs: number;
  speakerId?: string;
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
        speakerId: segment.speakerId,
      }))
    : recentLines;

  const stableRows = source
    .filter((line) => line.text.trim().length > 0)
    .slice(-Math.max(1, maxFinalRows))
    .map((line) => ({
      id: line.id,
      // M14.5.6: 保留 ASR raw 的 trailing/leading space —— 这是区分
      // "词边界" vs "词中切" 的关键信号。
      text: line.text.replace(/[\n\r\t]+/g, ' '),
      startMs: Math.max(0, line.startMs),
      speakerId: line.speakerId,
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
