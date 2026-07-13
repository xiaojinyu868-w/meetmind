'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useFeedStream } from '@/hooks/data/useFeedStream';
import { useAuth } from '@/lib/hooks/useAuth';
import { useWorkspaceId, useWorkspaceCaptures, useWorkspaceEchoes } from '@/stores/echo-store';
import { getStudentNotes } from '@/lib/db/notes';
import type { Note as DbNote } from '@/lib/db/schema';
import { FeedStream } from '@/components/FeedStream';
import { COPY } from '@/lib/ui/copy';
import type { FeedItem } from '@/types';
import type { SourceIngestItem, WorkspaceCaptureMessage, WorkspaceEchoMessage } from '@/types/page-types';
import type { EchoData } from '@/components/EchoCard';
import { Plus, RefreshCw } from 'lucide-react';

interface CrossCourseFeedPanelProps {
  /** 服务端同步完成前也要使用的本地收集上下文。 */
  localCaptures?: SourceIngestItem[];
  /** 打开某条收集内容 */
  onOpenCapture?: (captureId: string) => void;
  /** 让同学解释 */
  onAskTutor?: (text: string) => void;
  /** 回到收集输入框，补充新的个人上下文 */
  onAddContext?: () => void;
  /** 分享 Echo 沉淀 */
  onShareEcho?: (echoData: EchoData) => void;
  /** 手动触发 Echo 刷新按钮（渲染入口，从 MobileCollectionSheet 透传） */
  enableManualEchoTrigger?: boolean;
  renderManualEchoTriggerButton?: (className: string) => React.ReactNode;
  manualEchoFeedbackView?: React.ReactNode;
  manualEchoDebugView?: React.ReactNode;
}

/**
 * 跨课程信息流面板（M15，替代笔记总结）。
 *
 * 三个数据源合并成一条统一 FeedItem 流：
 *  1. LLM 跨课程探针/总结（/api/feed mode=cross-course）—— 基于 workspace 全部 captures + 画像 + 笔记
 *  2. 外部资料（由 /api/feed 服务端自动检索，对用户零配置）
 *  3. Echo 沉淀卡（workspaceEchoes）—— 并入作一种 item type
 *
 * 落位：侧栏「收集 → 今日情报」右侧抽屉。
 */
