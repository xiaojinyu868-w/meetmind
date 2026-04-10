'use client';

import { useCallback } from 'react';
import { useUIStore } from '@/stores/ui-store';
import { useSessionStore } from '@/stores/session-store';
import { useCollectionStore } from '@/stores/collection-store';
import { useEchoStore } from '@/stores/echo-store';
import { useMobileAIStore } from '@/stores/mobile-ai-store';
import { useCaptureEditorStore } from '@/stores/capture-editor-store';
import { buildSelectedCollectionContextText, resolveCollectionContextPrimaryId, getCollectionContextDisplayTitle, getCollectionContextTypeLabel } from '@/lib/capture/collection-context';
import { parseVideoLink } from '@/lib/utils/video-link';
import { compactText, compactMultilineText, resolveSourceItemSourceKey } from '@/lib/utils/page-utils';
import { db } from '@/lib/db';
import { toast } from 'sonner';
import type { TranscriptSegment } from '@/types';
import type {
  SourceIngestItem,
  TutorLaunchImageAsset,
  WorkspaceCaptureMessage,
} from '@/types/page-types';

// ── Types ──────────────────────────────────────────────────────────

export interface UseTutorLauncherDeps {
  isMobile: boolean;
  selectedCollectionContextItems: SourceIngestItem[];
  clearCollectionContextSelection: () => void;
  archiveLocalCollectionItem: (item: SourceIngestItem) => void;
  deleteLocalCollectionItem: (item: SourceIngestItem) => void;
  updateWorkspaceCaptureStatus: (params: {
    action: 'archive' | 'delete' | 'restore';
    captureId?: string | null;
    sourceKey?: string | null;
    itemId?: string | null;
    silent?: boolean;
  }) => Promise<boolean>;
  updateSourceItem: (id: string, patch: Partial<SourceIngestItem>) => void;
}

export interface UseTutorLauncherRefs {
  segmentsRef: React.MutableRefObject<TranscriptSegment[]>;
  sessionIdRef: React.MutableRefObject<string>;
  liveSegmentsRef: React.MutableRefObject<TranscriptSegment[]>;
  pendingCaptureStatusBySourceKeyRef: React.MutableRefObject<Map<string, 'archive' | 'delete'>>;
}

// ── Hook ───────────────────────────────────────────────────────────

