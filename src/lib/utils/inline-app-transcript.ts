import type { TranscriptSegment } from '@/types';

export function hasEnoughInlineAppTranscript(
  segments: Array<Pick<TranscriptSegment, 'text'>>,
  minSegments = 2,
  minChars = 50,
): boolean {
  const totalLen = segments.reduce((sum, segment) => sum + (segment.text?.trim().length || 0), 0);
  return segments.length >= minSegments && totalLen >= minChars;
}

export function selectInlineAppTranscript<T extends Pick<TranscriptSegment, 'text'>>(
  primary: T[],
  fallback: T[],
): T[] {
  return hasEnoughInlineAppTranscript(primary) ? primary : fallback;
}
