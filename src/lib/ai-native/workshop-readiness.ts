import { isWorkshopAppKey } from '@/lib/ai-native/app-catalog';
import type {
  WorkshopAppKey,
  WorkshopContentKind,
  WorkshopReadinessAssessment,
} from '@/lib/ai-native/types';
import type { TranscriptSegment } from '@/types';

export const ALL_WORKSHOP_APP_KEYS: WorkshopAppKey[] = [
  'cheatsheet',
  'flashcards',
  'quiz',
  'mindmap',
  'infographic',
  'audio-overview',
];

const CONTENT_KINDS = new Set<WorkshopContentKind>([
  'lecture',
  'discussion',
  'reading',
  'casual',
  'administrative',
  'fragment',
  'unreliable',
  'unknown',
]);

export interface AssessWorkshopReadinessInput {
  transcript: TranscriptSegment[];
  contextTitle?: string;
  contextType?: string;
  activeAnchorCount?: number;
  keyDifficulties?: string[];
  summary?: string;
  goalIntent?: string;
}

function compact(value: unknown, max: number): string {
  const normalized = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return normalized.slice(0, max);
}

export function getWorkshopEvidence(
  transcript: TranscriptSegment[],
): WorkshopReadinessAssessment['evidence'] {
  const usable = transcript.filter((segment) => compact(segment.text, 10_000).length > 0);
  return {
    segmentCount: usable.length,
    characterCount: usable.reduce((total, segment) => total + compact(segment.text, 10_000).length, 0),
    durationMs: usable.reduce((max, segment) => Math.max(max, segment.endMs), 0),
  };
}

export function fallbackWorkshopReadiness(
  input: AssessWorkshopReadinessInput,
): WorkshopReadinessAssessment {
  const evidence = getWorkshopEvidence(input.transcript);
  if (evidence.segmentCount < 2 || evidence.characterCount < 80 || evidence.durationMs < 20_000) {
    return {
      status: 'not_ready',
      contentKind: 'fragment',
      recommendedAppKey: null,
      allowedAppKeys: [],
      reason: 'insufficient_content',
      confidence: 'high',
      evidence,
    };
  }

  if (evidence.characterCount < 220 || evidence.durationMs < 60_000) {
    return {
      status: 'limited',
      contentKind: 'fragment',
      recommendedAppKey: null,
      allowedAppKeys: [],
      reason: 'partial_learning',
      confidence: 'low',
      evidence,
    };
  }

  const recommendedAppKey = (input.activeAnchorCount ?? 0) > 0
    ? 'quiz'
    : (input.keyDifficulties?.length ?? 0) > 0
      ? 'flashcards'
      : evidence.segmentCount >= 24
        ? 'mindmap'
        : null;

  return {
    status: 'ready',
    contentKind: 'unknown',
    recommendedAppKey,
    allowedAppKeys: ALL_WORKSHOP_APP_KEYS,
    reason: 'ready',
    confidence: 'low',
    evidence,
  };
}

function sanitizeAppKeys(value: unknown): WorkshopAppKey[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter(
    (item): item is WorkshopAppKey => typeof item === 'string' && isWorkshopAppKey(item),
  ))).slice(0, ALL_WORKSHOP_APP_KEYS.length);
}

export function sanitizeWorkshopReadinessAssessment(
  raw: unknown,
  input: AssessWorkshopReadinessInput,
): WorkshopReadinessAssessment {
  const fallback = fallbackWorkshopReadiness(input);
  if (!raw || typeof raw !== 'object') return fallback;

  const value = raw as Record<string, unknown>;
  const status = value.status === 'ready' || value.status === 'limited' || value.status === 'not_ready'
    ? value.status
    : fallback.status;
  const contentKind = CONTENT_KINDS.has(value.contentKind as WorkshopContentKind)
    ? value.contentKind as WorkshopContentKind
    : fallback.contentKind;
  const confidence = value.confidence === 'high' || value.confidence === 'medium' || value.confidence === 'low'
    ? value.confidence
    : fallback.confidence;

  if (status === 'not_ready') {
    const reason = value.reason === 'not_learning' || contentKind === 'casual' || contentKind === 'administrative'
      ? 'not_learning'
      : value.reason === 'unreliable_transcript' || contentKind === 'unreliable'
        ? 'unreliable_transcript'
        : 'insufficient_content';
    return {
      status,
      contentKind,
      recommendedAppKey: null,
      allowedAppKeys: [],
      reason,
      confidence,
      evidence: fallback.evidence,
    };
  }

  const allowedAppKeys = sanitizeAppKeys(value.allowedAppKeys);
  // “推荐什么”与“产品能做什么”是两件事。材料已经完整时，模型只负责挑出
  // 此刻最合适的一项，不再通过 allowedAppKeys 裁掉其余稳定能力。
  const resolvedAllowed = status === 'ready'
    ? ALL_WORKSHOP_APP_KEYS
    : allowedAppKeys.slice(0, 2);
  const rawRecommendation = typeof value.recommendedAppKey === 'string' && isWorkshopAppKey(value.recommendedAppKey)
    ? value.recommendedAppKey
    : null;
  const recommendedAppKey = rawRecommendation && resolvedAllowed.includes(rawRecommendation)
    ? rawRecommendation
    : null;

  return {
    status,
    contentKind,
    recommendedAppKey,
    allowedAppKeys: resolvedAllowed,
    reason: status === 'limited' ? 'partial_learning' : 'ready',
    confidence,
    evidence: fallback.evidence,
  };
}
