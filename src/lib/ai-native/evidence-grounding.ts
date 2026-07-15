import type { TranscriptSegment } from '@/types';

export interface GroundedEvidence {
  segment?: TranscriptSegment;
  supported: boolean;
  score: number;
  overlap: number;
  method: 'text' | 'timestamp' | 'fallback' | 'none';
}

function clean(value: string): string {
  return value.replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

function evidenceTokens(value: string): Set<string> {
  const normalized = clean(value);
  const tokens = new Set<string>();

  for (const word of normalized.match(/[\p{L}\p{N}]{2,}/gu) ?? []) {
    tokens.add(word);
  }

  const compact = normalized.replace(/[^\p{L}\p{N}]+/gu, '');
  for (let index = 0; index < compact.length - 1; index += 1) {
    tokens.add(compact.slice(index, index + 2));
  }
  return tokens;
}

function similarity(query: Set<string>, evidence: Set<string>): { overlap: number; score: number } {
  if (query.size === 0 || evidence.size === 0) return { overlap: 0, score: 0 };
  let overlap = 0;
  for (const token of query) if (evidence.has(token)) overlap += 1;
  return { overlap, score: overlap / Math.max(1, Math.min(query.size, evidence.size)) };
}

function segmentAt(segments: TranscriptSegment[], timestampMs?: number): TranscriptSegment | undefined {
  if (typeof timestampMs !== 'number' || !Number.isFinite(timestampMs) || timestampMs < 0) return undefined;
  return segments.find((segment) => timestampMs >= segment.startMs && timestampMs <= segment.endMs);
}

/**
 * 将模型产物重新落到真实原文。模型时间戳只是候选，文本支持才是证据；
 * 匹配不到时仍返回一个可用于安全兜底的片段，但 supported=false，调用方不得
 * 把原模型陈述与该片段伪装成已核对引用。
 */
export function resolveGroundedEvidence(
  claimText: string,
  segments: TranscriptSegment[],
  candidateTimestampMs?: number,
): GroundedEvidence {
  if (segments.length === 0) {
    return { supported: false, score: 0, overlap: 0, method: 'none' };
  }

  const query = evidenceTokens(claimText);
  let bestSegment: TranscriptSegment | undefined;
  let bestScore = 0;
  let bestOverlap = 0;

  for (const segment of segments) {
    const next = similarity(query, evidenceTokens(segment.text || ''));
    if (next.score > bestScore || (next.score === bestScore && next.overlap > bestOverlap)) {
      bestSegment = segment;
      bestScore = next.score;
      bestOverlap = next.overlap;
    }
  }

  const minimumOverlap = query.size <= 5 ? 1 : 2;
  if (bestSegment && bestOverlap >= minimumOverlap && bestScore >= 0.16) {
    return {
      segment: bestSegment,
      supported: true,
      score: bestScore,
      overlap: bestOverlap,
      method: 'text',
    };
  }

  const timestampSegment = segmentAt(segments, candidateTimestampMs);
  if (timestampSegment) {
    return {
      segment: timestampSegment,
      supported: false,
      score: bestScore,
      overlap: bestOverlap,
      method: 'timestamp',
    };
  }

  return {
    segment: bestSegment ?? segments[0],
    supported: false,
    score: bestScore,
    overlap: bestOverlap,
    method: 'fallback',
  };
}
