import type {
  AppExecutionResult,
  TeachBackEvaluation,
  TeachBackEvaluationItem,
  TeachBackEvidence,
  TeachBackTarget,
} from '@/lib/ai-native/types';

/** 从插件执行结果里读讲述目标（render.payload.targets），缺字段向安全方向兜底。 */
export function normalizeTeachBackTargets(result: AppExecutionResult | null): TeachBackTarget[] {
  const payload = result?.render?.payload as { targets?: unknown } | undefined;
  const raw = Array.isArray(payload?.targets) ? payload.targets : [];
  return raw.flatMap((item, index) => {
    if (!item || typeof item !== 'object') return [];
    const value = item as Record<string, unknown>;
    const point = typeof value.point === 'string' ? value.point.trim() : '';
    if (!point) return [];
    const evidenceRaw = value.evidence as Partial<TeachBackEvidence> | null | undefined;
    const evidence: TeachBackEvidence | null =
      evidenceRaw &&
      typeof evidenceRaw.startMs === 'number' &&
      Number.isFinite(evidenceRaw.startMs) &&
      typeof evidenceRaw.endMs === 'number' &&
      Number.isFinite(evidenceRaw.endMs)
        ? {
            startMs: Math.max(0, evidenceRaw.startMs),
            endMs: Math.max(0, evidenceRaw.endMs),
            snippet: typeof evidenceRaw.snippet === 'string' ? evidenceRaw.snippet : '',
          }
        : null;
    return [{
      id: typeof value.id === 'string' && value.id.trim() ? value.id : `target-${index + 1}`,
      point,
      ...(typeof value.why === 'string' && value.why.trim() ? { why: value.why.trim() } : {}),
      evidence,
    }];
  });
}

export type TeachBackQuadrantGroup =
  | 'blind-spot'
  | 'aware-gap'
  | 'productive-struggle'
  | 'mastery'
  | 'uncovered';

/** 展示顺序：盲区最值得先看见，讲透的放最后。 */
export const TEACH_BACK_GROUP_ORDER: TeachBackQuadrantGroup[] = [
  'blind-spot',
  'aware-gap',
  'productive-struggle',
  'mastery',
  'uncovered',
];

export interface TeachBackResultView {
  headline: string;
  groups: Array<{ key: TeachBackQuadrantGroup; items: TeachBackEvaluationItem[] }>;
  counts: Record<TeachBackQuadrantGroup, number>;
  total: number;
}

function groupKeyOf(item: TeachBackEvaluationItem): TeachBackQuadrantGroup {
  return item.quadrant ?? 'uncovered';
}

export function buildTeachBackResultView(evaluation: TeachBackEvaluation): TeachBackResultView {
  const counts: Record<TeachBackQuadrantGroup, number> = {
    'blind-spot': 0,
    'aware-gap': 0,
    'productive-struggle': 0,
    mastery: 0,
    uncovered: 0,
  };
  const buckets = new Map<TeachBackQuadrantGroup, TeachBackEvaluationItem[]>();
  for (const item of evaluation.items) {
    const key = groupKeyOf(item);
    counts[key] += 1;
    const bucket = buckets.get(key) ?? [];
    bucket.push(item);
    buckets.set(key, bucket);
  }
  return {
    headline: evaluation.headline,
    groups: TEACH_BACK_GROUP_ORDER
      .map((key) => ({ key, items: buckets.get(key) ?? [] }))
      .filter((group) => group.items.length > 0),
    counts,
    total: evaluation.items.length,
  };
}

export function formatEvidenceTimestamp(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
