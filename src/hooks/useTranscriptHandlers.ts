'use client';

import { useCallback } from 'react';
import { useSessionStore } from '@/stores/session-store';
import { useCollectionStore } from '@/stores/collection-store';
import { useCaptureEditorStore } from '@/stores/capture-editor-store';
import {
  addTranscripts,
  db,
  ANONYMOUS_USER_ID,
  saveAudioSession,
} from '@/lib/db';
import { classroomDataService } from '@/lib/services/classroom-data-service';
import { memoryService, type ClassTimeline } from '@/lib/services/memory-service';
import { appendLiveRecordingSegments } from '@/lib/capture/live-recording';
import {
  buildSourcePreviewText,
  buildSupportReferenceSnippet,
  resolvePendingAudioFailureStatus,
  compactText,
  VIDEO_INSIGHT_COLORS,
} from '@/lib/utils/page-utils';
import { UIConfig } from '@/lib/config';
import type { TranscriptSegment, ImportedVideoSource } from '@/types';
import type { Anchor } from '@/lib/services/anchor-service';
import type {
  SourceIngestItem,
  PendingRecordedAudio,
} from '@/types/page-types';
import type { VideoInsightItem } from '@/components/VideoInsightTimeline';
import { shouldApplyTranscriptToActiveSession } from '@/lib/services/asr/session-isolation';
import {
  runDiarizationForSession,
  shouldRunPostBatchDiarization,
} from '@/lib/services/asr/diarization-service';

// ── Types ──────────────────────────────────────────────────────────

export interface UseTranscriptHandlersDeps {
  /** Persist capture to workspace API */
  persistCaptureToWorkspace: (params: {
    sourceType: string;
    sourceKey: string;
    role: string;
    contentType: string;
    title: string;
    previewText?: string;
    normalizedText?: string;
    sourceUrl?: string;
    mediaUrl?: string;
    tutorContext?: string;
    occurredAt?: string;
    metadata?: Record<string, unknown>;
  }) => void;
  /** Resolve pending recorded audio by recordingId */
  resolvePendingRecordedAudio: (recordingId?: string) => PendingRecordedAudio | null;
  /** Clear pending recorded audio by recordingId */
  clearPendingRecordedAudio: (recordingId?: string) => void;
  /** Current user ID (for persist) */
  userId: string | undefined;
  /** Reactive: current time (for video insight positioning) */
  currentTime: number;
  /** Reactive: current video source (for video insight guard) */
  videoSource: ImportedVideoSource | null;
  /** Reactive: current segments (for text update) */
  segments: TranscriptSegment[];
  /** Reactive: current anchors (for timeline rebuild) */
  anchors: Anchor[];
  /** Reactive: current sessionId (for text update) */
  sessionId: string;
  /** Reactive: current timeline (for metadata) */
  timeline: ClassTimeline | null;
}

export interface UseTranscriptHandlersRefs {
  segmentsRef: React.MutableRefObject<TranscriptSegment[]>;
  liveSegmentsRef: React.MutableRefObject<TranscriptSegment[]>;
  anchorsRef: React.MutableRefObject<Anchor[]>;
}

// ── Hook ───────────────────────────────────────────────────────────

