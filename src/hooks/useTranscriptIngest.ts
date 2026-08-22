'use client';

import { useCallback } from 'react';
import { useUIStore } from '@/stores/ui-store';
import { usePlayerStore } from '@/stores/player-store';
import { useSessionStore } from '@/stores/session-store';
import { useCollectionStore } from '@/stores/collection-store';
import { useCaptureEditorStore } from '@/stores/capture-editor-store';
import {
  generateSessionId,
  saveAudioSession,
  db,
  ANONYMOUS_USER_ID,
} from '@/lib/db';
import { classroomDataService } from '@/lib/services/classroom-data-service';
import { memoryService } from '@/lib/services/memory-service';
import {
  mapSegmentsForAppend,
  getSegmentBatchDurationMs,
  buildSourcePreviewText,
  buildSupportReferenceSnippet,
  buildSeedVideoInsights,
} from '@/lib/utils/page-utils';
import { UIConfig } from '@/lib/config';
import { toast } from 'sonner';
import type { TranscriptSegment, ImportedVideoSource } from '@/types';
import type { Anchor } from '@/lib/services/anchor-service';
import type {
  SourceIngestType,
  SourceIngestRole,
  SourceIngestItem,
  SourceProvenance,
} from '@/types/page-types';
import { buildSourceProvenance } from '@/lib/capture/source-provenance';
import type { AudioSession } from '@/lib/db';

// ── Types ──────────────────────────────────────────────────────────

export interface UseTranscriptIngestDeps {
  appendSourceItem: (params: {
    id?: string;
    sourceKey?: string;
    type: SourceIngestType;
    role: SourceIngestRole;
    title: string;
    preview?: string;
    previewUrl?: string;
    mediaUrl?: string;
    attachmentUrl?: string;
    fullText?: string;
    segmentCount: number;
    keepPrevious?: boolean;
    origin?: 'user' | 'system';
    status?: SourceIngestItem['status'];
    statusText?: string;
    sessionId?: string;
    durationMs?: number;
    reviewable?: boolean;
    provenance?: SourceProvenance;
  }) => void;
  updateSourceItem: (id: string, patch: Partial<SourceIngestItem>) => void;
  clearTopics: () => void;
  clearSummary: () => void;
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
  studentId: string;
  userId: string | undefined;
}

export interface UseTranscriptIngestRefs {
  segmentsRef: React.MutableRefObject<TranscriptSegment[]>;
  sessionIdRef: React.MutableRefObject<string>;
  liveSegmentsRef: React.MutableRefObject<TranscriptSegment[]>;
  anchorsRef: React.MutableRefObject<Anchor[]>;
}

export interface IngestTranscriptParams {
  segments: TranscriptSegment[];
  sourceType: SourceIngestType;
  sourceTitle: string;
  audioBlob?: Blob;
  mediaUrl?: string;
  mediaDurationMs?: number;
  videoSource?: ImportedVideoSource;
  sourceItemId?: string;
  persistSourceKey?: string;
  persistSourceType?: string;
  persistRole?: SourceIngestRole;
  occurredAt?: string;
  sourceUrl?: string;
  provenance?: SourceProvenance;
}

// ── Hook ───────────────────────────────────────────────────────────

