import type { Anchor, TranscriptSegment } from '@/types';
import type {
  AppExecuteRequest,
  AppExecutionContext,
  ApplicationGoal,
  DataSourceType,
  MemoryLayerSnapshot,
} from './types';

function normalizeGoal(goal: ApplicationGoal | string): ApplicationGoal {
  if (typeof goal === 'string') {
    return {
      intent: goal.trim() || '未定义目标',
      expectedOutput: 'mixed',
    };
  }

  return {
    intent: goal.intent?.trim() || '未定义目标',
    constraints: Array.isArray(goal.constraints) ? goal.constraints : undefined,
    expectedOutput: goal.expectedOutput ?? 'mixed',
  };
}

function normalizeTranscript(transcript: TranscriptSegment[] | undefined): TranscriptSegment[] {
  if (!Array.isArray(transcript)) return [];
  return transcript.filter(
    (segment) =>
      segment &&
      typeof segment.text === 'string' &&
      typeof segment.startMs === 'number' &&
      typeof segment.endMs === 'number'
  );
}

function normalizeAnchors(anchors: Anchor[] | undefined): Anchor[] {
  if (!Array.isArray(anchors)) return [];
  return anchors.filter(
    (anchor) =>
      anchor &&
      typeof anchor.id === 'string' &&
      typeof anchor.timestamp === 'number' &&
      typeof anchor.resolved === 'boolean' &&
      typeof anchor.cancelled === 'boolean'
  );
}

function buildTimelineMemory(transcript: TranscriptSegment[], anchors: Anchor[]) {
  const durationMs = transcript.reduce((max, segment) => Math.max(max, segment.endMs), 0);
  const unresolvedAnchorCount = anchors.filter((anchor) => !anchor.cancelled && !anchor.resolved).length;

  return {
    durationMs,
    segmentCount: transcript.length,
    unresolvedAnchorCount,
  };
}

export function buildExecutionContext(payload: AppExecuteRequest): AppExecutionContext {
  const transcript = normalizeTranscript(payload.input?.transcript);
  const anchors = normalizeAnchors(payload.input?.anchors);
  const sessionId = payload.input?.sessionId?.trim() || `session-${Date.now()}`;
  const dataSource: DataSourceType = payload.input?.dataSource ?? 'unknown';
  const model = payload.model?.trim();

  const memory: MemoryLayerSnapshot = {
    ...payload.memory,
    timeline: payload.memory?.timeline ?? buildTimelineMemory(transcript, anchors),
  };

  return {
    input: {
      sessionId,
      dataSource,
      transcript,
      anchors,
      metadata: payload.input?.metadata,
    },
    memory,
    goal: normalizeGoal(payload.goal),
    model: model || undefined,
  };
}
