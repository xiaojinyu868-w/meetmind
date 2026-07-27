'use client';

import { useCallback } from 'react';
import { toast } from 'sonner';
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
import { uploadRecordingAudio } from '@/lib/services/upload-recording-audio';
import { uploadRecordingKeyframes } from '@/lib/services/upload-recording-keyframes';
import {
  runDiarizationForSession,
  shouldRunPostBatchDiarization,
} from '@/lib/services/asr/diarization-service';
import { resolveLiveRecordingAppendOffset } from '@/lib/capture/live-recording';
import {
  mergeWorkspaceCaptures,
  buildSourcePreviewText,
  buildSupportReferenceSnippet,
  readJsonApiResponse,
} from '@/lib/utils/page-utils';
import { UIConfig } from '@/lib/config';
import { COPY } from '@/lib/ui/copy';
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

      // 返回 captureId：课后关键帧上传等后续动作需要把 artifacts 挂到这条 capture 上
      return payload.capture?.id;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[workspace.capture]', message);
      return undefined;
    }
  }, [accessToken, isAuthenticated, refreshDailyEcho, user?.id]);

  // ── handleRecordingStart ───────────────────────────────────────
  const handleRecordingStart = useCallback((newSessionId: string) => {
    // ── 核心判定：是不是"同一节课续录" ──
    //
    // 语义：只有 newSessionId 和当前挂着的 sessionId 完全相同，
    // 才认为是"续录"（比如暂停后继续）。此时必须保留 segments / sourceItems / anchors，
    // 否则用户感觉"我才停 1 秒，历史就没了"。
    //
    // 反之：只要 sessionId 不同，无论 store 里有没有遗留内容，都是"开新课"——
    // 这时必须把上一节课的所有 UI 状态清掉，否则用户点"开始上课"会看到
    // 上一节课的转录、思维导图、实时段落（即"小猪佩奇泄漏"bug）。
    //
    // 历史教训：之前的判定多加了一个 `hasExistingCollectionContext` 守卫，
    // 目的是"有内容就别清"——这反而让新课开头残留了旧课的 segments，
    // 用户体感是"AI 还没听到我说话，怎么就显示了一堆别的内容"。严重破坏
    // "每节课一张卡"的产品承诺。
    const isContinuingCurrentSession = newSessionId === sessionIdRef.current;

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

    if (!isContinuingCurrentSession) {
      // 开一节新课：清空所有上一节课残留的 UI 状态。
      editorAct.setSegments([]);
      editorAct.setLiveInterimText('');
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

  const handleRecordingStop = useCallback((blob?: Blob, meta?: { recordingId?: string; sessionId?: string; isContinuation?: boolean; durationMs?: number; finalPassPending?: boolean }) => {
    // Store actions (pure writers)
    const uiAct = useUIStore.getState().actions;
    const sessionAct = useSessionStore.getState().actions;
    const colAct = useCollectionStore.getState().actions;
    const editorAct = useCaptureEditorStore.getState().actions;

    sessionAct.setIsRecording(false);
    uiAct.setShowMobileRecorder(false);
    if (blob) editorAct.setAudioBlob(blob);

    // 诊断日志：一眼看清楚"停止"这一刻到底拿到了什么。
    // 如果用户反馈"结束了但没卡片"，打开 Console 搜 [classroom-stop] 就能定位断点。
    // eslint-disable-next-line no-console
    console.info('[classroom-stop] fire', {
      hasBlob: !!blob,
      blobSize: blob?.size ?? 0,
      metaSessionId: meta?.sessionId || null,
      depsSessionId: sessionId || null,
      liveSegments: liveSegmentsRef.current.length,
      editorSegments: segmentsRef.current.length,
    });

    // liveSegmentsRef 在 handleRecordingStart 中已被无条件清除，
    // 此处的值仅包含本次录音期间 streaming ASR 产生的段落。
    const currentSegments = liveSegmentsRef.current.length > 0
      ? liveSegmentsRef.current
      : segmentsRef.current;

    const hasLiveData = liveSegmentsRef.current.length > 0;
    const finalSegments = hasLiveData ? currentSegments : [];
    // realtime 只服务课中反馈。完整原声定稿尚未回来时，不把草稿发布为
    // 课后证据、课程标题或应用输入，避免用户先看到低质结果再被覆盖。
    const publishableSegments = meta?.finalPassPending ? [] : finalSegments;

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

    // M8-A3: 课结束立刻聚合热词，让下一节课的 ASR context 立即拿到增量。
    // 之前只在 pagehide / visibilitychange 触发，意味着用户录完不关页面就没更新——
    // 课堂场景下这是常态。现在每次正常停课都跑一次，服务端幂等、失败静默，对 UI 零阻塞。
    // 条件：登录态 + 本次真有转录内容（避免空录音也发 API）
    if (isAuthenticated && accessToken && finalSegments.length >= 3) {
      fetch('/api/asr/corrections/aggregate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ scope: 'user', windowDays: 30 }),
        keepalive: true,
      }).catch(() => {
        // silent — 不影响课堂数据持久化路径
      });
    }

    // Persist audio and transcript to IndexedDB history.
    if (blob) {
      const currentUserId = user?.id || ANONYMOUS_USER_ID;
      const liveMediaUrl = URL.createObjectURL(blob);
      previewObjectUrlsRef.current.push(liveMediaUrl);

      // Save audio blob first.
      // 场景注记（2026-04-20）：
      // 用户可能在"开着系统内录 + 看 B 站视频"的场景下录音——这时同一个
      // sessionId 在 audioSessions 表里往往已经被视频导入先写了一行
      // `sourceType='video-link'` + `videoUrl`。saveAudioSession 的 upsert
      // 不会动没传的字段，但**这次是录音**，必须显式把 sourceType 改成
      // 'recording'，否则下游（比如 isStoredVideoSession）会误认为这是
      // 一条纯视频记录，点开就跳 B 站 iframe，而不是放用户刚录的那段音。
      // videoUrl 保留不动——它是这节课的视频原件，是有意保留的。
      // mediaUrl 同步写上，方便无 blob 环境（如历史修复后）也能回放。
      saveAudioSession(blob, effectiveSessionId, currentUserId, {
        subject: UIConfig.defaultSubject,
        // 注意：不传 topic——如果视频导入已经写过真实标题（如"一口气搞懂
        // 强化学习"），别让默认占位"课堂录音"把它盖掉。saveAudioSession
        // 自己会兜底（没有旧 topic 时新建）。
        duration,
        sourceType: 'recording',
        mediaUrl: liveMediaUrl,
        transcriptionStatus: meta?.finalPassPending
          ? 'pending'
          : publishableSegments.length > 0
            ? 'completed'
            : undefined,
      }).catch(err => console.error('Failed to save audio session to history:', err));

      if (publishableSegments.length > 0) {
        addTranscripts(effectiveSessionId, currentUserId, publishableSegments.map((seg) => ({
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
          preview: buildSourcePreviewText(publishableSegments, 180),
          mediaUrl: liveMediaUrl,
          segmentCount: publishableSegments.length,
          addedAt: new Date().toISOString(),
          origin: 'user' as const,
          status: (publishableSegments.length > 0 ? 'ready' : 'transcribing') as SourceIngestItem['status'],
          statusText: publishableSegments.length > 0 ? '' : '转写稍后回来',
          sessionId: effectiveSessionId,
          durationMs: duration,
          reviewable: publishableSegments.length > 0,
        },
      ]);
      if (publishableSegments.length > 0) {
        void persistCaptureToWorkspace({
          sourceType: 'live-audio',
          sourceKey: `live:${audioCaptureId}`,
          role: 'primary',
          contentType: 'audio',
          title: recordingTitle,
          previewText: buildSourcePreviewText(publishableSegments, 180),
          normalizedText: buildSupportReferenceSnippet(publishableSegments, 2800),
          tutorContext: buildSupportReferenceSnippet(publishableSegments, 2800),
          mediaUrl: liveMediaUrl,
          occurredAt: new Date().toISOString(),
          metadata: {
            from: 'live-recording',
            sessionId: effectiveSessionId,
            duration,
            durationSec: Math.round(duration / 1000),
            segmentCount: publishableSegments.length,
            // 档位1（跨设备带走数据）：把完整转录段同步到服务端 capture metadata。
            // 之前只存 segmentCount，换设备登录拿不到转录文字——课堂 tab 看到卡片却点不出内容。
            // 现在塞 transcriptSegments（与视频导入/pending-audio 路径一致），登录回填即可重建。
            // 上限 800 段：新版按句切分后单段更大（一句一段），800 段 ≈ 2-3 小时课，足够覆盖。
            transcriptSegments: publishableSegments.slice(0, 800).map((s) => ({
              id: s.id,
              text: s.text,
              startMs: s.startMs,
              endMs: s.endMs,
              speakerId: s.speakerId,
              confidence: s.confidence,
              isFinal: s.isFinal,
            })),
          },
        }).then((captureId) => {
          // 课中「截取这一页」的关键帧：capture 就位后静默上传（失败本地仍在，retry 兜底）
          if (captureId && isAuthenticated && accessToken) {
            void uploadRecordingKeyframes({
              sessionId: effectiveSessionId,
              captureId,
              authToken: accessToken,
            }).catch(() => undefined);
          }
        });
      }

      // 档位2（跨设备带走音频）：后台把 blob 上传到服务端持久化，拿到真实 URL，
      // 再把 capture.mediaUrl 从临时 blob: URL 换成真实 URL → 任何设备登录都能播放，
      // 后台也能看到/兜底转写。静默执行，失败不打扰（本地音频仍在）。
      if (isAuthenticated && accessToken) {
        void uploadRecordingAudio({
          blob,
          sessionId: effectiveSessionId,
          authToken: accessToken,
          onUploaded: (realMediaUrl) => {
            void persistCaptureToWorkspace({
              sourceType: 'live-audio',
              sourceKey: `live:${audioCaptureId}`,
              role: 'primary',
              contentType: 'audio',
              title: recordingTitle,
              mediaUrl: realMediaUrl,
              occurredAt: new Date().toISOString(),
              metadata: {
                from: 'live-recording',
                sessionId: effectiveSessionId,
                duration,
                audioUploaded: true,
              },
            }).then((captureId) => {
              // 关键帧上传的天然重试点：音频上传成功后 capture 必然已就位
              if (captureId) {
                void uploadRecordingKeyframes({
                  sessionId: effectiveSessionId,
                  captureId,
                  authToken: accessToken,
                }).catch(() => undefined);
              }
            });
          },
        }).catch(() => undefined);
      }

      // 说话人分离：直接把 blob 传给 /api/asr/diarize，不依赖上传链路和登录状态。
      // 静默执行，失败不打扰。
      // 如果实时多人模式（腾讯云）已经产出 speakerId，跳过课后 diarization——
      // 课后 diarization 走 DashScope Fun-ASR 非实时接口，声纹模型独立，
      // 两套引擎的 speakerId 编号无对应关系，混用会导致说话人标签错乱。
      // 完整原声定稿开启时，不能让 diarization 和 batch final pass 并发。
      // 否则较晚返回的说话人结果会拿 realtime 草稿覆盖更准确的定稿文本。
      // final pass 完成后由 useTranscriptHandlers 基于定稿 segments 再做说话人整理。
      if (
        shouldRunPostBatchDiarization(finalSegments, pendingBaseOffsetMs)
        && !meta?.finalPassPending
      ) {
        void runDiarizationForSession(
          blob,
          effectiveSessionId,
          finalSegments,
          (updatedSegments) => {
            // 刷新内存中的 transcript（如果当前 session 正在显示）
            editorAct.setSegments(updatedSegments);
          },
        ).catch(() => undefined);
      }

      if (publishableSegments.length === 0 || meta?.finalPassPending) {
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
          replaceExistingTranscript: Boolean(meta?.finalPassPending && !meta?.isContinuation),
        });
      }
    } else {
      // ── 保底落盘：没有 blob 也要把这节课写进 db.audioSessions ──
      //
      // 背景：课堂 tab 的卡片列表来自 useLiveQuery(db.audioSessions)。
      // 如果 Recorder 因为任何原因（mediaRecorder 未正确挂载、audioChunks 为空、
      // system audio 权限被取消、isRecording 态漂移等）停止时没交出 blob，
      // 那么按原逻辑 saveAudioSession 这一步会被跳过 —— 用户体感就是
      // 「我点了结束这节课，什么都没出现」。
      //
      // 这里不假装一切正常：落一条 duration 兜底、没 blob 的空壳 session，
      // 至少让课堂列表里有这节课的存在感，用户可以删除它或者之后补内容。
      // 比静默吞掉要诚实得多。
      const currentUserId = user?.id || ANONYMOUS_USER_ID;
      // eslint-disable-next-line no-console
      console.warn('[classroom-stop] no blob — writing empty session as fallback', {
        sessionId: effectiveSessionId,
        segments: finalSegments.length,
      });
      saveAudioSession(null, effectiveSessionId, currentUserId, {
        subject: UIConfig.defaultSubject,
        // 同上：不传 topic，让已有的具体标题（如视频标题）保留
        duration,
        sourceType: 'recording',
        transcriptionStatus: finalSegments.length > 0 ? 'completed' : 'failed',
        transcriptionError: finalSegments.length > 0 ? undefined : '录音结束时没有拿到可转写音频',
      }).catch((err) => console.error('[classroom-stop] fallback saveAudioSession failed:', err));
      if (publishableSegments.length > 0) {
        addTranscripts(effectiveSessionId, currentUserId, finalSegments.map((seg) => ({
          text: seg.text,
          startMs: seg.startMs,
          endMs: seg.endMs,
          confidence: seg.confidence || 1.0,
          isFinal: true,
        }))).catch((err) => console.error('[classroom-stop] fallback addTranscripts failed:', err));
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

    // v3.0 录课结束动线：有效课堂直接进入学习应用；分享跟随之后做好的成果出现。
    //
    //   - classroom tab 且已有有效转录 → 跳 review apps
    //   - 空课堂 / 仍等最终转写 → 留在课堂列表，避免展示 0 段内容的空应用矩阵
    //   - record / 其他 tab 录完 → setViewMode('record')（保持原行为）
    const uiState = useUIStore.getState();
    const currentViewMode = uiState.viewMode;
    if (currentViewMode === 'classroom') {
      if (publishableSegments.length > 0) {
        uiAct.setViewMode('review');
        uiAct.setReviewTab('apps');
        toast.success(COPY.recording.finished);
      }
    } else {
      uiAct.setViewMode('record');
    }
  }, [anchors, persistCaptureToWorkspace, sessionId, sessionMediaDurationMs, user]);

  return {
    persistCaptureToWorkspace,
    handleRecordingStart,
    handleRecordingStop,
  };
}
