import type { TranscriptSegment } from '@/types';

const LIVE_RECORDING_APPEND_GAP_MS = 1200;

function normalizeLiveRecordingSegment(
  segment: TranscriptSegment,
  sourceItemId: string,
  offsetMs: number,
  index: number
): TranscriptSegment {
  const rawStart = Number.isFinite(segment.startMs) ? segment.startMs : 0;
  const rawEnd = Number.isFinite(segment.endMs) ? segment.endMs : rawStart + 1000;
  const startMs = Math.max(0, Math.floor(rawStart + offsetMs));
  const endMs = Math.max(startMs + 300, Math.floor(rawEnd + offsetMs));

  return {
    ...segment,
    id: segment.id || `${sourceItemId}-seg-${index + 1}`,
    sourceItemId,
    startMs,
    endMs,
    confidence: Number.isFinite(segment.confidence) ? segment.confidence : 0.9,
    isFinal: true,
  };
}

export function resolveLiveRecordingAppendOffset(
  existingSegments: TranscriptSegment[],
  fallbackDurationMs = 0
): number {
  const lastSegmentEndMs =
    Array.isArray(existingSegments) && existingSegments.length > 0
      ? existingSegments[existingSegments.length - 1]?.endMs || 0
      : 0;
  const baseDurationMs = Math.max(lastSegmentEndMs, fallbackDurationMs);

  return baseDurationMs > 0 ? baseDurationMs + LIVE_RECORDING_APPEND_GAP_MS : 0;
}

export function appendLiveRecordingSegments(params: {
  existingSegments: TranscriptSegment[];
  incomingSegments: TranscriptSegment[];
  sourceItemId: string;
  offsetMs: number;
}): {
  appendedSegments: TranscriptSegment[];
  mergedSegments: TranscriptSegment[];
  totalDurationMs: number;
} {
  const appendedSegments = (params.incomingSegments || []).map((segment, index) =>
    normalizeLiveRecordingSegment(segment, params.sourceItemId, params.offsetMs, index)
  );
  const mergedSegments =
    params.existingSegments.length > 0
      ? [...params.existingSegments, ...appendedSegments]
      : appendedSegments;

  return {
    appendedSegments,
    mergedSegments,
    totalDurationMs: mergedSegments[mergedSegments.length - 1]?.endMs || 0,
  };
}
