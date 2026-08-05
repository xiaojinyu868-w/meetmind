'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { LearningThreadEntry } from '@/types/user';

interface UseGlobalAskThreadBindingOptions {
  activeThread?: LearningThreadEntry;
  setActiveThread: (thread?: LearningThreadEntry) => Promise<void>;
}

export function linkLearningThreadToConversation(
  thread: LearningThreadEntry | undefined,
  conversationId: string,
  updatedAt = new Date().toISOString(),
): LearningThreadEntry | undefined {
  if (!thread || thread.status !== 'active' || thread.conversationId) return undefined;
  return { ...thread, conversationId, updatedAt };
}

export function useGlobalAskThreadBinding({
  activeThread,
  setActiveThread,
}: UseGlobalAskThreadBindingOptions) {
  const activeThreadRef = useRef(activeThread);

  useEffect(() => {
    activeThreadRef.current = activeThread;
  }, [activeThread]);

  const activateThread = useCallback(async (thread: LearningThreadEntry) => {
    activeThreadRef.current = thread;
    await setActiveThread(thread);
  }, [setActiveThread]);

  const bindConversation = useCallback((conversationId: string) => {
    const linkedThread = linkLearningThreadToConversation(activeThreadRef.current, conversationId);
    if (!linkedThread) return;
    activeThreadRef.current = linkedThread;
    void setActiveThread(linkedThread);
  }, [setActiveThread]);

  return { activeThreadRef, activateThread, bindConversation };
}
