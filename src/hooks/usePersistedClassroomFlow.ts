'use client';

import { useEffect, useRef, useState } from 'react';
import { getClassroomFlow, saveClassroomFlow } from '@/lib/db/classroom-flows';
import type { ClassroomFlowState } from '@/types/classroom-flow';

export function usePersistedClassroomFlow(sessionId: string): ClassroomFlowState | null {
  const [flow, setFlow] = useState<ClassroomFlowState | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFlow(null);
    if (!sessionId) return () => { cancelled = true; };

    void getClassroomFlow(sessionId).then((savedFlow) => {
      if (!cancelled) setFlow(savedFlow);
    }).catch(() => {
      if (!cancelled) setFlow(null);
    });

    return () => { cancelled = true; };
  }, [sessionId]);

  return flow;
}

export function usePersistClassroomFlow(
  sessionId: string,
  flow: ClassroomFlowState,
  enabled: boolean,
): void {
  const lastSavedRef = useRef({ sessionId: '', updatedAtMs: 0 });

  useEffect(() => {
    const lastSaved = lastSavedRef.current;
    if (
      !enabled
      || !sessionId
      || (lastSaved.sessionId === sessionId && flow.updatedAtMs <= lastSaved.updatedAtMs)
    ) return;
    lastSavedRef.current = { sessionId, updatedAtMs: flow.updatedAtMs };
    void saveClassroomFlow(sessionId, flow).catch(() => undefined);
  }, [enabled, flow, sessionId]);
}