export function useTutorLauncher(
  deps: UseTutorLauncherDeps,
  refs: UseTutorLauncherRefs,
) {
  const {
    isMobile,
    selectedCollectionContextItems,
    clearCollectionContextSelection,
    archiveLocalCollectionItem,
    deleteLocalCollectionItem,
    updateWorkspaceCaptureStatus,
    updateSourceItem,
  } = deps;

  const {
    segmentsRef,
    sessionIdRef,
    liveSegmentsRef,
    pendingCaptureStatusBySourceKeyRef,
  } = refs;

  // ── blobToDataUrl ────────────────────────────────────────────────

  const blobToDataUrl = useCallback((blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result);
          return;
        }
        reject(new Error('图片读取失败'));
      };
      reader.onerror = () => reject(reader.error || new Error('图片读取失败'));
      reader.readAsDataURL(blob);
    });
  }, []);

  // ── buildTutorLaunchImages ───────────────────────────────────────

  const buildTutorLaunchImages = useCallback(async (items: SourceIngestItem[] = []): Promise<TutorLaunchImageAsset[]> => {
    const imageItems = items.filter((item) => item.type === 'image').slice(0, 4);
    if (imageItems.length === 0) return [];

    const resolvedImages: Array<TutorLaunchImageAsset | null> = await Promise.all(
      imageItems.map(async (item) => {
        const previewUrl = item.previewUrl || item.mediaUrl || item.attachmentUrl || '';
        const candidates = Array.from(
          new Set(
            [item.previewUrl, item.mediaUrl, item.attachmentUrl].filter(
              (value): value is string => Boolean(value && value.trim())
            )
          )
        );

        for (const candidate of candidates) {
          const normalized = candidate.trim();
          if (!normalized) continue;

          if (normalized.startsWith('data:image/')) {
            return {
              id: item.id,
              name: item.title || '图片',
              url: normalized,
              previewUrl: item.previewUrl || normalized,
            } satisfies TutorLaunchImageAsset;
          }

          try {
            const response = await fetch(normalized);
            if (!response.ok) continue;
            const blob = await response.blob();
            if (!blob.type.startsWith('image/')) continue;
            const dataUrl = await blobToDataUrl(blob);
            return {
              id: item.id,
              name: item.title || '图片',
              url: dataUrl,
              previewUrl: previewUrl || dataUrl,
            } satisfies TutorLaunchImageAsset;
          } catch {
            if (/^https?:\/\//i.test(normalized)) {
              return {
                id: item.id,
                name: item.title || '图片',
                url: normalized,
                previewUrl: previewUrl || normalized,
              } satisfies TutorLaunchImageAsset;
            }
          }
        }

        return null;
      })
    );

    return resolvedImages.filter((item): item is TutorLaunchImageAsset => Boolean(item));
  }, [blobToDataUrl]);

  // ── buildTutorPromptForCollectionItem ────────────────────────────

  const buildTutorPromptForCollectionItem = useCallback((item: SourceIngestItem) => {
    const label = getCollectionContextTypeLabel(item.type);
    const focus = getCollectionContextDisplayTitle(item, 48);
    const snippet = compactText((item.fullText || item.preview || item.title || '').trim(), 120);
    if (item.type === 'image') {
      return compactMultilineText(
        `请先看我刚选的这张${label}，直接告诉我图里最值得抓住的关键点；如果信息还不完整，也先说现在能判断什么。\n重点：${focus}\n补充识别：${snippet}`,
        260
      );
    }
    if (item.type === 'text') {
      return compactMultilineText(
        `顺着这条${label}继续帮我讲清楚，先直接说这段内容最核心在讲什么；如果只看这一条还不完整，也先告诉我现在能确定什么。\n当前内容：${focus}\n摘录：${snippet}`,
        280
      );
    }

    return compactMultilineText(
      `顺着这条${label}继续带我理解，先围绕它现在最关键的一点讲清楚；如果信息还不完整，也先告诉我能确定什么，再给我一个最值得继续追问的问题。\n当前内容：${focus}\n摘录：${snippet}`,
      280
    );
  }, []);

  // ── buildTutorPromptForCollectionGroup ───────────────────────────

  const buildTutorPromptForCollectionGroup = useCallback((primaryItem: SourceIngestItem) => {
    const label = getCollectionContextTypeLabel(primaryItem.type);
    const focus = getCollectionContextDisplayTitle(primaryItem, 48);
    const snippet = compactText((primaryItem.fullText || primaryItem.preview || primaryItem.title || '').trim(), 140);
    if (primaryItem.type === 'image') {
      return compactMultilineText(
        `请结合我刚圈出的这组内容，先看这张${label}里最值得抓住的关键点；如果信息还不完整，也先说现在最可靠的判断。\n重点：${focus}\n补充识别：${snippet}`,
        260
      );
    }
    return compactMultilineText(
      `请围绕我刚圈出的这组内容继续讲，先抓住这条${label}和其他内容最关键的关系；如果信息还不完整，也先说现在最值得抓住的一点。\n重点：${focus}\n参考：${snippet}`,
      280
    );
  }, []);

  // ── openTutorFromCollection ──────────────────────────────────────
  // NOTE: This callback uses store.getState().actions for setters because it
  // is a pure "writer" — it never reads reactive state, only dispatches updates.

  const openTutorFromCollection = useCallback((
    initialPrompt?: string,
    options?: {
      preferSelectedContext?: boolean;
      displayText?: string;
      launchImages?: TutorLaunchImageAsset[];
      supportContextText?: string;
    }
  ) => {
    const uiAct = useUIStore.getState().actions;
    const sessAct = useSessionStore.getState().actions;
    const colAct = useCollectionStore.getState().actions;
    const aiAct = useMobileAIStore.getState().actions;
    const capAct = useCaptureEditorStore.getState().actions;
    const currentVideoSource = useCaptureEditorStore.getState().videoSource;

    uiAct.setMobileCollectionSheet(null);
    colAct.setShowCollectionPulsePreview(false);
    uiAct.setShowConversationHistory(false);
    sessAct.setSelectedHistoryConversation(null);
    uiAct.setShowMobileRecorder(false);
    sessAct.setSelectedConfusion(null);
    capAct.setConfusionChatAnchor(null);
    sessAct.setSelectedAnchor(null);
    aiAct.setMobileAIQuestion(initialPrompt || '');
    aiAct.setMobileAIDisplayQuestion(options?.displayText || '');
    aiAct.setMobileAILaunchImages(options?.launchImages || []);
    aiAct.setMobileAILaunchSupportContextText(options?.supportContextText || '');
    aiAct.setMobileAIConsumedQuestionNonce(null);
    aiAct.setMobileAIPreferSelectedContext(Boolean(options?.preferSelectedContext));
    aiAct.setMobileAIQuestionNonce((prev) => prev + 1);
    aiAct.setMobileAILaunchTarget(isMobile ? 'mobile-ai-chat' : currentVideoSource ? 'video-chat' : 'review-panel');
    uiAct.setViewMode('review');
    if (currentVideoSource) {
      uiAct.setVideoWorkspaceTab('chat');
    }
    if (isMobile) {
      uiAct.setMobileSubPage('ai-chat');
    }
  }, [isMobile]);

  // ── openTutorWithSelectedCollectionContext ────────────────────────

  const openTutorWithSelectedCollectionContext = useCallback(async () => {
    if (selectedCollectionContextItems.length === 0) return;

    const currentSelectedPrimaryId = useCollectionStore.getState().selectedCollectionPrimaryId;
    const primaryId = resolveCollectionContextPrimaryId(selectedCollectionContextItems, currentSelectedPrimaryId);
    const primaryItem = selectedCollectionContextItems.find((item) => item.id === primaryId) || selectedCollectionContextItems[0];
    const prompt = primaryItem ? buildTutorPromptForCollectionGroup(primaryItem) : undefined;
    const supportContextText = buildSelectedCollectionContextText({
      items: selectedCollectionContextItems,
      primaryId,
    });
    const launchImages = await buildTutorLaunchImages(selectedCollectionContextItems);
    clearCollectionContextSelection();
    openTutorFromCollection(prompt, {
      preferSelectedContext: true,
      launchImages,
      supportContextText,
    });
  }, [
    buildTutorLaunchImages,
    buildTutorPromptForCollectionGroup,
    clearCollectionContextSelection,
    openTutorFromCollection,
    selectedCollectionContextItems,
  ]);

  // ── applyBatchActionToSelectedCollectionContext ───────────────────

  const applyBatchActionToSelectedCollectionContext = useCallback(async (action: 'archive' | 'delete') => {
    if (selectedCollectionContextItems.length === 0) return;
    const currentConfirm = useCollectionStore.getState().confirmSelectedCollectionDelete;
    if (action === 'delete' && !currentConfirm) {
      useCollectionStore.getState().actions.setConfirmSelectedCollectionDelete(true);
      return;
    }

    const items = [...selectedCollectionContextItems];
    clearCollectionContextSelection();

    const captures: WorkspaceCaptureMessage[] = useEchoStore.getState().workspaceCaptures;

    let successCount = 0;
    for (const item of items) {
      const sourceKey = resolveSourceItemSourceKey(item);
      const capture =
        captures.find((entry) => entry.sourceKey === sourceKey) ||
        (item.id.startsWith('workspace-')
          ? captures.find((entry) => entry.id === item.id.slice('workspace-'.length))
          : null);

      if (!capture && !item.id.startsWith('workspace-')) {
        if (sourceKey) {
          pendingCaptureStatusBySourceKeyRef.current.set(sourceKey, action);
        }
        if (action === 'archive') {
          archiveLocalCollectionItem(item);
        } else {
          deleteLocalCollectionItem(item);
        }
        successCount += 1;
        continue;
      }

      const ok = await updateWorkspaceCaptureStatus({
        action,
        captureId: capture?.id,
        sourceKey: sourceKey || capture?.sourceKey || null,
        itemId: item.id,
        silent: true,
      });
      if (ok) {
        successCount += 1;
      }
    }

    if (successCount > 0) {
      toast.success(
        action === 'delete'
          ? `已彻底删除 ${successCount} 条收集`
          : `已先收起 ${successCount} 条收集`
      );
    } else {
      toast.error(action === 'delete' ? '批量删除失败，请稍后再试' : '批量收起失败，请稍后再试');
    }
  }, [
    archiveLocalCollectionItem,
    clearCollectionContextSelection,
    deleteLocalCollectionItem,
    pendingCaptureStatusBySourceKeyRef,
    selectedCollectionContextItems,
    updateWorkspaceCaptureStatus,
  ]);

  // ── openTutorFromCollectionItem ──────────────────────────────────

  const openTutorFromCollectionItem = useCallback(async (item: SourceIngestItem) => {
    const colAct = useCollectionStore.getState().actions;
    const capAct = useCaptureEditorStore.getState().actions;
    const sessAct = useSessionStore.getState().actions;

    colAct.setSelectedCollectionContextIds([item.id]);
    colAct.setSelectedCollectionPrimaryId(item.id);
    colAct.setIsCollectionContextSelectionMode(false);
    colAct.setActiveCollectionMessageMenuId(null);

    let didRestoreSegments = false;

    // ── 视频 + 服务端转录 → 恢复 segments + videoSource ──
    if (item.type === 'video' && item.serverTranscriptSegments && item.serverTranscriptSegments.length > 0) {
      const sid = item.sessionId || `video-server-${item.id}-${Date.now()}`;
      const segs: TranscriptSegment[] = item.serverTranscriptSegments.map((s, i) => ({
        id: s.id || `server-${s.startMs ?? 0}-${i}`,
        text: s.text || '',
        startMs: s.startMs ?? 0,
        endMs: s.endMs ?? (s.startMs ?? 0) + 3000,
        confidence: 1,
        isFinal: true,
      }));
      capAct.setSegments(segs);
      segmentsRef.current = segs;
      liveSegmentsRef.current = segs;
      sessAct.setSessionId(sid);
      sessionIdRef.current = sid;
      const det = item.attachmentUrl ? parseVideoLink(item.attachmentUrl) : null;
      capAct.setVideoSource({
        provider: det?.provider || item.videoProvider || 'generic',
        providerLabel: det?.providerLabel || 'Web Video',
        originalUrl: item.attachmentUrl || item.mediaUrl || '',
        embedUrl: item.embedUrl || det?.embedUrl,
        playableUrl: item.mediaUrl || item.attachmentUrl || undefined,
        thumbnailUrl: item.previewUrl,
        title: item.title,
        durationSec: segs.length > 0 ? (segs[segs.length - 1].endMs || 0) / 1000 : undefined,
      });
      sessAct.setDataSource('video');
      if (!item.sessionId) updateSourceItem(item.id, { sessionId: sid });
      didRestoreSegments = true;
    }

    // ── 音频/视频 + sessionId → 从 IndexedDB 恢复 segments ──
    if (!didRestoreSegments && item.sessionId && (item.type === 'audio' || item.type === 'video')) {
      try {
        const txs = await db.transcripts.where('sessionId').equals(item.sessionId).toArray();
        if (txs.length > 0) {
          const sorted = txs.sort((a, b) => a.startMs - b.startMs);
          const segs: TranscriptSegment[] = sorted.map((t, i) => ({
            id: `restored-${t.startMs}-${i}`,
            text: t.text,
            startMs: t.startMs,
            endMs: t.endMs,
            confidence: t.confidence,
            isFinal: t.isFinal,
          }));
          capAct.setSegments(segs);
          segmentsRef.current = segs;
          liveSegmentsRef.current = segs;
          sessAct.setSessionId(item.sessionId);
          sessionIdRef.current = item.sessionId;
          if (item.type === 'audio' && item.mediaUrl) {
            capAct.setAudioBlob(null);
            capAct.setAudioUrl(item.mediaUrl);
          }
          if (item.durationMs) sessAct.setSessionMediaDurationMs(item.durationMs);
          didRestoreSegments = true;
        }
      } catch (e) {
        console.error('[openTutorFromCollectionItem] IndexedDB restore failed:', e);
      }
    }

    const launchImages = await buildTutorLaunchImages([item]);
    const supportContextText = buildSelectedCollectionContextText({
      items: [item],
      primaryId: item.id,
    });
    openTutorFromCollection(buildTutorPromptForCollectionItem(item), {
      preferSelectedContext: !didRestoreSegments,
      launchImages,
      supportContextText,
    });
  }, [buildTutorLaunchImages, buildTutorPromptForCollectionItem, liveSegmentsRef, openTutorFromCollection, segmentsRef, sessionIdRef, updateSourceItem]);

  return {
    blobToDataUrl,
    buildTutorLaunchImages,
    buildTutorPromptForCollectionItem,
    buildTutorPromptForCollectionGroup,
    openTutorFromCollection,
    openTutorWithSelectedCollectionContext,
    applyBatchActionToSelectedCollectionContext,
    openTutorFromCollectionItem,
  };
}
