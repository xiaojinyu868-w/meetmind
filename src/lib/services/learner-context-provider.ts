/**
 * learner-context-provider — 服务端供给方：从本仓库自己的存储聚出 LearnerContext（source: 'server'）。
 *
 * 外部 context 系统合并前的参考实现，也是合并后的对照物：同一契约（types/learner-context.ts），
 * 数据来自
 *   - LearningEvent 表的 assessment 事件（闪卡 / 测验 / 讲给同桌听的结构化检验结果，P0-1 写侧）
 *     → 与客户端同一份 mastery-trail-model 规则聚成掌握状态（还没稳 / 刚记住 / 已经稳了）；
 *   - User.learnerProfileJson 里的长期理解（memories：困惑 / 主题 / 偏好 / 进度）与最近学习现场（lesson 类）。
 *
 * 只做读时聚合，不写回画像（P0-1 刻意不物化，避免两套画像）。登录用户换设备也能拿到同一个自己——
 * 这是本机切片（localStorage）做不到的那一半。
 *
 * 对外同样的契约暴露在 POST /api/context/v1/learner-context（Bearer = MeetMind JWT），
 * 外部系统若要对拍或先做代理，直接打这个口。
 */

import prisma from '@/lib/prisma';
import { buildMasteryTrail, type AssessmentRecord, type MasteryTrailEntry } from '@/lib/learning/mastery-trail-model';
import type { LearnerProfile, LearningActivityEntry, LearningMemoryEntry } from '@/types/user';
import {
  LEARNER_CONTEXT_VERSION,
  type LearnerConceptState,
  type LearnerContext,
  type LearnerContextRequest,
} from '@/types/learner-context';

const MAX_EVENTS = 400;

interface AssessmentPayload {
  v: 1;
  appKey: string;
  sessionId?: string;
  lessonTitle?: string;
  items: AssessmentRecord['items'];
}

function parseAssessment(payloadJson: string, at: number, eventId: string): (AssessmentRecord & { eventId: string; sessionId?: string }) | null {
  try {
    const payload = JSON.parse(payloadJson) as Partial<AssessmentPayload>;
    if (payload.v !== 1 || typeof payload.appKey !== 'string' || !Array.isArray(payload.items)) return null;
    return { appKey: payload.appKey, items: payload.items, at, eventId, sessionId: payload.sessionId };
  } catch {
    return null;
  }
}

function normalizeConcept(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

const STATUS_RANK: Record<MasteryTrailEntry['status'], number> = { unstable: 0, improving: 1, stable: 2 };

/**
 * 从完整轨迹里挑出这次请求要的那几条：
 * - request.concepts 点名的概念（闪卡到期模型按卡面问"这几张卡的历史"）全部保留，不占 limit；
 * - 其余按 状态（还没稳在前）→ 本课优先（证据落在 request.sessionId 的课）→ 最近 排序取 limit 条。
 * 为什么本课优先：给测验 / 闪卡出题时，"这节课上检验过还没稳"比"别的课没稳"更该被看见；跨课的靠状态与时间自然浮上来。
 */
export function selectMasteryEntries(
  trail: readonly MasteryTrailEntry[],
  request: Pick<LearnerContextRequest, 'concepts' | 'sessionId'>,
  evidenceByConcept: ReadonlyMap<string, { sessionId?: string }>,
  limit: number,
): MasteryTrailEntry[] {
  const wanted = new Set((request.concepts ?? []).map(normalizeConcept).filter(Boolean));
  const named = trail.filter((entry) => wanted.has(normalizeConcept(entry.concept)));
  const namedKeys = new Set(named.map((entry) => normalizeConcept(entry.concept)));
  const rest = trail
    .filter((entry) => !namedKeys.has(normalizeConcept(entry.concept)))
    .sort((a, b) => {
      const byStatus = STATUS_RANK[a.status] - STATUS_RANK[b.status];
      if (byStatus !== 0) return byStatus;
      if (request.sessionId) {
        const aHere = evidenceByConcept.get(normalizeConcept(a.concept))?.sessionId === request.sessionId ? 0 : 1;
        const bHere = evidenceByConcept.get(normalizeConcept(b.concept))?.sessionId === request.sessionId ? 0 : 1;
        if (aHere !== bHere) return aHere - bHere;
      }
      return b.lastAt - a.lastAt;
    })
    .slice(0, limit);
  return [...named, ...rest];
}

function readProfile(json: string | null): LearnerProfile | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as LearnerProfile;
  } catch {
    return null;
  }
}

