/**
 * useWechatCaptureImport
 *
 * 微信收集导入 — 从 page.tsx 提取（Phase 5）
 *
 * 包含：
 *   settleWechatCaptureEntry — 导入微信 capture 后重置 UI 状态并聚焦 composer
 *   wechat capture fetch useEffect — 通过 token 获取微信消息 → 写入 store
 *
 * 遵循 (deps, refs) 模式。
 */

import { useCallback, useEffect } from 'react';
import { useUIStore } from '@/stores/ui-store';
import { useSessionStore } from '@/stores/session-store';
import { useCollectionStore } from '@/stores/collection-store';
import { useEchoStore } from '@/stores/echo-store';
import { useMobileAIStore } from '@/stores/mobile-ai-store';
import { useCaptureEditorStore } from '@/stores/capture-editor-store';
import {
  compactText,
  inferWechatCaptureSourceType,
  inferWechatCaptureRole,
  inferWechatCaptureTitle,
  buildWechatCaptureSourceItem,
  resolveSourceItemSourceKey,
  getSupportReferenceDisplayTitle,
  mergeSupportReferences,
  mergeWorkspaceCaptures,
  readJsonApiResponse,
} from '@/lib/utils/page-utils';
import { toast } from 'sonner';
import type { SourceIngestItem, WechatCaptureMessage } from '@/types/page-types';

// ── Deps interface ──

interface UseWechatCaptureImportDeps {
  wechatCaptureToken: string | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  user: { id?: string } | null;
  refreshDailyEcho: () => Promise<unknown>;
  /**
   * 当微信收集到链接/文章时，调用此函数提取文章内容。
   * 由 useSourceImport 提供（importArticleLinkIntoSourceItem）。
   */
  importDocumentLink?: (
    url: string,
    options?: {
      sourceItemId?: string;
      optimisticTitle?: string;
      persistSourceKey?: string;
      persistSourceType?: string;
      persistRole?: 'primary' | 'support';
      occurredAt?: string;
    }
  ) => Promise<boolean>;
}

// ── Refs interface ──

interface UseWechatCaptureImportRefs {
  collectionComposerRef: React.MutableRefObject<HTMLTextAreaElement | null>;
  importedWechatCaptureTokensRef: React.MutableRefObject<Set<string>>;
  suppressNextCollectionPulsePreviewRef: React.MutableRefObject<boolean>;
}

// ── Hook ──

