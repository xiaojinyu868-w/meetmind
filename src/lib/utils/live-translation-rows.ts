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
      // M14.5.6: 保留 ASR raw 的 trailing/leading space —— 这是区分
      // "词边界" vs "词中切" 的关键信号。
      //   "the standards of beauty " (词边界，带空格) + "are often..."  → 加空格连
      //   "look" + "s and..." (词中切，没空格) → 无缝愈合成 "looks and..."
      // 之前 .trim() 把这个信号抹掉，stitchLiveSentences 误判 "beauty"+"are"="beautyare"。
      // 仅去掉换行/制表符，但保留普通空格。
      text: line.text.replace(/[\n\r\t]+/g, ' '),
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
