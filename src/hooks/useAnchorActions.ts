/**
 * useAnchorActions
 *
 * 困惑点/锚点 CRUD — 从 page.tsx 提取（Phase 5）
 *
 * 包含：
 *   handleAnchorMark      — 实时录音中标记困惑点
 *   handlePlaybackAnchorAdd — 回放时新增困惑点
 *   handleAnchorSelect    — 选中困惑点（跳转 + 切详情）
 *   handleResolveAnchor   — 解决困惑点
 *
 * 遵循 (deps, refs) 模式。Store 写入通过 getState().actions。
 */

import { useCallback } from 'react';
import { useUIStore } from '@/stores/ui-store';
import { usePlayerStore } from '@/stores/player-store';
import { useSessionStore } from '@/stores/session-store';
import { useCaptureEditorStore } from '@/stores/capture-editor-store';
import { anchorService, type Anchor } from '@/lib/services/anchor-service';
import { classroomDataService } from '@/lib/services/classroom-data-service';
import type { TranscriptSegment } from '@/types';
import type { ClassTimeline } from '@/lib/services/memory-service';

// ── Deps interface ──

interface UseAnchorActionsDeps {
  sessionId: string;
  studentId: string;
  studentName: string;
  segments: TranscriptSegment[];
  timeline: ClassTimeline | null;
  selectedAnchor: Anchor | null;
}

// ── Hook ──

export function useAnchorActions(deps: UseAnchorActionsDeps) {
  const {
    sessionId,
    studentId,
    studentName,
    segments,
    timeline,
    selectedAnchor,
  } = deps;

  // ── handleAnchorMark ──
  const handleAnchorMark = useCallback((timestamp: number) => {
    // Align anchor timestamp to nearest transcript segment when possible.
    let alignedTimestamp = timestamp;
    if (segments.length > 0) {
      // Prefer containing segment; fallback to nearest segment by distance.
      let nearestSeg = segments[0];
      let minDistance = Math.abs(timestamp - (nearestSeg.startMs + nearestSeg.endMs) / 2);

      for (const seg of segments) {
        if (timestamp >= seg.startMs && timestamp <= seg.endMs) {
          alignedTimestamp = timestamp;
          nearestSeg = seg;
          break;
        }
        const segMid = (seg.startMs + seg.endMs) / 2;
        const distance = Math.abs(timestamp - segMid);
        if (distance < minDistance) {
          minDistance = distance;
          nearestSeg = seg;
        }
      }

      const lastSeg = segments[segments.length - 1];
      if (timestamp > lastSeg.endMs + 5000) {
        alignedTimestamp = lastSeg.endMs;
      } else if (timestamp < segments[0].startMs - 5000) {
        alignedTimestamp = segments[0].startMs;
      }
    }

    const anchor = anchorService.mark(sessionId, studentId, alignedTimestamp, 'confusion');
    useCaptureEditorStore.getState().actions.setAnchors(prev => [...prev, anchor]);

    const contextSegments = segments.filter(
      s => s.startMs <= alignedTimestamp + 5000 && s.endMs >= alignedTimestamp - 5000
    );
    const transcriptContext = contextSegments.map(s => s.text).join(' ').slice(0, 200);

    classroomDataService.saveStudentAnchor(
      sessionId,
      studentId,
      studentName,
      alignedTimestamp,
      'confusion',
      transcriptContext
    );

    if (timeline) {
      useCaptureEditorStore.getState().actions.setTimeline({ ...timeline, anchors: [...timeline.anchors, anchor] });
    }
  }, [sessionId, studentId, studentName, timeline, segments]);

  // ── handlePlaybackAnchorAdd ──
  const handlePlaybackAnchorAdd = useCallback((timestamp: number) => {
    let alignedTimestamp = timestamp;
    if (segments.length > 0) {
      const lastSeg = segments[segments.length - 1];
      if (timestamp > lastSeg.endMs) {
        alignedTimestamp = lastSeg.endMs;
      } else if (timestamp < segments[0].startMs) {
        alignedTimestamp = segments[0].startMs;
      }
    }

    const anchor = anchorService.mark(sessionId, studentId, alignedTimestamp, 'confusion');
    useCaptureEditorStore.getState().actions.setAnchors(prev => [...prev, anchor]);
    useSessionStore.getState().actions.setSelectedAnchor(anchor);

    const contextSegments = segments.filter(
      s => s.startMs <= alignedTimestamp + 5000 && s.endMs >= alignedTimestamp - 5000
    );
    const transcriptContext = contextSegments.map(s => s.text).join(' ').slice(0, 200);

    classroomDataService.saveStudentAnchor(
      sessionId,
      studentId,
      studentName,
      alignedTimestamp,
      'confusion',
      transcriptContext
    );

    if (timeline) {
      useCaptureEditorStore.getState().actions.setTimeline({ ...timeline, anchors: [...timeline.anchors, anchor] });
    }

    // 标记后直接切到困惑点详情
    useUIStore.getState().actions.setReviewTab('anchor-detail');
  }, [sessionId, studentId, studentName, timeline, segments]);

  // ── handleAnchorSelect ──
  const handleAnchorSelect = useCallback((anchor: Anchor) => {
    useSessionStore.getState().actions.setSelectedAnchor(anchor);
    usePlayerStore.getState().actions.setCurrentTime(anchor.timestamp);
    useUIStore.getState().actions.setReviewTab('anchor-detail');
  }, []);

  // ── handleResolveAnchor ──
  const handleResolveAnchor = useCallback(() => {
    if (!selectedAnchor) return;

    anchorService.resolve(selectedAnchor.id, sessionId);

    classroomDataService.resolveAnchor(selectedAnchor.id);

    useCaptureEditorStore.getState().actions.setAnchors(prev => prev.map(a =>
      a.id === selectedAnchor.id ? { ...a, resolved: true } : a
    ));
    useSessionStore.getState().actions.setSelectedAnchor({ ...selectedAnchor, resolved: true });

    if (timeline) {
      useCaptureEditorStore.getState().actions.setTimeline({
        ...timeline,
        anchors: timeline.anchors.map(a =>
          a.id === selectedAnchor.id ? { ...a, resolved: true } : a
        ),
      });
    }
  }, [selectedAnchor, sessionId, timeline]);

  return {
    handleAnchorMark,
    handlePlaybackAnchorAdd,
    handleAnchorSelect,
    handleResolveAnchor,
  };
}
