import { Topic, TranscriptSegment } from './types';
import {
  buildTranscriptIndex,
  findTextInTranscript,
  type TranscriptIndex,
} from './quote-matcher';
import { parseTimestampRange as parseTimestampRangeStrict } from './timestamp-utils';

type TopicSegment = Topic['segments'][number];

function coerceToNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function normalizeSegment(segment: TopicSegment | null | undefined): TopicSegment | null {
  if (!segment) return null;

  const start = coerceToNumber((segment as any).start);
  const end = coerceToNumber((segment as any).end);

  if (start === null || end === null) {
    return null;
  }

  const startSegmentIdx = coerceToNumber((segment as any).startSegmentIdx);
  const endSegmentIdx = coerceToNumber((segment as any).endSegmentIdx);
  const startCharOffset = coerceToNumber((segment as any).startCharOffset);
  const endCharOffset = coerceToNumber((segment as any).endCharOffset);

  return {
    ...segment,
    start,
    end,
    startSegmentIdx: startSegmentIdx ?? undefined,
    endSegmentIdx: endSegmentIdx ?? undefined,
    startCharOffset: startCharOffset ?? undefined,
    endCharOffset: endCharOffset ?? undefined,
  };
}

function normalizeSegments(segments: TopicSegment[] | null | undefined): TopicSegment[] {
  if (!Array.isArray(segments)) return [];

  const normalized: TopicSegment[] = [];
  for (const segment of segments) {
    const normalizedSegment = normalizeSegment(segment);
    if (normalizedSegment) {
      normalized.push(normalizedSegment);
    }
  }
  return normalized;
}

function normalizeTranscriptSegment(
  segment: TranscriptSegment | null | undefined,
): TranscriptSegment | null {
  if (!segment) return null;

  const start = coerceToNumber((segment as any).start);
  const duration = coerceToNumber((segment as any).duration);

  if (start === null || duration === null) {
    return null;
  }

  const text =
    typeof (segment as any).text === 'string'
      ? (segment as any).text
      : String((segment as any).text ?? '');

  return {
    text,
    start,
    duration,
  };
}

export function normalizeTranscript(
  transcript: TranscriptSegment[] | null | undefined,
): TranscriptSegment[] {
  if (!Array.isArray(transcript)) return [];

  const normalized: TranscriptSegment[] = [];
  for (const segment of transcript) {
    const normalizedSegment = normalizeTranscriptSegment(segment);
    if (normalizedSegment) {
      normalized.push(normalizedSegment);
    }
  }
  return normalized;
}

function computeDuration(segments: TopicSegment[] = []): number {
  return segments.reduce((total, segment) => {
    if (!segment) return total;
    const start = coerceToNumber((segment as any).start);
    const end = coerceToNumber((segment as any).end);
    if (start === null || end === null) return total;
    return total + Math.max(0, end - start);
  }, 0);
}

function parseTimestampRange(timestamp?: string | null): { start: number; end: number } | null {
  if (typeof timestamp !== 'string') return null;
  const trimmed = timestamp.trim();
  if (!trimmed) return null;
  return parseTimestampRangeStrict(trimmed);
}

function approximateTimeOffset(segment: TranscriptSegment | undefined, charOffset?: number | null): number {
  if (!segment) {
    return 0;
  }

  const duration = coerceToNumber((segment as any).duration);
  if (duration === null || duration <= 0) {
    return 0;
  }

  if (
    typeof charOffset !== 'number' ||
    !segment.text ||
    segment.text.length === 0 ||
    Number.isNaN(charOffset)
  ) {
    return 0;
  }

  const safeLength = Math.max(1, segment.text.length);
  const clampedOffset = Math.max(0, Math.min(charOffset, safeLength));
  const ratio = clampedOffset / safeLength;
  return duration * ratio;
}

function createSegmentFromMatch(
  match: NonNullable<ReturnType<typeof findTextInTranscript>>,
  transcript: TranscriptSegment[],
  preferredText?: string,
): TopicSegment | null {
  const startSegment = transcript[match.startSegmentIdx];
  const endSegment = transcript[match.endSegmentIdx];
  if (!startSegment || !endSegment) {
    return null;
  }

  const startOffsetSeconds = approximateTimeOffset(startSegment, match.startCharOffset);
  const endOffsetSeconds = approximateTimeOffset(
    endSegment,
    typeof match.endCharOffset === 'number' ? match.endCharOffset : endSegment.text.length,
  );

  const startTime = startSegment.start + startOffsetSeconds;
  let endTime = endSegment.start + endOffsetSeconds;

  if (!Number.isFinite(endTime) || endTime <= startTime) {
    endTime = endSegment.start + (endSegment.duration || 0);
    if (endTime <= startTime) {
      endTime = startTime + Math.max(5, endSegment.duration || 0);
    }
  }

  const fallbackText = transcript
    .slice(match.startSegmentIdx, match.endSegmentIdx + 1)
    .map((segment) => segment.text)
    .join(' ')
    .trim();

  return {
    start: startTime,
    end: endTime,
    text: (preferredText || fallbackText || '').trim(),
    startSegmentIdx: match.startSegmentIdx,
    endSegmentIdx: match.endSegmentIdx,
    startCharOffset: typeof match.startCharOffset === 'number' ? match.startCharOffset : 0,
    endCharOffset:
      typeof match.endCharOffset === 'number'
        ? match.endCharOffset
        : endSegment.text.length,
    hasCompleteSentences: match.matchStrategy !== 'fuzzy-ngram',
  };
}