export function CrossCourseFeedPanel({
  localCaptures = [],
  onOpenCapture,
  onAskTutor,
  onAddContext,
  onShareEcho,
  enableManualEchoTrigger,
  renderManualEchoTriggerButton,
  manualEchoFeedbackView,
  manualEchoDebugView,
}: CrossCourseFeedPanelProps) {
  const workspaceId = useWorkspaceId();
  const captures = useWorkspaceCaptures();
  const echoes = useWorkspaceEchoes();
  const { user, accessToken } = useAuth();

  const effectiveCaptures = useMemo<WorkspaceCaptureMessage[]>(() => {
    const serverIds = new Set(captures.map((capture) => capture.id));
    const localOnly = localCaptures
      .filter((capture) => !serverIds.has(capture.id))
      .filter((capture) => capture.status !== 'failed')
      // 标题不是学习内容；录音转写完成前不能拿“11:48 的课”之类占位标题生成情报。
      .filter((capture) => Boolean(capture.fullText?.trim() || capture.preview?.trim()))
      .map((capture) => ({
        id: capture.id,
        sourceKey: capture.sourceKey ?? `local:${capture.id}`,
        sourceType: capture.type,
        role: capture.role,
        contentType: capture.type,
        title: capture.title,
        previewText: capture.preview ?? '',
        normalizedText: capture.fullText ?? capture.preview ?? capture.title,
        sourceUrl: capture.provenance?.originalUrl ?? null,
        mediaUrl: capture.mediaUrl ?? null,
        tutorContext: null,
        occurredAt: capture.addedAt,
        createdAt: capture.addedAt,
        metadata: capture.provenance ? { provenance: capture.provenance } : null,
      }));
    return [...captures, ...localOnly];
  }, [captures, localCaptures]);
  const effectiveWorkspaceId = workspaceId ?? `local:${user?.id ?? 'guest'}`;

  const [notes, setNotes] = useState<DbNote[]>([]);
  const notesLoadedRef = useRef(false);

  // 跨课程笔记（IndexedDB，学生维度）
  useEffect(() => {
    if (!user?.id || notesLoadedRef.current) return;
    notesLoadedRef.current = true;
    void getStudentNotes(user.id)
      .then(setNotes)
      .catch(() => undefined);
  }, [user?.id]);

  const learnerProfile = user?.learnerProfile ?? null;

  const {
    items: llmItems,
    isLoading,
    generatedAt,
    isStale,
    cacheReady,
    error,
    generate,
  } = useFeedStream({
    workspaceId: effectiveWorkspaceId,
    captures: effectiveCaptures,
    learnerProfile,
    notes: notes.map((n) => ({ text: n.text, source: n.source })),
    accessToken,
  });

  const generationKey = `${effectiveWorkspaceId}:${effectiveCaptures.map((capture) => `${capture.id}:${capture.occurredAt ?? capture.createdAt}`).join('|')}`;
  const lastAutoGenerationKeyRef = useRef('');
  useEffect(() => {
    if (!cacheReady || effectiveCaptures.length === 0 || isLoading) return;
    if (lastAutoGenerationKeyRef.current === generationKey) return;
    lastAutoGenerationKeyRef.current = generationKey;
    if (llmItems.length === 0 || isStale) void generate();
  }, [cacheReady, effectiveCaptures.length, isLoading, generationKey, llmItems.length, isStale, generate]);

  const echoItems: FeedItem[] = echoes.slice(0, 2).map((echo) => ({
    type: 'echo',
    title: echo.title,
    body: echo.body,
    takeaway: echo.takeaway,
    echoHighlights: echo.highlights,
    echoId: echo.id,
  }));

  const handleAction = (item: FeedItem) => {
    if (item.actionType === 'open-capture' && item.captureId) {
      onOpenCapture?.(item.captureId);
    } else if (item.actionType === 'ask-tutor') {
      onAskTutor?.(item.title);
    } else if ((item.actionType === 'open-external' || item.actionType === 'open-bilibili') && item.contentUrl) {
      window.open(item.contentUrl, '_blank', 'noopener,noreferrer');
    }
  };

  // FeedStream 的 onShareEcho(echoId) → 查 echoes → 转 EchoData → MobileCollectionSheet 的 onShareEcho
  const handleShareEcho = useCallback((echoId: string) => {
    const echo = echoes.find((e) => e.id === echoId);
    if (echo && onShareEcho) {
      onShareEcho(echoMessageToEchoData(echo));
    }
  }, [echoes, onShareEcho]);

  const showEmptyFeed = !isLoading && !error && llmItems.length === 0 && echoItems.length === 0;
  const canGenerate = effectiveCaptures.length > 0;

  return (
    <div className="flex h-full flex-col">
      {canGenerate ? (
        <div className="mb-4 flex items-center justify-between gap-3 border-b border-divider/70 pb-3">
          <div className="min-w-0">
            <p className="text-[11px] text-ink-muted">
              {COPY.feed.contextBasis(
                effectiveCaptures.length,
                learnerProfile?.goals?.filter((goal) => !goal.status || goal.status === 'active').length ?? 0,
              )}
            </p>
            <p className="mt-0.5 text-[10px] text-ink-muted/70">
              {isLoading ? COPY.feed.refreshing : formatFeedUpdatedAt(generatedAt)}
            </p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-1.5">
            {onAddContext ? (
              <button
                type="button"
                onClick={onAddContext}
                className="inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-medium text-ink-muted transition hover:bg-paper hover:text-ink-secondary"
              >
                <Plus size={12} />
                {COPY.feed.addContext}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void generate()}
              disabled={isLoading}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-divider bg-card px-3 text-[11px] font-medium text-ink-secondary transition hover:border-pine/30 hover:text-pine disabled:cursor-wait disabled:opacity-55"
            >
              <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
              {COPY.feed.refresh}
            </button>
          </div>
        </div>
      ) : null}

      {error && llmItems.length + echoItems.length > 0 ? (
        <div className="mb-3 rounded-lg bg-vermilion-mist/40 px-3 py-2 text-[11px] text-vermilion-deep">
          {COPY.feed.refreshFailedKeepingPrevious}
        </div>
      ) : null}

      {/* 统一信息流：今日整理 + 内部关联 + 服务端外部发现 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {showEmptyFeed && !canGenerate ? (
          <div className="flex min-h-full flex-col justify-center rounded-[24px] border border-divider bg-card px-8 py-12 text-left">
            <p className="max-w-[360px] text-[20px] font-semibold leading-tight tracking-[-0.02em] text-ink">
              {COPY.feed.crossCourseEmptyTitle}
            </p>
            <p className="mt-3 max-w-[380px] text-[13.5px] leading-7 text-ink-secondary">
              {COPY.feed.crossCourseEmptyBody}
            </p>
          </div>
        ) : (
          <FeedStream
            items={[...llmItems, ...echoItems]}
            isLoading={isLoading || !cacheReady}
            error={error}
            onAction={handleAction}
            onRetry={canGenerate ? generate : undefined}
            onShareEcho={handleShareEcho}
          />
        )}

        {/* Echo 手动刷新入口（保留原笔记总结的能力） */}
        {enableManualEchoTrigger && echoItems.length > 0 ? (
          <div className="mt-3">
            {renderManualEchoTriggerButton?.(
              'text-[11px] font-medium text-ink-muted transition hover:text-ink-secondary disabled:cursor-not-allowed disabled:opacity-60'
            )}
          </div>
        ) : null}
        {manualEchoFeedbackView}
        {manualEchoDebugView}
      </div>
    </div>
  );
}

function formatFeedUpdatedAt(value: string | null): string {
  if (!value) return COPY.feed.notGeneratedYet;
  const diffMinutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (diffMinutes < 1) return COPY.feed.updatedJustNow;
  if (diffMinutes < 60) return COPY.feed.updatedMinutesAgo(diffMinutes);
  return COPY.feed.updatedAt(new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
}

// 导出一个把 WorkspaceEchoMessage 转 EchoData 的 helper（供 MobileCollectionSheet 复用分享）
export function echoMessageToEchoData(echo: WorkspaceEchoMessage): EchoData {
  return {
    id: echo.id,
    kind: echo.kind,
    title: echo.title,
    body: echo.body,
    highlights: echo.highlights,
    takeaway: echo.takeaway,
    sourceCaptureIds: echo.sourceCaptureIds,
    createdAt: echo.createdAt,
    updatedAt: echo.updatedAt,
  };
}