export async function buildLearnerContextFromStore(request: LearnerContextRequest): Promise<LearnerContext> {
  const learnerId = request.learnerId;
  const limit = request.limit ?? 8;
  const need = new Set(request.need);
  const generatedAt = new Date().toISOString();
  const empty: LearnerContext = {
    v: LEARNER_CONTEXT_VERSION, generatedAt, source: 'server', learnerId,
    mastery: [], recentLessons: [], challenges: [], topics: [], preferences: [], goals: [], evidenceIds: [],
  };
  if (!learnerId) return empty;

  const [events, user] = await Promise.all([
    need.has('mastery')
      ? prisma.learningEvent.findMany({
        where: { userId: learnerId, type: 'assessment' },
        orderBy: { occurredAt: 'desc' },
        take: MAX_EVENTS,
        select: { id: true, payloadJson: true, occurredAt: true },
      })
      : Promise.resolve([]),
    prisma.user.findUnique({ where: { id: learnerId }, select: { learnerProfileJson: true } }),
  ]);

  // 掌握状态：与客户端同一份规则；证据 id = 最近一次触及该概念的事件 id
  const records = events
    .map((event) => parseAssessment(event.payloadJson, event.occurredAt.getTime(), event.id))
    .filter((record): record is NonNullable<typeof record> => record !== null);
  const evidenceByConcept = new Map<string, { eventId: string; sessionId?: string }>();
  for (const record of [...records].sort((a, b) => a.at - b.at)) {
    for (const item of record.items) {
      evidenceByConcept.set(normalizeConcept(item.concept), { eventId: record.eventId, sessionId: record.sessionId });
    }
  }
  const mastery: LearnerConceptState[] = selectMasteryEntries(buildMasteryTrail(records, Number.POSITIVE_INFINITY), request, evidenceByConcept, limit).map((entry) => {
    const ref = evidenceByConcept.get(normalizeConcept(entry.concept));
    return {
      concept: entry.concept,
      status: entry.status,
      lastAt: new Date(entry.lastAt).toISOString(),
      // 最近 8 步够算出到期（连续记住的次数）与轨迹；更早的历史留在事件表里
      steps: entry.steps.slice(-8).map((step) => ({ appId: step.appKey, positive: step.positive, at: new Date(step.at).toISOString() })),
      // 没有课堂时间点也带上 sessionId：prompt 要靠它标「本课」
      evidence: entry.evidence
        ? { sessionId: ref?.sessionId, startMs: entry.evidence.startMs, endMs: entry.evidence.endMs }
        : ref?.sessionId ? { sessionId: ref.sessionId } : undefined,
      evidenceIds: ref ? [ref.eventId] : undefined,
    };
  });

  const profile = readProfile(user?.learnerProfileJson ?? null);
  const active = (profile?.memories ?? []).filter((m): m is LearningMemoryEntry => Boolean(m) && m.status === 'active' && Boolean(m.title?.trim()));
  const pick = (kind: LearningMemoryEntry['kind']) => active.filter((m) => m.kind === kind).slice(0, limit);

  const recentLessons: LearnerContext['recentLessons'] = [];
  if (need.has('recent')) {
    const seen = new Set<string>();
    for (const activity of [...(profile?.recentLearningActivities ?? [])].reverse() as LearningActivityEntry[]) {
      if (activity.kind !== 'lesson') continue;
      const title = activity.title?.trim();
      if (!title || seen.has(title) || (request.sessionId && activity.sessionId === request.sessionId)) continue;
      seen.add(title);
      recentLessons.push({ title, at: activity.occurredAt, sessionId: activity.sessionId });
      if (recentLessons.length >= limit) break;
    }
  }

  const challenges = need.has('challenges') ? pick('challenge').map((m) => ({ title: m.title.trim(), detail: m.detail?.trim() || undefined, evidenceIds: [m.id] })) : [];
  const topics = need.has('topics') ? pick('topic').map((m) => m.title.trim()) : [];
  const preferences = need.has('preferences') ? pick('preference').map((m) => m.title.trim()) : [];
  const goals = need.has('goals') ? pick('progress').map((m) => m.title.trim()) : [];

  return {
    ...empty,
    mastery,
    recentLessons,
    challenges,
    topics,
    preferences,
    goals,
    evidenceIds: [
      ...mastery.flatMap((m) => m.evidenceIds ?? []),
      ...challenges.flatMap((c) => c.evidenceIds ?? []),
      ...active.filter((m) => m.kind !== 'challenge').map((m) => m.id),
    ],
  };
}