export function useWechatCaptureImport(
  deps: UseWechatCaptureImportDeps,
  refs: UseWechatCaptureImportRefs,
) {
  const {
    wechatCaptureToken,
    accessToken,
    isAuthenticated,
    user,
    refreshDailyEcho,
  } = deps;

  const {
    collectionComposerRef,
    importedWechatCaptureTokensRef,
    suppressNextCollectionPulsePreviewRef,
  } = refs;

  // ── settleWechatCaptureEntry ──
  // 导入微信 capture 后重置全部 UI 状态并聚焦 composer
  const settleWechatCaptureEntry = useCallback((nextItem: SourceIngestItem) => {
    suppressNextCollectionPulsePreviewRef.current = true;

    // UI Store writes
    const uiActions = useUIStore.getState().actions;
    uiActions.setViewMode('record');
    uiActions.setMobileSubPage(null);
    uiActions.setMobileCollectionSheet(null);
    uiActions.setShowConversationHistory(false);
    uiActions.setShowMobileRecorder(false);

    // Session Store writes
    const sessionActions = useSessionStore.getState().actions;
    sessionActions.setSelectedConfusion(null);
    sessionActions.setSelectedAnchor(null);
    sessionActions.setSelectedHistoryConversation(null);

    // Capture Editor Store writes
    useCaptureEditorStore.getState().actions.setConfusionChatAnchor(null);

    // Collection Store writes
    const collectionActions = useCollectionStore.getState().actions;
    collectionActions.setActiveCollectionMessageMenuId(null);
    collectionActions.setConfirmCollectionDeleteId(null);
    collectionActions.setIsCollectionContextSelectionMode(false);
    collectionActions.setConfirmSelectedCollectionDelete(false);
    collectionActions.setSelectedCollectionContextIds([]);
    collectionActions.setSelectedCollectionPrimaryId(null);
    collectionActions.setQuotedCollectionContextIds([nextItem.id]);
    collectionActions.setQuotedCollectionPrimaryId(nextItem.id);
    collectionActions.setCaptureDrivenPulse(null);
    collectionActions.setShowCollectionPulsePreview(false);

    // Mobile AI Store writes
    const mobileAIActions = useMobileAIStore.getState().actions;
    mobileAIActions.setMobileAIQuestion('');
    mobileAIActions.setMobileAIDisplayQuestion('');
    mobileAIActions.setMobileAILaunchImages([]);
    mobileAIActions.setMobileAILaunchSupportContextText('');
    mobileAIActions.setMobileAIConsumedQuestionNonce(null);
    mobileAIActions.setMobileAIPreferSelectedContext(false);
    mobileAIActions.setMobileAILaunchTarget(null);

    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        const textarea = collectionComposerRef.current;
        if (!textarea) return;
        textarea.focus();
        const length = textarea.value.length;
        textarea.setSelectionRange(length, length);
        textarea.scrollIntoView({ block: 'nearest' });
      });
    }
  }, []);

  // ── Wechat capture fetch effect ──
  useEffect(() => {
    if (!wechatCaptureToken) return;
    if (importedWechatCaptureTokensRef.current.has(wechatCaptureToken)) return;

    const sessionStorageKey = `wechat-capture:${wechatCaptureToken}`;
    if (typeof window !== 'undefined' && window.sessionStorage.getItem(sessionStorageKey) === '1') {
      importedWechatCaptureTokensRef.current.add(wechatCaptureToken);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const response = await fetch(`/api/wechat/capture/${encodeURIComponent(wechatCaptureToken)}`);
        const payload = await readJsonApiResponse<{ success: boolean; message?: WechatCaptureMessage; error?: string }>(
          response,
          '读取微信收集失败'
        );

        if (!response.ok || !payload.success || !payload.message) {
          throw new Error(payload.error || '读取微信收集失败');
        }

        if (cancelled) return;

        const message = payload.message;
        const sourceItemId = `wechat-${message.linkToken}`;
        const sourceType = inferWechatCaptureSourceType(message);
        const role = inferWechatCaptureRole(message);
        const title = inferWechatCaptureTitle(message);
        const preview = compactText(
          message.normalizedText?.trim() || message.previewText?.trim() || title,
          180
        );
        const addedAt = message.messageAt || new Date().toISOString();

        useEchoStore.getState().actions.setWorkspaceCaptures((prev) =>
          mergeWorkspaceCaptures(prev, [
            {
              id: `wechat-capture-${message.linkToken}`,
              sourceKey: `wechat:${message.linkToken}`,
              sourceType: 'wechat',
              role,
              contentType: sourceType === 'document' ? 'link' : sourceType,
              title,
              previewText: preview,
              normalizedText: message.normalizedText || null,
              sourceUrl: message.sourceUrl || null,
              mediaUrl: message.mediaUrl || null,
              tutorContext: message.tutorContext || null,
              occurredAt: addedAt,
              createdAt: addedAt,
              metadata: null,
            },
          ])
        );

        const nextItem = buildWechatCaptureSourceItem(message);
        const textReady = (message.normalizedText?.length || 0) > 200;
        const importingStatus = sourceType === 'document' && !textReady
          ? { status: 'parsing' as const, statusText: '正在提取内容…' }
          : undefined;

        useCollectionStore.getState().actions.setSourceItems((prev) => {
          const index = prev.findIndex(
            (item) => item.id === nextItem.id || resolveSourceItemSourceKey(item) === nextItem.sourceKey
          );

          if (index < 0) {
            return [...prev, importingStatus ? { ...nextItem, ...importingStatus } : nextItem];
          }

          const next = [...prev];
          next[index] = {
            ...prev[index],
            ...nextItem,
            ...(importingStatus || {}),
          };
          return next;
        });

        const tutorSnippet = (message.tutorContext || message.normalizedText || '').trim();
        if (tutorSnippet) {
          useCollectionStore.getState().actions.setSupportReferences((prev) => mergeSupportReferences(prev, [{
            id: sourceItemId,
            title: getSupportReferenceDisplayTitle(nextItem),
            snippet: compactText(tutorSnippet, 2800),
          }]));
        }

        // 微信服务端 /api/wechat/mp 已异步触发 enrichArticleLinkContent 提取文章，
        // 前端只在内容明显未就绪（normalizedText 过短）时才兜底触发一次，避免两边并发浪费 API。
        if (sourceType === 'document' && message.sourceUrl && deps.importDocumentLink && !textReady) {
          void deps.importDocumentLink(message.sourceUrl, {
            sourceItemId: nextItem.id,
            optimisticTitle: title,
            persistRole: role,
            occurredAt: addedAt,
          });
        }

        settleWechatCaptureEntry(nextItem);
        toast.success(message.echoTitle?.trim() || '这条微信内容已经接进当前收集');

        if (isAuthenticated && user?.id && accessToken) {
          void refreshDailyEcho();
        }

        importedWechatCaptureTokensRef.current.add(wechatCaptureToken);
        useCollectionStore.getState().actions.setSourceImportError('');
        if (typeof window !== 'undefined') {
          window.sessionStorage.setItem(sessionStorageKey, '1');
          const url = new URL(window.location.href);
          url.searchParams.delete('wechat_capture');
          window.history.replaceState({}, '', url.toString());
        }

      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        useCollectionStore.getState().actions.setSourceImportError(message || '这条微信收集还没接进来，请稍后再试。');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [accessToken, isAuthenticated, refreshDailyEcho, settleWechatCaptureEntry, user?.id, wechatCaptureToken]);
}
