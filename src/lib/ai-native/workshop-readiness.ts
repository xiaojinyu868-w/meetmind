import { getWorkshopAppKeysForTier, isWorkshopAppKey } from '@/lib/ai-native/app-catalog';
import type {
  ContextTier,
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
  'teach-back',
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
  /** 当前学习对象。默认单课；unit / exam 才允许跨课压缩型应用。 */
  contextTier?: ContextTier;
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
  const tierAppKeys = getWorkshopAppKeysForTier(input.contextTier ?? 'class');
  const isCuratedDemo = input.contextType?.trim().toLowerCase() === 'demo';

  // 官方试听课不是用户上传的未知短片段，而是经过策划、证据完整的能力样本。
  // 它必须让用户看见完整应用矩阵；真实短碎片仍继续走下方严格门禁。
  if (isCuratedDemo && evidence.segmentCount >= 2 && evidence.characterCount >= 80) {
    return {
      status: 'ready',
      contentKind: 'lecture',
      recommendedAppKey: 'flashcards',
      allowedAppKeys: tierAppKeys,
      reason: 'ready',
      confidence: 'high',
      evidence,
    };
  }

  if (evidence.characterCount < 80 || (evidence.segmentCount < 2 && evidence.characterCount < 1_500)) {
    // 空内容 / 极短碎片 → 真的没材料。
    // 注意：单段但文字足够（早期课堂只有 normalizedText 快照、没有时间轴）不算没材料，
    // 应用可以基于文字正常工作，只是没有可回跳的时间锚点。
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
    // 短材料：能力不裁剪（是否生成是用户的决定，生成不了由插件诚实说明），
    // 只把学习信号转成推荐——有标记先检验，有难点先回忆。
    const candidate = (input.activeAnchorCount ?? 0) > 0 && tierAppKeys.includes('quiz')
      ? 'quiz'
      : (input.keyDifficulties?.length ?? 0) > 0 && tierAppKeys.includes('flashcards')
        ? 'flashcards'
        : null;

    return {
      status: 'limited',
      contentKind: 'fragment',
      recommendedAppKey: candidate,
      allowedAppKeys: tierAppKeys,
      reason: 'partial_learning',
      confidence: 'medium',
      evidence,
    };
  }

  const candidateRecommendation = (input.activeAnchorCount ?? 0) > 0
    ? 'quiz'
    : (input.keyDifficulties?.length ?? 0) > 0
      ? 'flashcards'
      : evidence.segmentCount >= 24
        ? 'mindmap'
        : null;
  const recommendedAppKey = candidateRecommendation && tierAppKeys.includes(candidateRecommendation)
    ? candidateRecommendation
    : null;

  return {
    status: 'ready',
    contentKind: 'unknown',
    recommendedAppKey,
    allowedAppKeys: tierAppKeys,
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
  const tierAppKeys = getWorkshopAppKeysForTier(input.contextTier ?? 'class');
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
    // 内容分类模型只能决定推荐，不是功能权限系统。客观证据门已经确认材料足够时，
    // 即使模型把课堂讨论误判成 casual / administrative，也不能让用户面对一整页
    // “暂不可用”。保留内容类型供后续提示使用，但恢复当前层全部稳定能力。
    if (fallback.status !== 'not_ready') {
      return {
        ...fallback,
        contentKind,
        recommendedAppKey: null,
        confidence,
      };
    }
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

  // “推荐什么”与“产品能做什么”是两件事。只要客观证据越过了空内容下限，
  // 模型就只负责挑出此刻最合适的一项；ready / limited 都不再裁剪 allowedAppKeys，
  // 生成不了的能力由插件在执行时诚实说明（CONTENT_NOT_READY），而不是在门口禁用。
  // 客观下限都没过时，服务端不放行（execute 统一返回 CONTENT_NOT_READY）。
  const resolvedAllowed = fallback.status === 'not_ready'
    ? []
    : tierAppKeys;
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
