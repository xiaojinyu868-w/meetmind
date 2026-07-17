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
    patch: Partial<Pick<CourseContextPreference, 'displayName' | 'status' | 'confirmedByUser' | 'excludedSessionIds' | 'assessments'>>,
  ) => Promise<void>;
  setActiveThread: (thread?: LearningThreadEntry) => Promise<void>;
}

export function useLearningContext(): UseLearningContextReturn {
  const { user, isAuthenticated, saveLearnerProfile } = useAuth();
  const [state, setState] = useState<LearningContextState>(() => (
    learningContextFromProfile(user?.learnerProfile)
  ));
  const [hydrated, setHydrated] = useState(Boolean(isAuthenticated));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stateRef = useRef(state);
  const profileRef = useRef<LearnerProfile | null>(user?.learnerProfile ?? null);
  const ownerKey = user?.id || 'guest';

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { profileRef.current = user?.learnerProfile ?? null; }, [user?.learnerProfile]);

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
    window.addEventListener(CONTEXT_EVENT, onContextChange);
    return () => window.removeEventListener(CONTEXT_EVENT, onContextChange);
  }, [ownerKey]);

  const persist = useCallback(async (next: LearningContextState) => {
    stateRef.current = next;
    setState(next);
    window.dispatchEvent(new CustomEvent(CONTEXT_EVENT, { detail: { ownerKey, state: next } }));
    setSaving(true);
    setError(null);
    try {
      if (isAuthenticated) {
        const base = profileRef.current ?? ({ stage: 'unknown' } as LearnerProfile);
        const profile = {
          ...base,
          memories: next.memories,
          recentLearningActivities: next.recentActivities,
          courseContextPreferences: next.coursePreferences || [],
          activeLearningThread: next.activeThread,
        } as LearnerProfile;
        const ok = await saveLearnerProfile(profile);
        if (!ok) throw new Error('学习上下文暂时没有同步成功');
        profileRef.current = profile;
      } else {
        await setPreference(GUEST_CONTEXT_KEY, next);
      }
    } catch (persistError) {
      setError(persistError instanceof Error ? persistError.message : '学习上下文暂时没有同步成功');
    } finally {
      setSaving(false);
    }
  }, [isAuthenticated, ownerKey, saveLearnerProfile]);

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
    patch: Partial<Pick<CourseContextPreference, 'displayName' | 'status' | 'confirmedByUser' | 'excludedSessionIds' | 'assessments'>>,
  ) => {
    const existing = stateRef.current.coursePreferences || [];
    const current = existing.find((item) => item.courseKey === courseKey);
    const nextPreference: CourseContextPreference = {
      courseKey,
      displayName: current?.displayName,
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
