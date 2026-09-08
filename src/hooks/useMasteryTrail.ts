'use client';

/**
 * useMasteryTrail — 「我的上下文」/ 问同学书桌用的掌握轨迹：本机会话层结果 + 服务端事件表切片合并。
 *
 * 访客只有本机；登录用户再问一次 POST /api/context/v1/learner-context（服务端从 LearningEvent 表聚成同一形状），
 * 同一概念以服务端为准（跨设备完整历史），只在本机有的保留——学生换设备也看到同一个自己。
 * 服务端失败静默：本机轨迹先显示，不等网络。
 */

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { collectDeviceOutcomes } from '@/lib/learning/device-outcomes';
import { buildMasteryTrail, mergeMasteryTrails, trailFromLearnerMastery, type MasteryTrailEntry } from '@/lib/learning/mastery-trail-model';
import { LEARNER_CONTEXT_VERSION, type LearnerContext } from '@/types/learner-context';

const SERVER_LIMIT = 12;
const CACHE_TTL_MS = 60_000;
let cache: { token: string; at: number; trail: MasteryTrailEntry[] } | null = null;

async function fetchServerTrail(accessToken: string, appId: string): Promise<MasteryTrailEntry[]> {
  const response = await fetch('/api/context/v1/learner-context', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ v: LEARNER_CONTEXT_VERSION, appId, need: ['mastery'], limit: SERVER_LIMIT }),
  });
  if (!response.ok) return [];
  const context = (await response.json()) as LearnerContext;
  return trailFromLearnerMastery(Array.isArray(context.mastery) ? context.mastery : []);
}

interface UseMasteryTrailOptions {
  /** 只在需要时读（面板打开），避免每次挂载都打一次 */
  enabled?: boolean;
  /** 请求方标识（服务端只记日志） */
  appId?: string;
  limit?: number;
}

export interface MasteryTrailState {
  trail: MasteryTrailEntry[];
  /** 已并入服务端切片（登录用户，换设备也在）——展示层据此换脚注 */
  fromAccount: boolean;
}

export function useMasteryTrail({ enabled = true, appId = 'my-context', limit = 8 }: UseMasteryTrailOptions = {}): MasteryTrailState {
  const { accessToken } = useAuth();
  const [trail, setTrail] = useState<MasteryTrailEntry[]>([]);
  const [fromAccount, setFromAccount] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const local = buildMasteryTrail(collectDeviceOutcomes(), limit * 2);
    setTrail(local.slice(0, limit));
    if (!accessToken) {
      setFromAccount(false);
      return;
    }
    let cancelled = false;
    const cached = cache && cache.token === accessToken && Date.now() - cache.at < CACHE_TTL_MS ? cache.trail : null;
    const apply = (server: MasteryTrailEntry[]) => {
      if (cancelled) return;
      setTrail(mergeMasteryTrails(local, server, limit));
      setFromAccount(true);
    };
    if (cached) {
      apply(cached);
      return () => { cancelled = true; };
    }
    fetchServerTrail(accessToken, appId)
      .then((server) => {
        cache = { token: accessToken, at: Date.now(), trail: server };
        apply(server);
      })
      .catch(() => { /* 服务端不可达：本机轨迹已经在显示 */ });
    return () => { cancelled = true; };
  }, [accessToken, appId, enabled, limit]);

  return { trail, fromAccount };
}

/** 检验结果刚写入时让下一次读绕过缓存（useAppLearningActivity.recordAssessment 后调用） */
export function invalidateMasteryTrailCache(): void {
  cache = null;
}
