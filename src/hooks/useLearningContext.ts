'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getPreference, setPreference } from '@/lib/db';
import { useAuth } from '@/lib/hooks/useAuth';
import type {
  LearnerProfile,
  CourseContextPreference,
  LearningActivityEntry,
  LearningContextState,
  LearningMemoryEntry,
  LearningThreadEntry,
} from '@/types/user';
import {
  createEmptyLearningContext,
  learningContextFromProfile,
  mergeLearningActivity,
  mergeLearningMemory,
  updateLearningThread,
} from '@/lib/utils/learning-context';

const GUEST_CONTEXT_KEY = 'learning_context_guest_v1';
const CONTEXT_EVENT = 'meetmind:learning-context-change';
// 服务端事件管道（P0）只写画像的 memories / recentLearningActivities 两个字段，
// 服务端→客户端的读刷新也只采纳这两个字段，其余（activeThread/coursePreferences 等）
// 保持本地 state，不被刷新覆盖。
const CONTEXT_SERVER_EVENT = 'meetmind:learning-context-server-sync';

type MemoryDraft = Pick<LearningMemoryEntry, 'kind' | 'title'> &
  Partial<Pick<LearningMemoryEntry, 'detail' | 'source' | 'sourceId'>>;
type ActivityDraft = Pick<LearningActivityEntry, 'kind' | 'title'> &
  Partial<Pick<LearningActivityEntry, 'detail' | 'sessionId' | 'appKey' | 'sourceId'>>;

