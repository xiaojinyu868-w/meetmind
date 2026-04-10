'use client';

/**
 * useReviewSession — 复习态恢复与进入逻辑
 *
 * 从 page.tsx 提取。管理 3 种复习态恢复路径：
 * - restoreReviewSession: 从 IndexedDB audioSession 恢复
 * - restoreReviewFromCollectionFallback: 从 transcripts 回退恢复
 * - restoreFromServerTranscript: 从服务端转录数据恢复
 *
 * openReviewFromCollection 仍留在 page.tsx（统一入口，依赖过多 page-local 函数）。
 *
 * 依赖规则：hooks → stores + types + lib/db + lib/utils + lib/services
 */

import { useCallback, type MutableRefObject } from 'react';
import { useUIActions } from '@/stores/ui-store';
import { usePlayerActions } from '@/stores/player-store';
import { useSessionActions } from '@/stores/session-store';
import { useCaptureEditorActions } from '@/stores/capture-editor-store';
import { useCollectionStore } from '@/stores/collection-store';
import { type Anchor } from '@/lib/services/anchor-service';
import { memoryService } from '@/lib/services/memory-service';
import { db, saveAudioSession, ANONYMOUS_USER_ID } from '@/lib/db';
import { parseVideoLink } from '@/lib/utils/video-link';
import { buildStoredVideoSource, isStoredVideoSession } from '@/lib/capture/video-session';
import { buildSeedVideoInsights } from '@/lib/utils/page-utils';
import { UIConfig } from '@/lib/config';
import type { TranscriptSegment, ImportedVideoSource } from '@/types';
import type { ReviewTab, VideoWorkspaceTab, SourceIngestItem } from '@/types/page-types';

// ── Types ────────────────────────────────────────────────────────

export interface UseReviewSessionDeps {
  /** 来自 useTopics 的 clear 回调 */
  clearTopics: () => void;
  /** 来自 useSummary 的 clear 回调 */
  clearSummary: () => void;
  /** 当前登录用户（仅 restoreFromServerTranscript 需要） */
  user: { id: string } | null | undefined;
}

export interface UseReviewSessionRefs {
  liveSegmentsRef: MutableRefObject<TranscriptSegment[]>;
  segmentsRef: MutableRefObject<TranscriptSegment[]>;
  sessionIdRef: MutableRefObject<string>;
  previewObjectUrlsRef: MutableRefObject<string[]>;
}

export interface UseReviewSessionReturn {
  restoreReviewSession: (
    targetSessionId: string,
    options?: {
      selectedAnchorId?: string | null;
      currentTime?: number;
      reviewTab?: ReviewTab | null;
      videoWorkspaceTab?: VideoWorkspaceTab | null;
      showTranscriptBar?: boolean;
    },
  ) => Promise<boolean>;
  restoreReviewFromCollectionFallback: (item: SourceIngestItem) => Promise<boolean>;
  restoreFromServerTranscript: (item: SourceIngestItem) => Promise<boolean>;
}

// ── Hook ─────────────────────────────────────────────────────────