function findSegmentIndexByTime(transcript: TranscriptSegment[], time: number): number {
  if (!Number.isFinite(time)) return -1;

  for (let i = 0; i < transcript.length; i++) {
    const segment = transcript[i];
    const segmentEnd = segment.start + segment.duration;
    if (time >= segment.start && time <= segmentEnd) {
      return i;
    }
    if (time < segment.start) {
      return Math.max(0, i - 1);
    }
  }

  return transcript.length - 1;
}

function createSegmentFromTimestamp(
  timestamp: string | undefined,
  transcript: TranscriptSegment[],
  preferredText?: string,
): TopicSegment | null {
  const range = parseTimestampRange(timestamp);
  if (!range) return null;

  let startIdx = findSegmentIndexByTime(transcript, range.start);
  let endIdx = findSegmentIndexByTime(transcript, range.end);

  if (startIdx === -1) startIdx = 0;
  if (endIdx === -1) endIdx = transcript.length - 1;
  if (endIdx < startIdx) endIdx = startIdx;

  const startSegment = transcript[startIdx];
  const endSegment = transcript[endIdx];

  if (!startSegment || !endSegment) {
    return null;
  }

  const startTime = Math.max(startSegment.start, Math.min(range.start, startSegment.start + startSegment.duration));
  let endTime = Math.min(
    endSegment.start + endSegment.duration,
    Math.max(range.end, startTime + Math.max(5, endSegment.duration || 0)),
  );

  if (endTime <= startTime) {
    endTime = startTime + Math.max(5, endSegment.duration || 0);
  }

  const combinedText = transcript
    .slice(startIdx, endIdx + 1)
    .map((segment) => segment.text)
    .join(' ')
    .trim();

  return {
    start: startTime,
    end: endTime,
    text: (preferredText || combinedText || '').trim(),
    startSegmentIdx: startIdx,
    endSegmentIdx: endIdx,
    startCharOffset: 0,
    endCharOffset: endSegment.text.length,
    hasCompleteSentences: false,
  };
}

function createFallbackSegment(transcript: TranscriptSegment[]): TopicSegment | null {
  if (!transcript.length) return null;

  const startSegment = transcript[0];
  let endIdx = 0;
  let endTime = startSegment.start;

  for (let i = 0; i < transcript.length; i++) {
    endIdx = i;
    endTime = transcript[i].start + transcript[i].duration;
    if (endTime - startSegment.start >= 60) {
      break;
    }
  }

  const combinedText = transcript
    .slice(0, endIdx + 1)
    .map((segment) => segment.text)
    .join(' ')
    .trim();

  return {
    start: startSegment.start,
    end: endTime,
    text: combinedText,
    startSegmentIdx: 0,
    endSegmentIdx: endIdx,
    startCharOffset: 0,
    endCharOffset: transcript[endIdx].text.length,
    hasCompleteSentences: false,
  };
}

function ensureTranscriptIndex(
  existingIndex: TranscriptIndex | null,
  transcript: TranscriptSegment[],
): TranscriptIndex {
  if (existingIndex) return existingIndex;
  return buildTranscriptIndex(transcript);
}

export function hydrateTopicsWithTranscript(
  topics: Topic[] | null | undefined,
  transcript: TranscriptSegment[] | null | undefined,
): Topic[] {
  if (!Array.isArray(topics) || topics.length === 0) {
    return Array.isArray(topics) ? topics : [];
  }

  const normalizedTranscript = normalizeTranscript(transcript);
  const hasTranscript = normalizedTranscript.length > 0;

  let transcriptIndex: TranscriptIndex | null = null;

  return topics.map((topic) => {
    let hydratedSegments = normalizeSegments((topic as any)?.segments);

    if (hasTranscript && hydratedSegments.length === 0) {
      if (topic.quote?.text) {
        transcriptIndex = ensureTranscriptIndex(transcriptIndex, normalizedTranscript);
        const match = findTextInTranscript(
          normalizedTranscript,
          topic.quote.text,
          transcriptIndex,
          {
          strategy: 'all',
          minSimilarity: 0.75,
          },
        );

        if (match) {
          const segment = createSegmentFromMatch(
            match,
            normalizedTranscript,
            topic.quote.text,
          );
          if (segment) {
            hydratedSegments = [segment];
          }
        }
      }

      if (hydratedSegments.length === 0) {
        const segmentFromTimestamp = createSegmentFromTimestamp(
          topic.quote?.timestamp,
          normalizedTranscript,
          topic.quote?.text,
        );
        if (segmentFromTimestamp) {
          hydratedSegments = [segmentFromTimestamp];
        }
      }

      if (hydratedSegments.length === 0) {
        const fallbackSegment = createFallbackSegment(normalizedTranscript);
        if (fallbackSegment) {
          hydratedSegments = [fallbackSegment];
        }
      }
    }

    const durationSeconds = computeDuration(hydratedSegments);
    const duration = durationSeconds > 0 ? Math.round(durationSeconds) : topic.duration ?? 0;

    return {
      ...topic,
      segments: hydratedSegments,
      duration,
    };
  });
}