export function useTranscriptHandlers(
  deps: UseTranscriptHandlersDeps,
  refs: UseTranscriptHandlersRefs,
) {
  const {
    persistCaptureToWorkspace,
    resolvePendingRecordedAudio,
    clearPendingRecordedAudio,
    userId,
    currentTime,
    videoSource,
    segments,
    anchors,
    sessionId,
    timeline,
  } = deps;

  const {
    segmentsRef,
    liveSegmentsRef,
    anchorsRef,
  } = refs;

  // ── handleTranscriptUpdate ─────────────────────────────────────

  const handleTranscriptUpdate = useCallback((newSegments: TranscriptSegment[], meta?: { recordingId?: string; sessionId?: string }) => {
    const pendingAudio = resolvePendingRecordedAudio(meta?.recordingId);
    let effectiveSegments = newSegments;
    let shouldUpdateActiveEditor = shouldApplyTranscriptToActiveSession(
      meta?.sessionId,
      useSessionStore.getState().sessionId,
    );

    if (pendingAudio) {
      const { appendedSegments, mergedSegments, totalDurationMs } = appendLiveRecordingSegments({
        existingSegments: pendingAudio.baseSegments,
        incomingSegments: newSegments,
        sourceItemId: pendingAudio.itemId,
        offsetMs: pendingAudio.baseOffsetMs,
      });
      const previewText = buildSourcePreviewText(appendedSegments, 180);
      const normalizedText = buildSupportReferenceSnippet(appendedSegments, 2800);
      const currentUserId = userId || ANONYMOUS_USER_ID;
      const mergedDurationMs = Math.max(
        totalDurationMs,
        pendingAudio.baseOffsetMs + pendingAudio.durationMs
      );

      effectiveSegments = mergedSegments;
      shouldUpdateActiveEditor = shouldApplyTranscriptToActiveSession(
        pendingAudio.sessionId,
        useSessionStore.getState().sessionId,
      );
      const shouldDiarizeFinalSegments = shouldRunPostBatchDiarization(
        appendedSegments,
        pendingAudio.baseOffsetMs,
      );
      void (async () => {
        if (pendingAudio.replaceExistingTranscript) {
          await db.transcripts.where('sessionId').equals(pendingAudio.sessionId).delete();
        }
        await addTranscripts(pendingAudio.sessionId, currentUserId, appendedSegments.map((seg) => ({
          text: seg.text,
          startMs: seg.startMs,
          endMs: seg.endMs,
          confidence: seg.confidence || 1.0,
          isFinal: true,
        })));

        // 顺序必须是：完整原声定稿落盘 → 说话人整理。
        // 这样说话人增强只附着在最终文本上，不可能用 realtime 草稿反向覆盖定稿。
        if (shouldDiarizeFinalSegments) {
          await runDiarizationForSession(
            pendingAudio.blob,
            pendingAudio.sessionId,
            appendedSegments,
            (updatedSegments) => {
              if (!shouldApplyTranscriptToActiveSession(
                pendingAudio.sessionId,
                useSessionStore.getState().sessionId,
              )) return;

              liveSegmentsRef.current = updatedSegments;
              segmentsRef.current = updatedSegments;
              useCaptureEditorStore.getState().actions.setSegments(updatedSegments);
            },
          );
        }
      })().catch((err) => console.error('Failed to persist batch transcript to IndexedDB:', err));

      // Store actions (pure writers)
      const sessionAct = useSessionStore.getState().actions;
      const colAct = useCollectionStore.getState().actions;
      const editorAct = useCaptureEditorStore.getState().actions;

      if (shouldUpdateActiveEditor) {
        sessionAct.setSessionMediaDurationMs(Math.max(useSessionStore.getState().sessionMediaDurationMs, mergedDurationMs));
      }
      colAct.setSourceItems((prev: SourceIngestItem[]) =>
        prev.map((item) =>
          item.id === pendingAudio.itemId
            ? {
                ...item,
                preview: previewText,
                fullText: normalizedText,
                segmentCount: appendedSegments.length,
                durationMs: pendingAudio.durationMs,
                reviewable: true,
                sessionId: pendingAudio.sessionId,
                status: 'ready' as const,
                statusText: undefined,
              }
            : item
        )
      );
      void persistCaptureToWorkspace({
        sourceType: 'live-audio',
        sourceKey: `live:${pendingAudio.itemId}`,
        role: 'primary',
        contentType: 'audio',
        title: pendingAudio.title,
        previewText,
        normalizedText,
        tutorContext: normalizedText,
        mediaUrl: pendingAudio.mediaUrl,
        occurredAt: new Date().toISOString(),
        metadata: {
          from: 'live-recording',
          sessionId: pendingAudio.sessionId,
          duration: pendingAudio.durationMs,
          durationSec: Math.round(pendingAudio.durationMs / 1000),
          segmentCount: appendedSegments.length,
          transcriptSegments: appendedSegments.slice(0, 500).map((s) => ({
            text: s.text,
            startMs: s.startMs,
            endMs: s.endMs,
          })),
        },
      });

      classroomDataService.saveSession({
        id: pendingAudio.sessionId,
        subject: UIConfig.defaultSubject,
        topic: UIConfig.defaultLessonTitle,
        teacherName: UIConfig.defaultTeacher || 'Teacher',
        status: 'completed',
        duration: mergedDurationMs,
      });

      const nextTimeline = memoryService.buildTimeline(
        pendingAudio.sessionId,
        mergedSegments,
        anchorsRef.current,
        {
          subject: UIConfig.defaultSubject,
          teacher: UIConfig.defaultTeacher || 'Teacher',
          date: new Date().toISOString().split('T')[0],
        }
      );
      if (shouldUpdateActiveEditor) {
        editorAct.setTimeline(nextTimeline);
      }
      memoryService.save(nextTimeline);
      clearPendingRecordedAudio(meta?.recordingId);
    }

    // 上一节课的完整原声定稿可能在下一节课开始后才回来。
    // 数据仍正常写回它自己的 session，但绝不能覆盖当前录课 UI / refs。
    if (!shouldUpdateActiveEditor) return;

    liveSegmentsRef.current = effectiveSegments;
    segmentsRef.current = effectiveSegments;

    const editorAct = useCaptureEditorStore.getState().actions;
    const sessionAct = useSessionStore.getState().actions;
    editorAct.setSegments(effectiveSegments);
    sessionAct.setDataSource('live');
    editorAct.setVideoSource(null);
  }, [clearPendingRecordedAudio, persistCaptureToWorkspace, resolvePendingRecordedAudio, userId]);

  // ── handleRecordingTranscriptionError ──────────────────────────

  const handleRecordingTranscriptionError = useCallback((message: string, meta?: { recordingId?: string; finalPassOnly?: boolean }) => {
    const pendingAudio = resolvePendingRecordedAudio(meta?.recordingId);
    if (!pendingAudio) return;

    if (meta?.finalPassOnly) {
      // 完整原声定稿是 realtime 之上的增强，不是唯一转录。
      // 它失败时保留已有字幕和原声，不能把整节课降级成「转录失败」。
      clearPendingRecordedAudio(meta.recordingId);
      return;
    }

    useCollectionStore.getState().actions.setSourceItems((prev: SourceIngestItem[]) =>
      prev.map((item) =>
        item.id === pendingAudio.itemId
          ? {
              ...item,
              reviewable: false,
              status: 'failed' as const,
              statusText: resolvePendingAudioFailureStatus(message),
            }
          : item
        )
    );

    void saveAudioSession(pendingAudio.blob, pendingAudio.sessionId, userId || ANONYMOUS_USER_ID, {
      duration: pendingAudio.durationMs,
      sourceType: 'recording',
      mediaUrl: pendingAudio.mediaUrl,
      transcriptionStatus: 'failed',
      transcriptionError: message,
    }).catch((err) => console.error('Failed to mark recording transcription as failed:', err));

    clearPendingRecordedAudio(meta?.recordingId);
  }, [clearPendingRecordedAudio, resolvePendingRecordedAudio, userId]);

  // ── handleTranscriptEnhanced ───────────────────────────────────

  const handleTranscriptEnhanced = useCallback((enhancedSegments: TranscriptSegment[]) => {
    liveSegmentsRef.current = enhancedSegments;
    useCaptureEditorStore.getState().actions.setSegments(enhancedSegments);
  }, []);

  // ── _handleVideoAssistantMessage ───────────────────────────────

  const handleVideoAssistantMessage = useCallback((payload: {
    id: string;
    prompt: string;
    content: string;
    timestamps: number[];
  }) => {
    if (!videoSource) return;

    const normalizedTimestamps = Array.from(new Set(payload.timestamps))
      .filter((value) => Number.isFinite(value) && value >= 0)
      .sort((a, b) => a - b);
    const insightTimestamps = normalizedTimestamps.length > 0
      ? normalizedTimestamps
      : [Math.max(0, currentTime)];

    const insightId = `insight-${payload.id}`;
    const editorAct = useCaptureEditorStore.getState().actions;
    editorAct.setVideoInsightItems((prev: VideoInsightItem[]) => {
      const baseItems = prev.filter((item) => !item.id.startsWith('seed-'));
      const nextItem: VideoInsightItem = {
        id: insightId,
        prompt: compactText(payload.prompt || '閺堫剝鐤嗛幓鎰版６', 48),
        summary: compactText(payload.content, 120),
        timestamps: insightTimestamps,
        color: VIDEO_INSIGHT_COLORS[baseItems.length % VIDEO_INSIGHT_COLORS.length],
      };
      return [nextItem, ...baseItems].slice(0, 12);
    });
    editorAct.setActiveVideoInsightId(insightId);
  }, [currentTime, videoSource]);

  // ── handleTranscriptTextUpdate ─────────────────────────────────

  const handleTranscriptTextUpdate = useCallback((segmentId: string, nextText: string) => {
    const normalized = nextText.trim();
    if (!normalized) return;

    const targetSegment = segments.find(seg => seg.id === segmentId);
    if (!targetSegment || targetSegment.text === normalized) return;

    const updatedSegments = segments.map(seg =>
      seg.id === segmentId ? { ...seg, text: normalized } : seg
    );

    const editorAct = useCaptureEditorStore.getState().actions;
    editorAct.setSegments(updatedSegments);
    liveSegmentsRef.current = updatedSegments;

    const metadata = timeline
      ? { subject: timeline.subject, teacher: timeline.teacher, date: timeline.date }
      : {
          subject: UIConfig.defaultSubject,
          teacher: UIConfig.defaultTeacher || 'Teacher',
          date: new Date().toISOString().split('T')[0],
        };

    const nextTimeline = memoryService.buildTimeline(
      sessionId,
      updatedSegments,
      anchors,
      metadata
    );
    editorAct.setTimeline(nextTimeline);
    memoryService.save(nextTimeline);

    void (async () => {
      try {
        const transcripts = await db.transcripts
          .where('sessionId')
          .equals(sessionId)
          .toArray();
        const matched = transcripts.filter(
          (item) =>
            item.startMs === targetSegment.startMs &&
            item.endMs === targetSegment.endMs
        );
        if (matched.length === 0) return;

        await db.transcripts.bulkPut(
          matched.map((item) => ({
            ...item,
            text: normalized,
          }))
        );
      } catch (err) {
        console.error('[TranscriptEdit] Persist failed:', err);
      }
    })();
  }, [anchors, segments, sessionId, timeline]);

  return {
    handleTranscriptUpdate,
    handleRecordingTranscriptionError,
    handleTranscriptEnhanced,
    handleVideoAssistantMessage,
    handleTranscriptTextUpdate,
  };
}