export function useTranscriptIngest(
  deps: UseTranscriptIngestDeps,
  refs: UseTranscriptIngestRefs,
) {
  const {
    appendSourceItem,
    updateSourceItem,
    clearTopics,
    clearSummary,
    persistCaptureToWorkspace,
    studentId,
    userId,
  } = deps;

  const {
    segmentsRef,
    sessionIdRef,
    liveSegmentsRef,
    anchorsRef,
  } = refs;

  const ingestTranscriptSegments = useCallback(async (params: IngestTranscriptParams) => {
    const incoming = Array.isArray(params.segments) ? params.segments : [];
    const provenance = params.provenance || buildSourceProvenance({
      ingressChannel: params.videoSource
        ? 'composer'
        : params.sourceType === 'audio' || params.sourceType === 'video' || params.sourceType === 'document'
          ? 'upload'
          : 'system',
      sourceUrl: params.sourceUrl || params.videoSource?.originalUrl,
      normalizedText: incoming.map((segment) => segment.text).join('\n'),
      platformId: params.videoSource?.provider,
      platformLabel: params.videoSource?.providerLabel,
      contentState: 'complete',
      completeness: 1,
    });
    if (incoming.length === 0) {
      toast.warning('未提取到可用内容，请更换资料后重试。');
      return;
    }

    const existingSegments = segmentsRef.current;
    const rawHasExisting = existingSegments.length > 0;

    // 视频是独立的 primary source：每个视频导入应该创建新会话，
    // 不与之前的 segments 合并，否则会出现 A+B 字幕混合 + videoSource 不更新的 bug。
    const isNewVideoImport = params.sourceType === 'video' && !!params.videoSource;
    const hasExisting = rawHasExisting && !isNewVideoImport;

    const nextSessionId = hasExisting ? sessionIdRef.current : generateSessionId();
    const sourceItemId = params.sourceItemId || `${params.sourceType}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const resolvedSourceKey = params.persistSourceKey || `ingest:${sourceItemId}`;
    const offsetMs = hasExisting
      ? Math.max(0, (existingSegments[existingSegments.length - 1]?.endMs || 0) + 1200)
      : 0;
    const normalizedSegments = mapSegmentsForAppend(incoming, sourceItemId, offsetMs);
    const mergedSegments = hasExisting ? [...existingSegments, ...normalizedSegments] : normalizedSegments;
    const currentUserId = userId || ANONYMOUS_USER_ID;
    const duration = mergedSegments[mergedSegments.length - 1]?.endMs || 0;
    const batchDurationMs = getSegmentBatchDurationMs(normalizedSegments);
    const sourceDurationMs =
      typeof params.mediaDurationMs === 'number' && params.mediaDurationMs > 0
        ? params.mediaDurationMs
        : batchDurationMs;
    const persistedDuration = hasExisting
      ? duration
      : Math.max(duration, sourceDurationMs || 0);

    // ── Store actions (pure writers — no reactive subscription) ──
    const uiAct = useUIStore.getState().actions;
    const playerAct = usePlayerStore.getState().actions;
    const sessionAct = useSessionStore.getState().actions;
    const colAct = useCollectionStore.getState().actions;
    const editorAct = useCaptureEditorStore.getState().actions;

    if (!hasExisting) {
      sessionAct.setSessionId(nextSessionId);
      sessionIdRef.current = nextSessionId;
      editorAct.setAnchors([]);
      sessionAct.setSelectedAnchor(null);
      clearTopics();
      clearSummary();
      editorAct.setNotes([]);
      editorAct.setActionItems([]);
      playerAct.setCurrentTime(0);
      sessionAct.setVideoSeekNonce(0);
      sessionAct.setVideoPlayNonce(0);
      uiAct.setShowConversationHistory(false);
      sessionAct.setSelectedHistoryConversation(null);
    }

    const shouldKeepVideoSource = params.sourceType === 'video' && !!params.videoSource;
    if (shouldKeepVideoSource && params.videoSource) {
      sessionAct.setDataSource('video');
      editorAct.setVideoSource(params.videoSource);
      uiAct.setVideoWorkspaceTab('chat');
      const seededInsights = buildSeedVideoInsights(normalizedSegments);
      editorAct.setVideoInsightItems(seededInsights);
      editorAct.setActiveVideoInsightId(seededInsights[0]?.id || null);
    } else if (!hasExisting) {
      sessionAct.setDataSource('demo');
      editorAct.setVideoSource(null);
      editorAct.setVideoInsightItems([]);
      editorAct.setActiveVideoInsightId(null);
    }

    editorAct.setSegments(mergedSegments);
    segmentsRef.current = mergedSegments;
    liveSegmentsRef.current = mergedSegments;
    // 如果当前已在 review 模式（用户正在复习别的内容），不强制切走
    const currentViewMode = useUIStore.getState().viewMode;
    if (currentViewMode !== 'review') {
      uiAct.setViewMode(shouldKeepVideoSource ? 'review' : 'record');
    } else if (shouldKeepVideoSource) {
      // 已在 review 且本次是视频导入，保持 review
    } else {
      // 已在 review 但本次是非视频数据追加（如文档/音频拼接），保持 review 不打断
    }
    colAct.setSourceImportError('');

    const isVideo = params.sourceType === 'video';
    const videoFields = isVideo ? {
      videoProvider: params.videoSource?.provider,
      bvid: params.videoSource?.bvid,
      cid: params.videoSource?.cid,
      audioUrl: params.videoSource?.audioUrl,
      sourceMode: params.videoSource?.sourceMode,
      embedUrl: params.videoSource?.embedUrl,
      videoImported: true as const,
      serverTranscriptSegments: normalizedSegments.slice(0, 2000).map((seg) => ({
        id: seg.id,
        text: seg.text,
        startMs: seg.startMs,
        endMs: seg.endMs,
      })),
    } : {};

    if (params.sourceItemId) {
      updateSourceItem(sourceItemId, {
        sourceKey: resolvedSourceKey,
        type: params.sourceType,
        role: 'primary',
        title: params.sourceTitle,
        preview: buildSourcePreviewText(normalizedSegments, 180),
        previewUrl: isVideo ? params.videoSource?.thumbnailUrl : undefined,
        mediaUrl: isVideo
          ? params.videoSource?.playableUrl || params.videoSource?.originalUrl
          : params.mediaUrl,
        attachmentUrl: isVideo ? params.videoSource?.originalUrl : undefined,
        segmentCount: normalizedSegments.length,
        status: 'ready',
        statusText: undefined,
        origin: 'user',
        sessionId: nextSessionId,
        durationMs: sourceDurationMs,
        reviewable: params.sourceType === 'audio' || isVideo,
        ...videoFields,
        provenance,
      });
    } else {
      appendSourceItem({
        id: sourceItemId,
        sourceKey: resolvedSourceKey,
        type: params.sourceType,
        role: 'primary',
        title: params.sourceTitle,
        preview: buildSourcePreviewText(normalizedSegments, 180),
        previewUrl: isVideo ? params.videoSource?.thumbnailUrl : undefined,
        mediaUrl: isVideo
          ? params.videoSource?.playableUrl || params.videoSource?.originalUrl
          : params.mediaUrl,
        attachmentUrl: isVideo ? params.videoSource?.originalUrl : undefined,
        segmentCount: normalizedSegments.length,
        keepPrevious: hasExisting,
        origin: 'user',
        status: 'ready',
        statusText: undefined,
        sessionId: nextSessionId,
        durationMs: sourceDurationMs,
        reviewable: params.sourceType === 'audio' || isVideo,
        ...videoFields,
        provenance,
      });
    }

    void persistCaptureToWorkspace({
      sourceType: params.persistSourceType || params.sourceType,
      sourceKey: resolvedSourceKey,
      role: params.persistRole || 'primary',
      contentType: params.sourceType,
      title: params.sourceTitle,
      previewText: buildSourcePreviewText(normalizedSegments, 180),
      normalizedText: buildSupportReferenceSnippet(normalizedSegments, 2800),
      sourceUrl: params.sourceUrl || params.videoSource?.originalUrl,
      tutorContext: buildSupportReferenceSnippet(normalizedSegments, 2800),
      occurredAt: params.occurredAt || new Date().toISOString(),
      metadata: {
        from: 'transcript-ingest',
        sessionId: nextSessionId,
        segmentCount: normalizedSegments.length,
        duration: sourceDurationMs || persistedDuration,
        durationSec: params.videoSource?.durationSec ?? (
          (sourceDurationMs || persistedDuration) > 0
            ? Math.round((sourceDurationMs || persistedDuration) / 1000)
            : undefined
        ),
        provider: params.videoSource?.provider,
        providerLabel: params.videoSource?.providerLabel,
        videoProvider: params.videoSource?.provider,
        originalUrl: params.videoSource?.originalUrl,
        embedUrl: params.videoSource?.embedUrl,
        playableUrl: params.videoSource?.playableUrl,
        thumbnailUrl: params.videoSource?.thumbnailUrl,
        sourceMode: params.videoSource?.sourceMode,
        bvid: params.videoSource?.bvid,
        cid: params.videoSource?.cid,
        audioUrl: params.videoSource?.audioUrl,
        videoImported: true,
        provenance,
        // 存储转录片段供跨端恢复（上限 2000 段；服务端证据护栏保证只补全不回退）
        transcriptSegments: normalizedSegments.slice(0, 2000).map((seg) => ({
          id: seg.id,
          text: seg.text,
          startMs: seg.startMs,
          endMs: seg.endMs,
        })),
      },
    });

    try {
      await db.transcripts.bulkAdd(
        normalizedSegments.map((seg) => ({
          sessionId: nextSessionId,
          userId: currentUserId,
          text: seg.text,
          startMs: seg.startMs,
          endMs: seg.endMs,
          confidence: seg.confidence || 1,
          isFinal: true,
        }))
      );
    } catch (error) {
      console.error('Failed to persist imported transcript segments:', error);
    }

    if (!hasExisting) {
      if (shouldKeepVideoSource && params.videoSource) {
        try {
          await saveAudioSession(null, nextSessionId, currentUserId, {
            subject: UIConfig.defaultSubject,
            topic: params.sourceTitle || params.videoSource.title || '视频复习',
            duration: persistedDuration,
            sourceType: 'video-link',
            videoUrl: params.videoSource.originalUrl,
            videoEmbedUrl: params.videoSource.embedUrl,
            videoProvider: params.videoSource.provider,
            thumbnailUrl: params.videoSource.thumbnailUrl,
            importSourceMode: params.videoSource.sourceMode as AudioSession['importSourceMode'],
            importTrace: params.videoSource.importTrace,
          });
        } catch (error) {
          console.error('Failed to persist imported video session:', error);
        }
      } else if (params.audioBlob) {
        saveAudioSession(params.audioBlob, nextSessionId, currentUserId, {
          subject: UIConfig.defaultSubject,
          topic: params.sourceTitle || UIConfig.defaultLessonTitle,
          duration: persistedDuration,
          sourceType: params.sourceType === 'video' ? 'video-file' : 'upload',
          mediaUrl: params.mediaUrl,
          mimeType: params.audioBlob.type || (params.sourceType === 'video' ? 'video/mp4' : 'audio/webm'),
        }).catch((error) => {
          console.error('Failed to persist imported audio session:', error);
        });

        if (!hasExisting && params.sourceType === 'audio') {
          editorAct.setAudioBlob(params.audioBlob);
          editorAct.setAudioUrl(params.mediaUrl || null);
          sessionAct.setSessionMediaDurationMs(sourceDurationMs || persistedDuration);
        }
      }
    }

    classroomDataService.saveSession({
      id: nextSessionId,
      subject: UIConfig.defaultSubject,
      topic: params.sourceTitle || UIConfig.defaultLessonTitle,
      teacherName: UIConfig.defaultTeacher || 'Teacher',
      status: 'completed',
      duration: persistedDuration,
      createdBy: studentId,
    });

    const nextTimeline = memoryService.buildTimeline(
      nextSessionId,
      mergedSegments,
      hasExisting ? anchorsRef.current : [],
      {
        subject: UIConfig.defaultSubject,
        teacher: UIConfig.defaultTeacher || 'Teacher',
        date: new Date().toISOString().split('T')[0],
      }
    );
    editorAct.setTimeline(nextTimeline);
    memoryService.save(nextTimeline);
  }, [appendSourceItem, clearSummary, clearTopics, persistCaptureToWorkspace, studentId, updateSourceItem, userId]);

  return { ingestTranscriptSegments };
}
