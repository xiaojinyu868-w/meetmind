/**
 * Text normalization and segment processing pipeline for video import.
 *
 * All functions are pure — no side effects, no file I/O, no network calls.
 * Extracted from route.ts.
 */

import type { VideoImportMeta, NormalizedSegment, WsResultSentence } from './video-import-types';
import { TIMELINE_SCALE_RATIO_MIN, TIMELINE_SCALE_RATIO_MAX } from './video-import-types';

// ---------------------------------------------------------------------------
// Mojibake / text normalization
// ---------------------------------------------------------------------------

export function isLikelyMojibake(text: string): boolean {
  if (!text) return false;
  return /(Ã.|Â.|å.|æ.|ç.|ï¼|ð|ñ|Ñ|Ð)/.test(text);
}

export function textScoreForChineseReadability(text: string): number {
  const cjkCount = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const mojibakeCount = (text.match(/[ÃÂåæçï¼ðñÑÐ]/g) || []).length;
  const replacementCount = (text.match(/\uFFFD/g) || []).length;
  return cjkCount * 2 - mojibakeCount * 2 - replacementCount * 4;
}

export function normalizePossibleMojibake(input: string): string {
  if (!input || !isLikelyMojibake(input)) return input;
  const candidate = Buffer.from(input, 'latin1').toString('utf8');
  if (!candidate || candidate === input) return input;

  const beforeScore = textScoreForChineseReadability(input);
  const afterScore = textScoreForChineseReadability(candidate);
  return afterScore > beforeScore ? candidate : input;
}

export function normalizeVideoMeta(meta: VideoImportMeta): VideoImportMeta {
  return {
    ...meta,
    title: meta.title ? normalizePossibleMojibake(meta.title) : meta.title,
  };
}

export function normalizeTranscribePayload(data: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...data };

  if (typeof normalized.text === 'string') {
    normalized.text = normalizePossibleMojibake(normalized.text);
  }

  if (Array.isArray(normalized.segments)) {
    normalized.segments = normalized.segments.map((item) => {
      if (!item || typeof item !== 'object') return item;
      const entry = { ...(item as Record<string, unknown>) };
      if (typeof entry.text === 'string') {
        entry.text = normalizePossibleMojibake(entry.text);
      }
      return entry;
    });
  }

  if (Array.isArray(normalized.sentences)) {
    normalized.sentences = normalized.sentences.map((item) => {
      if (!item || typeof item !== 'object') return item;
      const entry = { ...(item as Record<string, unknown>) };
      if (typeof entry.text === 'string') {
        entry.text = normalizePossibleMojibake(entry.text);
      }
      return entry;
    });
  }

  return normalized;
}

// ---------------------------------------------------------------------------
// Segment parsing & normalization
// ---------------------------------------------------------------------------

