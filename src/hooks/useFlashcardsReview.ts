'use client';

/**
 * useFlashcardsReview — 一叠闪卡的跨会话复习计划（到期模型 spaced-review-model 的读侧编排）。
 *
 * 历史来源与掌握轨迹同一份事实：
 *   - 本机：review-session-outcomes（按课存的会话层结果，device-outcomes 读全部）——访客只有这一半，登录用户也先用它（同步快）；
 *     它一变（recordSessionAssessment 广播 OUTCOMES_UPDATED_EVENT）就重读，刚打完分的一轮立刻进计划；
 *   - 服务端（登录用户）：POST /api/context/v1/learner-context 点名这叠卡的正面（concepts），拿回每张卡跨设备的 steps；
 *     同一张卡以服务端为准，本机只补服务端还没收到的那几步（刚打完分还在飞）。
 * 服务端失败静默：本机计划已经在用，不等网络。顺序只在用户还没开始翻牌时应用（FlashcardsWindow 负责冻结）。
 */

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { collectDeviceOutcomes, OUTCOMES_UPDATED_EVENT } from '@/lib/learning/device-outcomes';
import { isPositiveOutcome } from '@/lib/learning/mastery-trail-model';
import {
  describeReviewEntry,
  normalizeReviewConcept,
  planReview,
  type ReviewCardRef,
  type ReviewEntryNotice,
  type ReviewPlan,
  type ReviewStep,
} from '@/lib/learning/spaced-review-model';
import { LEARNER_CONTEXT_VERSION, type LearnerContext } from '@/types/learner-context';

const CACHE_TTL_MS = 30_000;
/** 本机一步与服务端最后一步相差在这之内算同一次（本机 Date.now() 与服务端 occurredAt 差几百毫秒） */
const SAME_EVENT_WINDOW_MS = 60_000;
/** 请求契约里 concepts 最多 40 条 */
const MAX_CONCEPTS = 40;

type History = Map<string, ReviewStep[]>;
const EMPTY_HISTORY: History = new Map();

let serverCache: { key: string; at: number; history: History } | null = null;

/** 本机会话层结果 → 按正面归一的历史表 */
export function localReviewHistory(): History {
  const history: History = new Map();
  for (const record of collectDeviceOutcomes()) {
    for (const item of record.items) {
      if (item.outcome === 'uncovered') continue;
      const key = normalizeReviewConcept(item.concept);
      if (!key) continue;
      const steps = history.get(key) ?? [];
      steps.push({ positive: isPositiveOutcome(item.outcome), at: record.at });
      history.set(key, steps);
    }
  }
  return history;
}

function historyFromLearnerContext(context: LearnerContext): History {
  const history: History = new Map();
  for (const state of Array.isArray(context.mastery) ? context.mastery : []) {
    const key = normalizeReviewConcept(state.concept ?? '');
    if (!key) continue;
    const steps = (state.steps ?? [])
      .map((step) => ({ positive: step.positive, at: Date.parse(step.at) }))
      .filter((step) => Number.isFinite(step.at));
    if (steps.length > 0) history.set(key, steps);
  }
  return history;
}

/** 服务端为准；本机只补服务端最后一步之后（超出同一次窗口）的那几步 */
export function mergeReviewHistory(local: History, server: History): History {
  const merged: History = new Map(local);
  server.forEach((serverSteps, key) => {
    const latest = serverSteps.reduce((max, step) => Math.max(max, step.at), 0);
    const localExtra = (local.get(key) ?? []).filter((step) => step.at > latest + SAME_EVENT_WINDOW_MS);
    merged.set(key, [...serverSteps, ...localExtra]);
  });
  return merged;
}

async function fetchServerHistory(accessToken: string, concepts: string[], sessionId?: string): Promise<History> {
  const response = await fetch('/api/context/v1/learner-context', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ v: LEARNER_CONTEXT_VERSION, appId: 'flashcards', sessionId, concepts, need: ['mastery'], limit: 1 }),
  });
  if (!response.ok) return new Map();
  return historyFromLearnerContext((await response.json()) as LearnerContext);
}

export interface FlashcardsReviewState {
  plan: ReviewPlan;
  notice: ReviewEntryNotice;
  /** 已并入服务端历史（登录用户）；访客一直是 false */
  fromAccount: boolean;
  /** 该用的历史都到了（访客：立刻；登录：服务端答复或失败后） */
  settled: boolean;
}

export function useFlashcardsReview(cards: readonly ReviewCardRef[], sessionId?: string): FlashcardsReviewState {
  const { accessToken } = useAuth();
  const [localHistory, setLocalHistory] = useState<History>(EMPTY_HISTORY);
  const [serverHistory, setServerHistory] = useState<History | null>(null);
  const [settledToken, setSettledToken] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  // 正面文本的签名：卡不变就不重新请求
  const frontsKey = useMemo(() => cards.map((card) => card.front).join('\u0000'), [cards]);

  // 本机历史：挂载时读一次；会话层结果一写入就重读（同页里刚打完分的一轮立刻进计划）
  useEffect(() => {
    const bump = () => setRevision((value) => value + 1);
    window.addEventListener(OUTCOMES_UPDATED_EVENT, bump);
    return () => window.removeEventListener(OUTCOMES_UPDATED_EVENT, bump);
  }, []);
  useEffect(() => {
    setLocalHistory(cards.length > 0 ? localReviewHistory() : EMPTY_HISTORY);
  }, [cards.length, frontsKey, revision]);

  useEffect(() => {
    if (!accessToken || cards.length === 0) {
      setServerHistory(null);
      return;
    }
    const concepts = Array.from(new Set(cards.map((card) => card.front.trim()).filter(Boolean))).slice(0, MAX_CONCEPTS);
    const key = `${accessToken}|${concepts.join('\u0000')}`;
    if (serverCache && serverCache.key === key && Date.now() - serverCache.at < CACHE_TTL_MS) {
      setServerHistory(serverCache.history);
      setSettledToken(accessToken);
      return;
    }
    let cancelled = false;
    fetchServerHistory(accessToken, concepts, sessionId)
      .then((history) => {
        if (cancelled) return;
        serverCache = { key, at: Date.now(), history };
        setServerHistory(history);
      })
      .catch(() => { /* 服务端不可达：本机计划已经在用 */ })
      .finally(() => { if (!cancelled) setSettledToken(accessToken); });
    return () => { cancelled = true; };
  }, [accessToken, cards, frontsKey, sessionId]);

  return useMemo(() => {
    const history = serverHistory ? mergeReviewHistory(localHistory, serverHistory) : localHistory;
    const plan = planReview(cards, history, Date.now());
    return {
      plan,
      notice: describeReviewEntry(plan),
      fromAccount: Boolean(serverHistory),
      settled: !accessToken || settledToken === accessToken,
    };
  }, [accessToken, cards, localHistory, serverHistory, settledToken]);
}

/** 检验结果刚写入时让下一次读绕过服务端缓存 */
export function invalidateFlashcardsReviewCache(): void {
  serverCache = null;
}
