/**
 * learner-context-local — 从本机能拿到的事实拼出 LearnerContext（source: 'local'）。
 *
 * 外部 context 系统合并前，这就是读槽里流的数据：会话层检验结果（review-session-outcomes → 掌握轨迹）、
 * 最近学习现场、长期理解里的困惑 / 主题 / 偏好 / 目标。它和问同学书桌、「我的上下文」掌握轨迹读同一份事实，
 * 所以学生在三处看到的是同一个自己。接上远端后，这里只剩访客与离线兜底。
 *
 * 放在 components 层而不是 lib：依赖 components/mastery-trail（纯模型）与 review-session-outcomes；
 * lib 不允许反向 import components。
 */

import type { LearningActivityEntry, LearningMemoryEntry } from '@/types/user';
import {
  LEARNER_CONTEXT_VERSION,
  type LearnerConceptState,
  type LearnerContext,
  type LearnerContextRequest,
} from '@/types/learner-context';
import type { StoredAssessment } from '@/components/apps/review-session-outcomes';
import { buildMasteryTrail, collectDeviceOutcomes } from '@/components/mastery-trail';

export interface LocalLearnerContextInput {
  appId: string;
  sessionId?: string;
  learnerId?: string;
  /** 不传则扫本机全部会话层结果 */
  outcomes?: readonly StoredAssessment[];
  activities?: readonly LearningActivityEntry[];
  memories?: readonly LearningMemoryEntry[];
  limit?: number;
}

export function buildLearnerContextRequest(input: Pick<LocalLearnerContextInput, 'appId' | 'sessionId' | 'learnerId' | 'limit'>): LearnerContextRequest {
  return {
    v: LEARNER_CONTEXT_VERSION,
    appId: input.appId,
    learnerId: input.learnerId,
    sessionId: input.sessionId,
    need: ['mastery', 'recent', 'challenges', 'topics', 'goals'],
    limit: input.limit ?? 8,
  };
}

export function buildLocalLearnerContext(input: LocalLearnerContextInput): LearnerContext {
  const limit = input.limit ?? 8;
  const outcomes: ReadonlyArray<StoredAssessment & { sessionId?: string }> = input.outcomes ?? collectDeviceOutcomes();
  // 每个概念的证据落在哪节课：本机记录从 localStorage key 带回 sessionId（device-outcomes）；调用方自带的 outcomes 没有就按当前课
  const sessionByConcept = new Map<string, string | undefined>();
  for (const record of [...outcomes].sort((a, b) => a.at - b.at)) {
    for (const item of record.items) sessionByConcept.set(item.concept.replace(/\s+/g, ' ').trim().toLowerCase(), record.sessionId ?? input.sessionId);
  }
  const trail = buildMasteryTrail(outcomes, limit * 2);
  const mastery: LearnerConceptState[] = trail.slice(0, limit).map((entry) => ({
    concept: entry.concept,
    status: entry.status,
    lastAt: new Date(entry.lastAt).toISOString(),
    steps: entry.steps.slice(-8).map((step) => ({ appId: step.appKey, positive: step.positive, at: new Date(step.at).toISOString() })),
    evidence: entry.evidence
      ? { sessionId: sessionByConcept.get(entry.concept.replace(/\s+/g, ' ').trim().toLowerCase()), startMs: entry.evidence.startMs, endMs: entry.evidence.endMs }
      : sessionByConcept.get(entry.concept.replace(/\s+/g, ' ').trim().toLowerCase())
        ? { sessionId: sessionByConcept.get(entry.concept.replace(/\s+/g, ' ').trim().toLowerCase()) }
        : undefined,
  }));

  const seen = new Set<string>();
  const recentLessons: LearnerContext['recentLessons'] = [];
  for (const activity of [...(input.activities ?? [])].reverse()) {
    if (activity.kind !== 'lesson') continue;
    const title = activity.title.trim();
    if (!title || seen.has(title) || activity.sessionId === input.sessionId) continue;
    seen.add(title);
    recentLessons.push({ title, at: activity.occurredAt, sessionId: activity.sessionId });
    if (recentLessons.length >= limit) break;
  }

  const active = (input.memories ?? []).filter((m) => m.status === 'active' && m.title.trim());
  const pick = (kind: LearningMemoryEntry['kind']) => active.filter((m) => m.kind === kind).slice(0, limit);
  const challenges = pick('challenge').map((m) => ({ title: m.title.trim(), detail: m.detail?.trim() || undefined, evidenceIds: [m.id] }));
  const topics = pick('topic').map((m) => m.title.trim());
  const preferences = pick('preference').map((m) => m.title.trim());
  // 长期理解里没有独立的 goal 类型；"progress"（正在靠近的进度）最接近目标，作为 goals 供给
  const goals = pick('progress').map((m) => m.title.trim());

  return {
    v: LEARNER_CONTEXT_VERSION,
    generatedAt: new Date().toISOString(),
    source: 'local',
    learnerId: input.learnerId,
    mastery,
    recentLessons,
    challenges,
    topics,
    preferences,
    goals,
    evidenceIds: [...challenges.flatMap((c) => c.evidenceIds ?? []), ...active.filter((m) => m.kind !== 'challenge').map((m) => m.id)],
  };
}
