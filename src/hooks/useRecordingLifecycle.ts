'use client';

import { useCallback } from 'react';
import { useUIStore } from '@/stores/ui-store';
import { usePlayerStore } from '@/stores/player-store';
import { useSessionStore } from '@/stores/session-store';
import { useCollectionStore } from '@/stores/collection-store';
import { useEchoStore } from '@/stores/echo-store';
import { useCaptureEditorStore } from '@/stores/capture-editor-store';
import {
  saveAudioSession,
  addTranscripts,
  ANONYMOUS_USER_ID,
} from '@/lib/db';
import { classroomDataService } from '@/lib/services/classroom-data-service';
import { memoryService } from '@/lib/services/memory-service';
import { anchorService, type Anchor } from '@/lib/services/anchor-service';
import { resolveLiveRecordingAppendOffset } from '@/lib/capture/live-recording';
import {
  mergeWorkspaceCaptures,
  buildSourcePreviewText,
  buildSupportReferenceSnippet,
  readJsonApiResponse,
} from '@/lib/utils/page-utils';
import { UIConfig } from '@/lib/config';
import type { TranscriptSegment } from '@/types';
import type {
  SourceIngestItem,
  SupportReferenceItem,
  WorkspaceCaptureMessage,
  PendingRecordedAudio,
} from '@/types/page-types';

// ── Types ──────────────────────────────────────────────────────────

export interface UseRecordingLifecycleDeps {
  /** Current auth access token */
  accessToken: string | null;
  /** Whether user is authenticated */
  isAuthenticated: boolean;
  /** Current user object (for id) */
  user: { id: string } | null | undefined;
  /** Student ID (user?.id || 'anonymous') */
  studentId: string;
  /** Refresh daily echo after capture persisted */
  refreshDailyEcho: () => Promise<unknown>;
  /** Clear topics SWR cache */
  clearTopics: () => void;
  /** Clear summary SWR cache */
  clearSummary: () => void;
  /** Reactive anchors state (for handleRecordingStop timeline) */
  anchors: Anchor[];
  /** Reactive sessionId (for handleRecordingStop) */
  sessionId: string;
  /** Reactive sessionMediaDurationMs (for handleRecordingStop) */
  sessionMediaDurationMs: number;
}

export interface UseRecordingLifecycleRefs {
  segmentsRef: React.MutableRefObject<TranscriptSegment[]>;
  sessionIdRef: React.MutableRefObject<string>;
  liveSegmentsRef: React.MutableRefObject<TranscriptSegment[]>;
  sourceItemsRef: React.MutableRefObject<SourceIngestItem[]>;
  supportReferencesRef: React.MutableRefObject<SupportReferenceItem[]>;
  previewObjectUrlsRef: React.MutableRefObject<string[]>;
  pendingCaptureStatusBySourceKeyRef: React.MutableRefObject<Map<string, 'archive' | 'delete'>>;
  pendingRecordedAudiosRef: React.MutableRefObject<Map<string, PendingRecordedAudio>>;
}

// ── Hook ───────────────────────────────────────────────────────────