function createId(prefix: string): string {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

/**
 * 登录用户的学习记忆读刷新：重拉服务端画像（事件管道合并后的物化视图），
 * 只把 memories / recentLearningActivities 广播给同 owner 的 useLearningContext 实例。
 * 静默理解链路专用：失败静默，绝不影响主流程。
 */
export async function refreshLearningContextFromServer(
  ownerKey: string,
  accessToken: string,
): Promise<void> {
  try {
    const response = await fetch('/api/auth/learner-profile', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return;
    const payload = await response.json() as { success?: boolean; learnerProfile?: LearnerProfile | null };
    if (!payload.success) return;
    const next = learningContextFromProfile(payload.learnerProfile);
    window.dispatchEvent(new CustomEvent(CONTEXT_SERVER_EVENT, {
      detail: { ownerKey, memories: next.memories, recentActivities: next.recentActivities },
    }));
  } catch {
    // 记忆刷新是后台动作，失败不打断用户
  }
}

export interface UseLearningContextReturn extends LearningContextState {
  hydrated: boolean;
  saving: boolean;
  error: string | null;
  addMemory: (draft: MemoryDraft) => Promise<void>;
  updateMemory: (id: string, patch: Partial<Pick<LearningMemoryEntry, 'kind' | 'title' | 'detail' | 'status'>>) => Promise<void>;
  removeMemory: (id: string) => Promise<void>;
  recordActivity: (draft: ActivityDraft) => Promise<void>;
  updateCoursePreference: (
    courseKey: string,
    patch: Partial<Pick<CourseContextPreference, 'displayName' | 'tags' | 'status' | 'confirmedByUser' | 'excludedSessionIds' | 'assessments'>>,
  ) => Promise<void>;
  setActiveThread: (thread?: LearningThreadEntry) => Promise<void>;
}

export function useLearningContext(): UseLearningContextReturn {
  const { user, isAuthenticated } = useAuth();
  const [state, setState] = useState<LearningContextState>(() => (
    learningContextFromProfile(user?.learnerProfile)
  ));
  const [hydrated, setHydrated] = useState(Boolean(isAuthenticated));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stateRef = useRef(state);
  const ownerKey = user?.id || 'guest';

  useEffect(() => { stateRef.current = state; }, [state]);

  useEffect(() => {
    let alive = true;
    if (isAuthenticated) {
      const next = learningContextFromProfile(user?.learnerProfile);
      stateRef.current = next;
      setState(next);
      setHydrated(true);
      return () => { alive = false; };
    }
    setHydrated(false);
    getPreference<LearningContextState>(GUEST_CONTEXT_KEY, createEmptyLearningContext())
      .then((next) => {
        if (!alive) return;
        stateRef.current = next;
        setState(next);
        setHydrated(true);
      })
      .catch(() => {
        if (alive) setHydrated(true);
      });
    return () => { alive = false; };
  }, [isAuthenticated, ownerKey, user?.learnerProfile]);

  useEffect(() => {
    const onContextChange = (event: Event) => {
      const detail = (event as CustomEvent<{ ownerKey: string; state: LearningContextState }>).detail;
      if (!detail || detail.ownerKey !== ownerKey) return;
      stateRef.current = detail.state;
      setState(detail.state);
    };
    const onServerSync = (event: Event) => {
      const detail = (event as CustomEvent<{
        ownerKey: string;
        memories: LearningContextState['memories'];
        recentActivities: LearningContextState['recentActivities'];
      }>).detail;
      if (!detail || detail.ownerKey !== ownerKey) return;
      // 只采纳服务端事件管道负责的两个字段，本地维护的其余 state 不动
      const next: LearningContextState = {
        ...stateRef.current,
        memories: detail.memories,
        recentActivities: detail.recentActivities,
      };
      stateRef.current = next;
      setState(next);
    };
    window.addEventListener(CONTEXT_EVENT, onContextChange);
    window.addEventListener(CONTEXT_SERVER_EVENT, onServerSync);
    return () => {
      window.removeEventListener(CONTEXT_EVENT, onContextChange);
      window.removeEventListener(CONTEXT_SERVER_EVENT, onServerSync);
    };
  }, [ownerKey]);

  const persist = useCallback(async (next: LearningContextState) => {
    stateRef.current = next;
    setState(next);
    window.dispatchEvent(new CustomEvent(CONTEXT_EVENT, { detail: { ownerKey, state: next } }));
    if (isAuthenticated) {
      // P0 事件化：登录用户的画像四字段（memories/recentActivities/coursePreferences/
      // activeThread）改由服务端事件管道合并，客户端不再整体 PATCH 回写；
      // 本地 state 照旧维护（prompt 拼接要用），服务端→客户端走 refreshLearningContextFromServer。
      // 用户本人操作（IntentDialog bio/目标卡、设置页学习档案）仍走 useAuth.saveLearnerProfile 特权通道。
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await setPreference(GUEST_CONTEXT_KEY, next);
    } catch (persistError) {
      setError(persistError instanceof Error ? persistError.message : '学习上下文暂时没有同步成功');
    } finally {
      setSaving(false);
    }
  }, [isAuthenticated, ownerKey]);

  const addMemory = useCallback(async (draft: MemoryDraft) => {
    const now = new Date().toISOString();
    await persist(mergeLearningMemory(stateRef.current, {
      id: createId('memory'),
      kind: draft.kind,
      title: draft.title,
      detail: draft.detail,
      status: 'active',
      source: draft.source ?? 'user',
      sourceId: draft.sourceId,
      createdAt: now,
      updatedAt: now,
    }));
  }, [persist]);

  const updateMemory = useCallback(async (
    id: string,
    patch: Partial<Pick<LearningMemoryEntry, 'kind' | 'title' | 'detail' | 'status'>>,
  ) => {
    const next: LearningContextState = {
      ...stateRef.current,
      memories: stateRef.current.memories.map((memory) => (
        memory.id === id
          ? { ...memory, ...patch, updatedAt: new Date().toISOString() }
          : memory
      )),
    };
    await persist(next);
  }, [persist]);

  const removeMemory = useCallback(async (id: string) => {
    await persist({
      ...stateRef.current,
      memories: stateRef.current.memories.filter((memory) => memory.id !== id),
    });
  }, [persist]);

  const recordActivity = useCallback(async (draft: ActivityDraft) => {
    await persist(mergeLearningActivity(stateRef.current, {
      id: createId('activity'),
      kind: draft.kind,
      title: draft.title,
      detail: draft.detail,
      sessionId: draft.sessionId,
      appKey: draft.appKey,
      sourceId: draft.sourceId,
      occurredAt: new Date().toISOString(),
    }));
  }, [persist]);

  const updateCoursePreference = useCallback(async (
    courseKey: string,
    patch: Partial<Pick<CourseContextPreference, 'displayName' | 'tags' | 'status' | 'confirmedByUser' | 'excludedSessionIds' | 'assessments'>>,
  ) => {
    const existing = stateRef.current.coursePreferences || [];
    const current = existing.find((item) => item.courseKey === courseKey);
    const nextPreference: CourseContextPreference = {
      courseKey,
      displayName: current?.displayName,
      tags: current?.tags,
      status: current?.status ?? 'active',
      confirmedByUser: current?.confirmedByUser,
      excludedSessionIds: current?.excludedSessionIds,
      assessments: current?.assessments,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    nextPreference.excludedSessionIds = Array.isArray(nextPreference.excludedSessionIds)
      ? Array.from(new Set(nextPreference.excludedSessionIds.filter(Boolean))).slice(-64)
      : undefined;
    nextPreference.tags = Array.isArray(nextPreference.tags)
      ? Array.from(new Set(nextPreference.tags
        .map((tag) => tag.replace(/\s+/g, ' ').trim().slice(0, 16))
        .filter(Boolean)))
        .slice(0, 6)
      : undefined;
    nextPreference.assessments = Array.isArray(nextPreference.assessments)
      ? nextPreference.assessments
        .filter((assessment) => assessment?.id && assessment?.name)
        .map((assessment) => ({
          ...assessment,
          name: assessment.name.replace(/\s+/g, ' ').trim().slice(0, 60),
          syllabus: assessment.syllabus?.trim().slice(0, 4_000) || undefined,
        }))
        .slice(-8)
      : undefined;
    await persist({
      ...stateRef.current,
      coursePreferences: [
        ...existing.filter((item) => item.courseKey !== courseKey),
        nextPreference,
      ].slice(-32),
    });
  }, [persist]);

  const setActiveThread = useCallback(async (thread?: LearningThreadEntry) => {
    await persist(updateLearningThread(stateRef.current, thread));
  }, [persist]);

  return {
    ...state,
    hydrated,
    saving,
    error,
    addMemory,
    updateMemory,
    removeMemory,
    recordActivity,
    updateCoursePreference,
    setActiveThread,
  };
}

export default useLearningContext;
