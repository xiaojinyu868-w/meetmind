'use client';

import { useEffect, useRef, useState } from 'react';
import type { TranscriptSegment } from '@/types';
import type { ClassroomFlowState } from '@/types/classroom-flow';
import { saveClassroomFlow } from '@/lib/db/classroom-flows';

const MIN_ELAPSED_MS = 20_000;
const MIN_TRANSCRIPT_CHARS = 60;
const MIN_REQUEST_INTERVAL_MS = 30_000;
const MAX_DELTA_CHARS = 6_500;

const EMPTY_FLOW: ClassroomFlowState = {
  title: '',
  now: null,
  recent: [],
  keep: [],
  updatedAtMs: 0,
};

export interface UseClassroomFlowInput {
  enabled: boolean;
  sessionId?: string;
  segments: TranscriptSegment[];
  recordingStartAt: number | null;
  lessonTitle?: string;
  importedHints?: string[];
}

export interface UseClassroomFlowReturn {
  flow: ClassroomFlowState;
  newItemIds: Set<string>;
  isUnderstanding: boolean;
}

export function useClassroomFlow({
  enabled,
  sessionId,
  segments,
  recordingStartAt,
  lessonTitle,
  importedHints,
}: UseClassroomFlowInput): UseClassroomFlowReturn {
  const [flow, setFlow] = useState<ClassroomFlowState>(EMPTY_FLOW);
  const [newItemIds, setNewItemIds] = useState<Set<string>>(new Set());
  const [isUnderstanding, setIsUnderstanding] = useState(false);
  const priorFlowRef = useRef<ClassroomFlowState>(EMPTY_FLOW);
  const processedSegmentIdsRef = useRef<Set<string>>(new Set());
  const lastRequestAtRef = useRef(0);
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (enabled) return;
    requestRef.current?.abort();
    requestRef.current = null;
    priorFlowRef.current = EMPTY_FLOW;
    processedSegmentIdsRef.current = new Set();
    lastRequestAtRef.current = 0;
    setFlow(EMPTY_FLOW);
    setNewItemIds(new Set());
    setIsUnderstanding(false);
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !recordingStartAt) return;
    requestRef.current?.abort();
    requestRef.current = null;
    priorFlowRef.current = EMPTY_FLOW;
    processedSegmentIdsRef.current = new Set();
    lastRequestAtRef.current = 0;
    setFlow(EMPTY_FLOW);
    setNewItemIds(new Set());
    setIsUnderstanding(false);
  }, [enabled, recordingStartAt, sessionId]);

  useEffect(() => {
    if (!enabled || !recordingStartAt || segments.length === 0) return;
    const pendingSegments = segments.filter((segment) => !processedSegmentIdsRef.current.has(segment.id));
    const newSegments: TranscriptSegment[] = [];
    let deltaChars = 0;
    for (const segment of pendingSegments) {
      const segmentChars = segment.text.trim().length;
      if (newSegments.length > 0 && deltaChars + segmentChars > MAX_DELTA_CHARS) break;
      newSegments.push(segment);
      deltaChars += segmentChars;
    }
    const transcriptLength = newSegments.reduce((total, segment) => total + segment.text.trim().length, 0);
    if (transcriptLength < MIN_TRANSCRIPT_CHARS) return;

    const elapsedMs = Date.now() - recordingStartAt;
    if (elapsedMs < MIN_ELAPSED_MS) return;
    const now = Date.now();
    if (now - lastRequestAtRef.current < MIN_REQUEST_INTERVAL_MS || requestRef.current) return;

    const controller = new AbortController();
    requestRef.current = controller;
    lastRequestAtRef.current = now;
    setIsUnderstanding(true);

    void (async () => {
      try {
        const response = await fetch('/api/classroom/flow', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            newSegments,
            elapsedMs,
            lessonTitle,
            priorFlow: priorFlowRef.current,
            importedHints,
          }),
          signal: controller.signal,
        });
        if (!response.ok) return;
        const data = (await response.json()) as { flow?: ClassroomFlowState };
        if (!data.flow) return;

        const previousIds = collectIds(priorFlowRef.current);
        const nextIds = collectIds(data.flow);
        const addedIds = new Set([...nextIds].filter((id) => !previousIds.has(id)));
        for (const segment of newSegments) {
          processedSegmentIdsRef.current.add(segment.id);
        }
        priorFlowRef.current = data.flow;
        setFlow(data.flow);
        if (sessionId) {
          void saveClassroomFlow(sessionId, data.flow).catch(() => undefined);
        }
        setNewItemIds(addedIds);
        window.setTimeout(() => setNewItemIds(new Set()), 1_600);
      } catch (error) {
        if ((error as Error)?.name !== 'AbortError') {
          // 课堂主流程不能被理解层失败打断；保留上一轮有用状态。
        }
      } finally {
        if (requestRef.current === controller) requestRef.current = null;
        setIsUnderstanding(false);
      }
    })();
  }, [enabled, importedHints, lessonTitle, recordingStartAt, segments, sessionId]);

  return { flow, newItemIds, isUnderstanding };
}

function collectIds(flow: ClassroomFlowState): Set<string> {
  return new Set([
    ...(flow.now ? [flow.now.id] : []),
    ...flow.recent.map((item) => item.id),
    ...flow.keep.map((item) => item.id),
  ]);
}