export function useRecordingLifecycle(
  deps: UseRecordingLifecycleDeps,
  refs: UseRecordingLifecycleRefs,
) {
  const {
    accessToken,
    isAuthenticated,
    user,
    studentId,
    refreshDailyEcho,
    clearTopics,
    clearSummary,
    anchors,
    sessionId,
    sessionMediaDurationMs,
  } = deps;

  const {
    segmentsRef,
    sessionIdRef,
    liveSegmentsRef,
    sourceItemsRef,
    supportReferencesRef,
    previewObjectUrlsRef,
    pendingCaptureStatusBySourceKeyRef,
    pendingRecordedAudiosRef,
  } = refs;

  // ── persistCaptureToWorkspace ──────────────────────────────────

  const persistCaptureToWorkspace = useCallback(async (params: {
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
  }) => {
    if (!isAuthenticated || !user?.id || !accessToken) return;

    try {
      const response = await fetch('/api/workspace/captures', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(params),
      });

      const payload = await readJsonApiResponse<{
        success: boolean;
        capture?: WorkspaceCaptureMessage;
        echoQueued?: boolean;
        echoPending?: boolean;
        echoAlreadyGeneratedToday?: boolean;
        error?: string;
      }>(response, '写入工作区收集失败');

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || '写入工作区收集失败');
      }

      if (payload.capture) {
        const capture = payload.capture;
        const pendingStatusAction = pendingCaptureStatusBySourceKeyRef.current.get(capture.sourceKey);
        if (pendingStatusAction) {
          pendingCaptureStatusBySourceKeyRef.current.delete(capture.sourceKey);
          void fetch('/api/workspace/captures', {
            method: pendingStatusAction === 'delete' ? 'DELETE' : 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify(
              pendingStatusAction === 'delete'
                ? { captureId: capture.id, sourceKey: capture.sourceKey }
                : { captureId: capture.id, sourceKey: capture.sourceKey, action: 'archive' }
            ),
          }).catch((error) => {
            console.error('[workspace.capture.pending-status]', error);
          });
        } else {
          useEchoStore.getState().actions.setWorkspaceCaptures(
            (prev: WorkspaceCaptureMessage[]) => mergeWorkspaceCaptures(prev, [capture])
          );
        }
      }

      if (payload.echoQueued || payload.echoAlreadyGeneratedToday) {
        void refreshDailyEcho();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[workspace.capture]', message);
    }
  }, [accessToken, isAuthenticated, refreshDailyEcho, user?.id]);

  // ── handleRecordingStart ───────────────────────────────────────

  const handleRecordingStart = useCallback((newSessionId: string) => {
    const hasExistingCollectionContext =
      segmentsRef.current.length > 0 ||
      sourceItemsRef.current.length > 0 ||
      supportReferencesRef.current.length > 0;
    const isContinuingCurrentSession =
      newSessionId === sessionIdRef.current && hasExistingCollectionContext;

    // Store actions (pure writers)
    const uiAct = useUIStore.getState().actions;
    const sessionAct = useSessionStore.getState().actions;
    const colAct = useCollectionStore.getState().actions;
    const editorAct = useCaptureEditorStore.getState().actions;

    sessionAct.setSessionId(newSessionId);
    sessionAct.setIsRecording(true);
    uiAct.setShowMobileRecorder(true);
    uiAct.setMobileCollectionSheet(null);
    colAct.setSourceImportError('');
    sessionAct.setDataSource('live');
    // 每次新录音开始，无条件清除 liveSegmentsRef。
    // 它的语义是「当前这次录音产生的实时 segments」，不应跨录音保留。
    liveSegmentsRef.current = [];

    if (!isContinuingCurrentSession && !hasExistingCollectionContext) {
      editorAct.setSegments([]);
      editorAct.setAnchors([]);
      sessionAct.setSelectedAnchor(null);
      clearTopics();
      clearSummary();
      editorAct.setNotes([]);
      editorAct.setActionItems([]);
      editorAct.setTimeline(null);
      sessionAct.setDataSource('live');
      editorAct.setAudioUrl(null);
      editorAct.setAudioBlob(null);
      sessionAct.setSessionMediaDurationMs(0);
      editorAct.setVideoSource(null);
      editorAct.setVideoInsightItems([]);
      editorAct.setActiveVideoInsightId(null);
      colAct.setSourceItems([]);
      colAct.setSourceImportError('');
      colAct.setSourceFilePickerMode('all');
      colAct.setSupportReferences([]);
      anchorService.clear(newSessionId);
    }
    uiAct.setShowConversationHistory(false);
    sessionAct.setSelectedHistoryConversation(null);

    // 同步保存当前会话
    classroomDataService.saveSession({
      id: newSessionId,
      subject: UIConfig.defaultSubject,
      topic: UIConfig.defaultLessonTitle,
      status: 'recording',
      duration: 0,
      createdBy: studentId,
    });
  }, [studentId, clearTopics, clearSummary]);

  // ── handleRecordingStop ────────────────────────────────────────

  const handleRecordingStop = useCallback((blob?: Blob, meta?: { recordingId?: string; sessionId?: string; isContinuation?: boolean; durationMs?: number }) => {
    // Store actions (pure writers)
    const uiAct = useUIStore.getState().actions;
    const sessionAct = useSessionStore.getState().actions;
    const colAct = useCollectionStore.getState().actions;
    const editorAct = useCaptureEditorStore.getState().actions;

    sessionAct.setIsRecording(false);
    uiAct.setShowMobileRecorder(false);
    if (blob) editorAct.setAudioBlob(blob);

    // liveSegmentsRef 在 handleRecordingStart 中已被无条件清除，
    // 此处的值仅包含本次录音期间 streaming ASR 产生的段落。
    const currentSegments = liveSegmentsRef.current.length > 0
      ? liveSegmentsRef.current
      : segmentsRef.current;

    const hasLiveData = liveSegmentsRef.current.length > 0;
    const finalSegments = hasLiveData ? currentSegments : [];

    editorAct.setSegments(currentSegments);
    sessionAct.setDataSource(blob || hasLiveData ? 'live' : 'demo');
    if (hasLiveData) {
      editorAct.setVideoSource(null);
      editorAct.setVideoInsightItems([]);
      editorAct.setActiveVideoInsightId(null);
    }

    const effectiveSessionId = meta?.sessionId || sessionId;
    const duration = typeof meta?.durationMs === 'number' && meta.durationMs > 0
      ? meta.durationMs
      : finalSegments.length > 0
      ? finalSegments[finalSegments.length - 1].endMs
      : 0;
    sessionAct.setSessionMediaDurationMs(duration);

    classroomDataService.saveSession({
      id: effectiveSessionId,
      subject: UIConfig.defaultSubject,
      topic: UIConfig.defaultLessonTitle,
      teacherName: UIConfig.defaultTeacher || 'Teacher',
      status: 'completed',
      duration,
    });

    // Persist audio and transcript to IndexedDB history.
    if (blob) {
      const currentUserId = user?.id || ANONYMOUS_USER_ID;
      const liveMediaUrl = URL.createObjectURL(blob);
      previewObjectUrlsRef.current.push(liveMediaUrl);

      // Save audio blob first.
      saveAudioSession(blob, effectiveSessionId, currentUserId, {
        subject: UIConfig.defaultSubject,
        topic: UIConfig.defaultLessonTitle,
        duration,
      }).catch(err => console.error('Failed to save audio session to history:', err));

      if (finalSegments.length > 0) {
        addTranscripts(effectiveSessionId, currentUserId, finalSegments.map((seg) => ({
          text: seg.text,
          startMs: seg.startMs,
          endMs: seg.endMs,
          confidence: seg.confidence || 1.0,
          isFinal: true,
        }))).catch(err => console.error('Failed to persist transcript to IndexedDB:', err));
      }

      const audioCaptureId = `audio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const recordingId = meta?.recordingId || audioCaptureId;
      const recordingTitle = `录音 ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
      const pendingBaseSegments = meta?.isContinuation ? [...segmentsRef.current] : [];
      const pendingBaseOffsetMs = meta?.isContinuation
        ? resolveLiveRecordingAppendOffset(pendingBaseSegments, sessionMediaDurationMs)
        : 0;
      colAct.setSourceItems((prev: SourceIngestItem[]) => [
        ...prev,
        {
          id: audioCaptureId,
          type: 'audio' as const,
          role: 'primary' as const,
          title: recordingTitle,
          preview: buildSourcePreviewText(finalSegments, 180),
          mediaUrl: liveMediaUrl,
          segmentCount: finalSegments.length,
          addedAt: new Date().toISOString(),
          origin: 'user' as const,
          status: (finalSegments.length > 0 ? 'ready' : 'transcribing') as SourceIngestItem['status'],
          statusText: finalSegments.length > 0 ? '' : '转写稍后回来',
          sessionId: effectiveSessionId,
          durationMs: duration,
          reviewable: finalSegments.length > 0,
        },
      ]);
      if (finalSegments.length > 0) {
        void persistCaptureToWorkspace({
          sourceType: 'live-audio',
          sourceKey: `live:${audioCaptureId}`,
          role: 'primary',
          contentType: 'audio',
          title: recordingTitle,
          previewText: buildSourcePreviewText(finalSegments, 180),
          normalizedText: buildSupportReferenceSnippet(finalSegments, 2800),
          tutorContext: buildSupportReferenceSnippet(finalSegments, 2800),
          mediaUrl: liveMediaUrl,
          occurredAt: new Date().toISOString(),
          metadata: {
            from: 'live-recording',
            sessionId: effectiveSessionId,
            duration,
            segmentCount: finalSegments.length,
          },
        });
      } else {
        pendingRecordedAudiosRef.current.set(recordingId, {
          recordingId,
          itemId: audioCaptureId,
          sessionId: effectiveSessionId,
          title: recordingTitle,
          mediaUrl: liveMediaUrl,
          durationMs: duration,
          blob,
          baseSegments: pendingBaseSegments,
          baseOffsetMs: pendingBaseOffsetMs,
        });
      }
    }

    const tl = memoryService.buildTimeline(
      effectiveSessionId,
      finalSegments,
      anchors,
      { subject: UIConfig.defaultSubject, teacher: UIConfig.defaultTeacher || 'Teacher', date: new Date().toISOString().split('T')[0] }
    );
    editorAct.setTimeline(tl);
    memoryService.save(tl);
    uiAct.setViewMode('record');
  }, [anchors, persistCaptureToWorkspace, sessionId, sessionMediaDurationMs, user]);

  return {
    persistCaptureToWorkspace,
    handleRecordingStart,
    handleRecordingStop,
  };
}