export function useReviewSession(
  deps: UseReviewSessionDeps,
  refs: UseReviewSessionRefs,
): UseReviewSessionReturn {
  const {
    clearTopics,
    clearSummary,
    user,
  } = deps;

  const { liveSegmentsRef, segmentsRef, sessionIdRef, previewObjectUrlsRef } = refs;

  // Store actions — 无需传入，直接从 store 获取
  const uiActions = useUIActions();
  const playerActions = usePlayerActions();
  const sessionActions = useSessionActions();
  const captureEditorActions = useCaptureEditorActions();

  // Setter aliases（与 page.tsx 中一致）
  const setViewMode = uiActions.setViewMode;
  const setReviewTab = uiActions.setReviewTab;
  const setVideoWorkspaceTab = uiActions.setVideoWorkspaceTab;
  const setShowConversationHistory = uiActions.setShowConversationHistory;
  const setShowTranscriptBar = uiActions.setShowTranscriptBar;

  const setCurrentTime = playerActions.setCurrentTime;

  const setSessionId = sessionActions.setSessionId;
  const setDataSource = sessionActions.setDataSource;
  const setSessionMediaDurationMs = sessionActions.setSessionMediaDurationMs;
  const setVideoSeekNonce = sessionActions.setVideoSeekNonce;
  const setVideoPlayNonce = sessionActions.setVideoPlayNonce;
  const setSelectedAnchor = sessionActions.setSelectedAnchor;
  const setSelectedHistoryConversation = sessionActions.setSelectedHistoryConversation;

  const setSegments = captureEditorActions.setSegments;
  const setAnchors = captureEditorActions.setAnchors;
  const setTimeline = captureEditorActions.setTimeline;
  const setActionItems = captureEditorActions.setActionItems;
  const setAudioBlob = captureEditorActions.setAudioBlob;
  const setAudioUrl = captureEditorActions.setAudioUrl;
  const setVideoSource = captureEditorActions.setVideoSource;
  const setNotes = captureEditorActions.setNotes;
  const setVideoInsightItems = captureEditorActions.setVideoInsightItems;
  const setActiveVideoInsightId = captureEditorActions.setActiveVideoInsightId;

  // ── restoreReviewSession ──────────────────────────────────────

  const restoreReviewSession = useCallback(async (
    targetSessionId: string,
    options?: {
      selectedAnchorId?: string | null;
      currentTime?: number;
      reviewTab?: ReviewTab | null;
      videoWorkspaceTab?: VideoWorkspaceTab | null;
      showTranscriptBar?: boolean;
    }
  ): Promise<boolean> => {
    const session = await db.audioSessions
      .where('sessionId')
      .equals(targetSessionId)
      .first();
    if (!session) return false;

    const transcripts = await db.transcripts
      .where('sessionId')
      .equals(targetSessionId)
      .toArray();
    if (!transcripts.length) return false;

    const sortedTranscripts = transcripts.sort((a, b) => a.startMs - b.startMs);
    const loadedSegments: TranscriptSegment[] = sortedTranscripts.map((item, index) => ({
      id: `loaded-${item.startMs}-${index}`,
      text: item.text,
      startMs: item.startMs,
      endMs: item.endMs,
      confidence: item.confidence,
      isFinal: item.isFinal,
    }));

    const loadedAnchors = await db.anchors
      .where('sessionId')
      .equals(targetSessionId)
      .toArray();
    const anchorsWithResolved: Anchor[] = loadedAnchors.map((anchor) => ({
      id: anchor.id?.toString() || '',
      sessionId: anchor.sessionId,
      studentId: '',
      timestamp: anchor.timestamp,
      type: anchor.type,
      resolved: anchor.status === 'resolved',
      cancelled: false,
      note: anchor.note,
      aiExplanation: anchor.aiExplanation,
      createdAt: anchor.createdAt.toISOString(),
    }));

    setSessionId(targetSessionId);
    setViewMode('review');
    setSegments(loadedSegments);
    setAnchors(anchorsWithResolved);
    setSelectedAnchor(null);
    setShowConversationHistory(false);
    setSelectedHistoryConversation(null);
    setActionItems([]);
    clearTopics();
    clearSummary();
    setNotes([]);
    liveSegmentsRef.current = loadedSegments;
    setSessionMediaDurationMs(session.duration || 0);

    const isVideoSession = isStoredVideoSession(session);
    if (isVideoSession) {
      let playableUrl = '';
      if (session.blob) {
        playableUrl = URL.createObjectURL(session.blob);
        previewObjectUrlsRef.current.push(playableUrl);
      } else if (session.mediaUrl) {
        playableUrl = session.mediaUrl;
      }
      const restoredSource = buildStoredVideoSource(session, { playableUrl });
      if (!restoredSource) {
        return false;
      }
      setVideoSource(restoredSource);
      setDataSource('video');
      setVideoWorkspaceTab(options?.videoWorkspaceTab || 'chat');
      setShowTranscriptBar(Boolean(options?.showTranscriptBar));
      setVideoSeekNonce(0);
      setVideoPlayNonce(0);
      const seededInsights = buildSeedVideoInsights(loadedSegments);
      setVideoInsightItems(seededInsights);
      setActiveVideoInsightId(seededInsights[0]?.id || null);
      setAudioBlob(null);
      setAudioUrl(null);
      setReviewTab(options?.reviewTab || 'timeline');
    } else {
      setVideoSource(null);
      setDataSource('live');
      setVideoWorkspaceTab('chat');
      setVideoInsightItems([]);
      setActiveVideoInsightId(null);
      setShowTranscriptBar(false);
      setVideoSeekNonce(0);
      setVideoPlayNonce(0);
      setReviewTab(options?.reviewTab || 'timeline');
      if (session.blob) {
        setAudioBlob(session.blob);
        setAudioUrl(null);
      } else if (session.mediaUrl) {
        setAudioBlob(null);
        setAudioUrl(session.mediaUrl);
      } else {
        setAudioBlob(null);
        setAudioUrl(null);
      }
    }

    const restoredAnchor = options?.selectedAnchorId
      ? anchorsWithResolved.find((anchor) => anchor.id === options.selectedAnchorId)
      : null;
    if (restoredAnchor) {
      setSelectedAnchor(restoredAnchor);
      setCurrentTime(restoredAnchor.timestamp);
      if (!isVideoSession) {
        setReviewTab('anchor-detail');
      }
    } else if (typeof options?.currentTime === 'number' && Number.isFinite(options.currentTime)) {
      setCurrentTime(Math.max(0, Math.floor(options.currentTime)));
    } else {
      setCurrentTime(0);
    }

    const sessionDate = session.createdAt instanceof Date
      ? session.createdAt
      : new Date(session.createdAt);
    const timelineData = memoryService.buildTimeline(
      targetSessionId,
      loadedSegments,
      anchorsWithResolved,
      {
        subject: session.subject || UIConfig.defaultSubject,
        teacher: UIConfig.defaultTeacher || 'Teacher',
        date: sessionDate.toISOString().split('T')[0],
      }
    );
    setTimeline(timelineData);
    memoryService.save(timelineData);

    return true;
  }, [clearSummary, clearTopics]);

  // ── restoreReviewFromCollectionFallback ────────────────────────

  const restoreReviewFromCollectionFallback = useCallback(async (
    item: SourceIngestItem
  ): Promise<boolean> => {
    if (!item.sessionId) return false;

    const transcripts = await db.transcripts
      .where('sessionId')
      .equals(item.sessionId)
      .toArray();
    if (!transcripts.length) return false;

    const sortedTranscripts = transcripts.sort((a, b) => a.startMs - b.startMs);
    const loadedSegments: TranscriptSegment[] = sortedTranscripts.map((entry, index) => ({
      id: `fallback-${entry.startMs}-${index}`,
      text: entry.text,
      startMs: entry.startMs,
      endMs: entry.endMs,
      confidence: entry.confidence,
      isFinal: entry.isFinal,
    }));

    const loadedAnchors = await db.anchors.where('sessionId').equals(item.sessionId).toArray();
    const anchorsWithResolved: Anchor[] = loadedAnchors.map((anchor) => ({
      id: anchor.id?.toString() || '',
      sessionId: anchor.sessionId,
      studentId: '',
      timestamp: anchor.timestamp,
      type: anchor.type,
      resolved: anchor.status === 'resolved',
      cancelled: false,
      note: anchor.note,
      aiExplanation: anchor.aiExplanation,
      createdAt: anchor.createdAt.toISOString(),
    }));

    setSessionId(item.sessionId);
    sessionIdRef.current = item.sessionId;
    setViewMode('review');
    setSegments(loadedSegments);
    segmentsRef.current = loadedSegments;
    liveSegmentsRef.current = loadedSegments;
    setAnchors(anchorsWithResolved);
    setSelectedAnchor(null);
    setShowConversationHistory(false);
    setSelectedHistoryConversation(null);
    setActionItems([]);
    clearTopics();
    clearSummary();
    setNotes([]);
    setCurrentTime(0);

    const inferredDuration = Math.max(
      item.durationMs || 0,
      loadedSegments[loadedSegments.length - 1]?.endMs || 0
    );
    setSessionMediaDurationMs(inferredDuration);

    if (item.type === 'video') {
      const detected = item.attachmentUrl ? parseVideoLink(item.attachmentUrl) : null;

      // 跨端恢复 B 站视频：用 bvid/cid 构建代理音频 URL
      const isBili = item.videoProvider === 'bilibili' || detected?.provider === 'bilibili' || !!item.bvid;
      let biliProxyAudioUrl: string | undefined;
      if (isBili && item.bvid) {
        const params = new URLSearchParams({ bvid: item.bvid, type: 'audio' });
        if (item.cid) params.set('cid', String(item.cid));
        biliProxyAudioUrl = `/api/video/proxy?${params.toString()}`;
      }

      // 构建 embedUrl：优先用服务器存储的，再 fallback 到从 URL 解析的，最后用 bvid 拼接
      const embedUrl = item.embedUrl || detected?.embedUrl
        || (isBili && item.bvid ? `https://player.bilibili.com/player.html?bvid=${item.bvid}&page=1` : undefined);

      const restoredSource: ImportedVideoSource = {
        provider: detected?.provider || item.videoProvider || (isBili ? 'bilibili' : 'generic'),
        providerLabel: detected?.providerLabel || (isBili ? 'Bilibili' : 'Web Video'),
        originalUrl: item.attachmentUrl || item.mediaUrl || '',
        embedUrl,
        playableUrl: item.mediaUrl || item.attachmentUrl || undefined,
        thumbnailUrl: item.previewUrl,
        title: item.title,
        durationSec: inferredDuration > 0 ? inferredDuration / 1000 : undefined,
        audioUrl: biliProxyAudioUrl || item.audioUrl,
        bvid: item.bvid,
        cid: item.cid,
        sourceMode: item.sourceMode as ImportedVideoSource['sourceMode'],
      };
      setVideoSource(restoredSource);
      setDataSource('video');
      setVideoWorkspaceTab('chat');
      const seededInsights = buildSeedVideoInsights(loadedSegments);
      setVideoInsightItems(seededInsights);
      setActiveVideoInsightId(seededInsights[0]?.id || null);
      setAudioBlob(null);
      setAudioUrl(null);
    } else {
      setVideoSource(null);
      setDataSource('live');
      setVideoWorkspaceTab('chat');
      setVideoInsightItems([]);
      setActiveVideoInsightId(null);
      setAudioBlob(null);
      setAudioUrl(item.mediaUrl || null);
    }

    setReviewTab('timeline');
    setShowTranscriptBar(false);
    setVideoSeekNonce(0);
    setVideoPlayNonce(0);

    const fallbackTimeline = memoryService.buildTimeline(
      item.sessionId,
      loadedSegments,
      anchorsWithResolved,
      {
        subject: UIConfig.defaultSubject,
        teacher: UIConfig.defaultTeacher || 'Teacher',
        date: new Date().toISOString().split('T')[0],
      }
    );
    setTimeline(fallbackTimeline);
    memoryService.save(fallbackTimeline);

    return true;
  }, [clearSummary, clearTopics]);

  // ── restoreFromServerTranscript ───────────────────────────────

  const restoreFromServerTranscript = useCallback(async (
    item: SourceIngestItem
  ): Promise<boolean> => {
    const rawSegments = item.serverTranscriptSegments;
    if (!rawSegments || rawSegments.length === 0) return false;

    // 使用已有 sessionId 或生成一个
    const targetSessionId = item.sessionId || `video-server-${item.id}-${Date.now()}`;
    const currentUserId = user?.id || ANONYMOUS_USER_ID;

    // 构建 TranscriptSegment 数组
    const loadedSegments: TranscriptSegment[] = rawSegments.map((seg, index) => ({
      id: seg.id || `server-${seg.startMs ?? 0}-${index}`,
      text: seg.text || '',
      startMs: seg.startMs ?? 0,
      endMs: seg.endMs ?? (seg.startMs ?? 0) + 3000,
      confidence: 1,
      isFinal: true,
    }));

    // 设置 session 状态
    setSessionId(targetSessionId);
    sessionIdRef.current = targetSessionId;
    setViewMode('review');
    setSegments(loadedSegments);
    segmentsRef.current = loadedSegments;
    liveSegmentsRef.current = loadedSegments;
    setAnchors([]);
    setSelectedAnchor(null);
    setShowConversationHistory(false);
    setSelectedHistoryConversation(null);
    setActionItems([]);
    clearTopics();
    clearSummary();
    setNotes([]);
    setCurrentTime(0);

    const inferredDuration = Math.max(
      item.durationMs || 0,
      loadedSegments[loadedSegments.length - 1]?.endMs || 0
    );
    setSessionMediaDurationMs(inferredDuration);

    // 设置视频源
    if (item.type === 'video') {
      const detected = item.attachmentUrl ? parseVideoLink(item.attachmentUrl) : null;

      // 跨端恢复 B 站视频：用 bvid/cid 构建代理音频 URL
      const isBili = item.videoProvider === 'bilibili' || detected?.provider === 'bilibili' || !!item.bvid;
      let biliProxyAudioUrl: string | undefined;
      if (isBili && item.bvid) {
        const params = new URLSearchParams({ bvid: item.bvid, type: 'audio' });
        if (item.cid) params.set('cid', String(item.cid));
        biliProxyAudioUrl = `/api/video/proxy?${params.toString()}`;
      }

      const restoredSource: ImportedVideoSource = {
        provider: detected?.provider || item.videoProvider || (isBili ? 'bilibili' : 'generic'),
        providerLabel: detected?.providerLabel || (isBili ? 'Bilibili' : 'Web Video'),
        originalUrl: item.attachmentUrl || item.mediaUrl || '',
        embedUrl: item.embedUrl || detected?.embedUrl
          || (isBili && item.bvid ? `https://player.bilibili.com/player.html?bvid=${item.bvid}&page=1` : undefined),
        playableUrl: item.mediaUrl || item.attachmentUrl || undefined,
        thumbnailUrl: item.previewUrl,
        title: item.title,
        durationSec: inferredDuration > 0 ? inferredDuration / 1000 : undefined,
        audioUrl: biliProxyAudioUrl || item.audioUrl,
        bvid: item.bvid,
        cid: item.cid,
        sourceMode: item.sourceMode as ImportedVideoSource['sourceMode'],
      };
      setVideoSource(restoredSource);
      setDataSource('video');
      setVideoWorkspaceTab('chat');
      const seededInsights = buildSeedVideoInsights(loadedSegments);
      setVideoInsightItems(seededInsights);
      setActiveVideoInsightId(seededInsights[0]?.id || null);
      setAudioBlob(null);
      setAudioUrl(null);
    } else {
      setVideoSource(null);
      setDataSource('live');
      setVideoWorkspaceTab('chat');
      setVideoInsightItems([]);
      setActiveVideoInsightId(null);
      setAudioBlob(null);
      setAudioUrl(item.mediaUrl || null);
    }

    setReviewTab('timeline');
    setShowTranscriptBar(false);
    setVideoSeekNonce(0);
    setVideoPlayNonce(0);

    // 构建 timeline
    const timelineData = memoryService.buildTimeline(
      targetSessionId,
      loadedSegments,
      [],
      {
        subject: UIConfig.defaultSubject,
        teacher: UIConfig.defaultTeacher || 'Teacher',
        date: new Date().toISOString().split('T')[0],
      }
    );
    setTimeline(timelineData);
    memoryService.save(timelineData);

    // 异步写入 IndexedDB，供后续恢复
    try {
      await db.transcripts.bulkAdd(
        loadedSegments.map((seg) => ({
          sessionId: targetSessionId,
          userId: currentUserId,
          text: seg.text,
          startMs: seg.startMs,
          endMs: seg.endMs,
          confidence: seg.confidence || 1,
          isFinal: true,
        }))
      );
      await saveAudioSession(null, targetSessionId, currentUserId, {
        subject: UIConfig.defaultSubject,
        topic: item.title || '视频复习',
        duration: inferredDuration,
        sourceType: 'video-link',
        videoUrl: item.attachmentUrl || item.mediaUrl || '',
        videoEmbedUrl: item.embedUrl,
        videoProvider: item.videoProvider,
        thumbnailUrl: item.previewUrl,
      });
    } catch (dbError) {
      console.error('[restoreFromServerTranscript] IndexedDB 写入失败:', dbError);
    }

    // 同步更新 sourceItem 的 sessionId（如果之前是 undefined）
    if (!item.sessionId) {
      const { actions: collectionActions } = useCollectionStore.getState();
      collectionActions.setSourceItems((prev: SourceIngestItem[]) =>
        prev.map((si) => (si.id === item.id ? { ...si, sessionId: targetSessionId } : si))
      );
    }

    return true;
  }, [clearSummary, clearTopics, user?.id]);

  return {
    restoreReviewSession,
    restoreReviewFromCollectionFallback,
    restoreFromServerTranscript,
  };
}