export function normalizedTextKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s，。！？!?；;：:、"""'''\-—_]/g, '')
    .trim();
}

export function parseSegmentsFromPayload(data: Record<string, unknown>): NormalizedSegment[] {
  const rawSegments = Array.isArray(data.segments)
    ? data.segments
    : Array.isArray(data.sentences)
      ? data.sentences
      : [];

  const parsed: NormalizedSegment[] = [];
  for (let index = 0; index < rawSegments.length; index += 1) {
    const item = rawSegments[index];
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    const text = normalizePossibleMojibake(String(entry.text || '')).trim();
    if (!text) continue;

    const startCandidates = [entry.startMs, entry.beginTime, entry.start_time];
    const endCandidates = [entry.endMs, entry.endTime, entry.end_time];

    let startMs = 0;
    let endMs = 0;
    for (const value of startCandidates) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        startMs = Math.max(0, Math.round(value));
        break;
      }
    }
    for (const value of endCandidates) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        endMs = Math.max(0, Math.round(value));
        break;
      }
    }

    parsed.push({
      id: typeof entry.id === 'string' ? entry.id : `seg-${index}`,
      text,
      startMs,
      endMs,
      confidence: typeof entry.confidence === 'number' && Number.isFinite(entry.confidence)
        ? entry.confidence
        : 0.92,
      isFinal: entry.isFinal !== false,
    });
  }

  return parsed;
}

export function deduplicateAdjacentSegments(segments: NormalizedSegment[]): NormalizedSegment[] {
  if (segments.length <= 1) return segments;
  const deduped: NormalizedSegment[] = [segments[0]];

  for (let index = 1; index < segments.length; index += 1) {
    const current = segments[index];
    const prev = deduped[deduped.length - 1];
    const currentKey = normalizedTextKey(current.text);
    const prevKey = normalizedTextKey(prev.text);

    const isDup = currentKey.length > 0 && currentKey === prevKey;
    if (isDup) {
      prev.endMs = Math.max(prev.endMs, current.endMs);
      prev.confidence = Math.max(prev.confidence, current.confidence);
      continue;
    }

    deduped.push(current);
  }

  return deduped;
}

export function hasUsableTimeline(segments: NormalizedSegment[]): boolean {
  if (segments.length === 0) return false;
  return segments.some((segment) => segment.endMs > segment.startMs && segment.endMs > 0);
}

export function rebuildTimelineByLength(
  segments: NormalizedSegment[],
  targetDurationMs: number,
): NormalizedSegment[] {
  const safeTarget = Math.max(1000, targetDurationMs);
  const totalWeight = segments.reduce((sum, segment) => sum + Math.max(1, segment.text.length), 0);
  let cursor = 0;

  return segments.map((segment, index) => {
    const weight = Math.max(1, segment.text.length);
    const duration = Math.max(300, Math.round((safeTarget * weight) / Math.max(1, totalWeight)));
    const startMs = cursor;
    let endMs = startMs + duration;
    if (index === segments.length - 1) {
      endMs = safeTarget;
    } else if (endMs >= safeTarget) {
      endMs = Math.max(startMs + 300, safeTarget - (segments.length - index - 1) * 300);
    }

    cursor = endMs;
    return {
      ...segment,
      startMs,
      endMs,
    };
  });
}

export function scaleTimeline(segments: NormalizedSegment[], targetDurationMs: number): NormalizedSegment[] {
  const lastEnd = segments[segments.length - 1]?.endMs || 0;
  if (lastEnd <= 0) return segments;
  const ratio = targetDurationMs / lastEnd;
  return segments.map((segment) => ({
    ...segment,
    startMs: Math.max(0, Math.round(segment.startMs * ratio)),
    endMs: Math.max(0, Math.round(segment.endMs * ratio)),
  }));
}

/**
 * Split oversized segments by Chinese punctuation.
 * Typical scenario: turbo sync API merges 30s of text into a single segment.
 */
export function splitLongSegments(
  segments: NormalizedSegment[],
  maxCharsPerSegment: number = 80,
): NormalizedSegment[] {
  const result: NormalizedSegment[] = [];

  for (const segment of segments) {
    if (segment.text.length <= maxCharsPerSegment) {
      result.push(segment);
      continue;
    }

    const parts = segment.text
      .split(/(?<=[。！？；\n])/g)
      .map((s) => s.trim())
      .filter(Boolean);

    let chunks: string[];
    if (parts.length <= 1) {
      chunks = segment.text
        .split(/(?<=[，,、])/g)
        .map((s) => s.trim())
        .filter(Boolean);
    } else {
      chunks = [];
      let buf = '';
      for (const part of parts) {
        if (buf.length + part.length <= maxCharsPerSegment) {
          buf += part;
        } else {
          if (buf) chunks.push(buf);
          buf = part;
        }
      }
      if (buf) chunks.push(buf);
    }

    if (chunks.length <= 1) {
      chunks = [];
      for (let i = 0; i < segment.text.length; i += maxCharsPerSegment) {
        chunks.push(segment.text.slice(i, i + maxCharsPerSegment));
      }
    }

    const segDuration = segment.endMs - segment.startMs;
    const totalChars = chunks.reduce((sum, c) => sum + c.length, 0);
    let cursor = segment.startMs;

    for (const chunk of chunks) {
      const chunkDuration = Math.max(200, Math.round((segDuration * chunk.length) / Math.max(1, totalChars)));
      const endMs = Math.min(cursor + chunkDuration, segment.endMs);
      result.push({
        ...segment,
        id: `seg-${result.length}`,
        text: chunk,
        startMs: cursor,
        endMs: Math.max(cursor + 200, endMs),
        confidence: segment.confidence,
        isFinal: segment.isFinal,
      });
      cursor = endMs;
    }
  }

  return result;
}

/**
 * Master normalization: dedup → split → timeline fix → scale.
 * This is the entry point for all segment normalization.
 */
export function normalizeImportedSegments(
  data: Record<string, unknown>,
  sourceDurationSec?: number,
): NormalizedSegment[] {
  let segments = deduplicateAdjacentSegments(parseSegmentsFromPayload(data));
  if (segments.length === 0) return [];

  segments = splitLongSegments(segments);

  const declaredDurationMs =
    Number.isFinite(sourceDurationSec) && (sourceDurationSec || 0) > 0
      ? Math.round((sourceDurationSec as number) * 1000)
      : 0;
  const rawLastEnd = segments[segments.length - 1]?.endMs || 0;

  if (!hasUsableTimeline(segments)) {
    const estimatedChars = segments.reduce((sum, segment) => sum + segment.text.length, 0);
    const target = declaredDurationMs > 0 ? declaredDurationMs : Math.max(5000, estimatedChars * 140);
    segments = rebuildTimelineByLength(segments, target);
    return segments.map((segment, index) => ({ ...segment, id: `seg-${index}` }));
  }

  if (declaredDurationMs > 0) {
    const ratio = rawLastEnd > 0 ? rawLastEnd / declaredDurationMs : 1;
    const drift = Math.abs(1 - ratio);
    const canSafelyScale = ratio >= TIMELINE_SCALE_RATIO_MIN && ratio <= TIMELINE_SCALE_RATIO_MAX;
    if (canSafelyScale && drift > 0.08) {
      segments = scaleTimeline(segments, declaredDurationMs);
    }
  }

  let cursor = 0;
  segments = segments.map((segment) => {
    const startMs = Math.max(cursor, segment.startMs);
    const endMs = Math.max(startMs + 200, segment.endMs);
    cursor = endMs;
    return {
      ...segment,
      startMs,
      endMs,
    };
  });

  return segments.map((segment, index) => ({ ...segment, id: `seg-${index}` }));
}

// ---------------------------------------------------------------------------
// Subtitle / WebSocket segment converters
// ---------------------------------------------------------------------------

export function mapSubtitleSegmentsToApiSegments(
  segments: Array<{ text: string; startMs: number; endMs: number }>,
): NormalizedSegment[] {
  return segments.map((item, index) => ({
    id: `seg-${index}`,
    text: normalizePossibleMojibake(item.text),
    startMs: item.startMs,
    endMs: item.endMs,
    confidence: 0.99,
    isFinal: true,
  }));
}

export function normalizeWsSegments(
  wsSentences: WsResultSentence[],
): NormalizedSegment[] {
  const ordered = [...wsSentences]
    .filter((item) => typeof item.text === 'string' && item.text.trim())
    .sort((a, b) => {
      const left = Number.isFinite(a.beginTime) ? Number(a.beginTime) : Number.MAX_SAFE_INTEGER;
      const right = Number.isFinite(b.beginTime) ? Number(b.beginTime) : Number.MAX_SAFE_INTEGER;
      return left - right;
    });

  let cursor = 0;
  return ordered.map((item, index) => {
    const text = normalizePossibleMojibake(String(item.text || '').trim());
    const begin = Number.isFinite(item.beginTime) ? Math.max(0, Number(item.beginTime)) : cursor;
    const fallbackDuration = Math.max(500, Math.min(5000, text.length * 120));
    let end = Number.isFinite(item.endTime) ? Number(item.endTime) : begin + fallbackDuration;
    if (end <= begin) end = begin + fallbackDuration;
    cursor = end;

    return {
      id: item.id || `seg-${index}`,
      text,
      startMs: begin,
      endMs: end,
      confidence: Number.isFinite(item.confidence) ? Number(item.confidence) : 0.92,
      isFinal: item.isFinal !== false,
    };
  });
}
