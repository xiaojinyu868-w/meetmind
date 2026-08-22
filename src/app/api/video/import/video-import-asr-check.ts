/**
 * ASR result completeness checks for the video import pipeline.
 *
 * Pure functions shared by every transcription channel (HTTP 三模式 /
 * direct filetrans / WS fallback) so no channel can silently accept a
 * truncated transcript. Extracted from video-import-types.ts to keep
 * that file within the 300-line type-file limit.
 */

import {
  PCM_BYTES_PER_SEC,
  MIN_DURATION_FOR_COMPLETENESS_CHECK_SEC,
  MIN_TEXT_CHARS_PER_SEC,
  MIN_TEXT_COVERAGE_RATIO,
  MIN_TIMELINE_COVERAGE_SHORT,
  MIN_TIMELINE_COVERAGE_LONG,
} from './video-import-types';

export function toFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function readSegmentEndMs(entry: Record<string, unknown>): number {
  const endCandidates = [entry.endMs, entry.endTime, entry.end_time];
  for (const value of endCandidates) {
    const parsed = toFiniteNumber(value);
    if (parsed !== null) return Math.max(0, Math.round(parsed));
  }
  return 0;
}

export function summarizeAsrResult(data: Record<string, unknown>): { segCount: number; textLen: number; lastEndMs: number } {
  const rawSegments = Array.isArray(data.segments)
    ? data.segments
    : Array.isArray(data.sentences)
      ? data.sentences
      : [];
  const segments = rawSegments.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object');
  const textLenFromData = typeof data.text === 'string' ? (data.text as string).length : 0;
  const textLenFromSegments = segments.reduce((sum, segment) => {
    const text = typeof segment.text === 'string' ? segment.text.trim() : '';
    return sum + text.length;
  }, 0);
  const textLen = Math.max(textLenFromData, textLenFromSegments);
  const lastEndMs = segments.reduce((max, segment) => Math.max(max, readSegmentEndMs(segment)), 0);
  return {
    segCount: segments.length,
    textLen,
    lastEndMs,
  };
}

export interface AsrCoverageAssessment {
  segCount: number;
  textLen: number;
  /** 最后一段时间戳 / 期望时长；无时间线时为 null */
  timelineCoverage: number | null;
  timelineDetail: string;
  insufficient: boolean;
}

export function assessAsrCoverage(
  data: Record<string, unknown>,
  expectedDurationSec?: number,
): AsrCoverageAssessment {
  const { segCount, textLen, lastEndMs } = summarizeAsrResult(data);
  const expectedDurationMs =
    Number.isFinite(expectedDurationSec) && (expectedDurationSec || 0) > 0
      ? Math.round((expectedDurationSec as number) * 1000)
      : 0;
  const timelineCoverage = expectedDurationMs > 0 && lastEndMs > 0 ? lastEndMs / expectedDurationMs : null;

  const minTimelineCoverage =
    expectedDurationSec && expectedDurationSec > 120
      ? MIN_TIMELINE_COVERAGE_LONG
      : MIN_TIMELINE_COVERAGE_SHORT;
  const isTextInsufficient = Boolean(
    expectedDurationSec &&
    expectedDurationSec > MIN_DURATION_FOR_COMPLETENESS_CHECK_SEC &&
    textLen > 0 &&
    textLen < expectedDurationSec * MIN_TEXT_CHARS_PER_SEC * MIN_TEXT_COVERAGE_RATIO
  );
  const isTimelineInsufficient = Boolean(
    expectedDurationSec &&
    expectedDurationSec > MIN_DURATION_FOR_COMPLETENESS_CHECK_SEC &&
    timelineCoverage !== null &&
    timelineCoverage < minTimelineCoverage
  );
  const timelineDetail =
    timelineCoverage === null
      ? 'timelineCoverage=n/a'
      : `timelineCoverage=${timelineCoverage.toFixed(2)} (need >=${minTimelineCoverage})`;

  return {
    segCount,
    textLen,
    timelineCoverage,
    timelineDetail,
    insufficient: isTextInsufficient || isTimelineInsufficient,
  };
}

export function estimatePcmDurationMs(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  return Math.round((bytes / PCM_BYTES_PER_SEC) * 1000);
}
