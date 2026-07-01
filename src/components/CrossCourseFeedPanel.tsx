'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useFeedStream } from '@/hooks/data/useFeedStream';
import { useOpenBiliClawConnection } from '@/hooks/useOpenBiliClawConnection';
import { useAuth } from '@/lib/hooks/useAuth';
import { useWorkspaceId, useWorkspaceCaptures, useWorkspaceEchoes } from '@/stores/echo-store';
import { getStudentNotes } from '@/lib/db/notes';
import type { Note as DbNote } from '@/lib/db/schema';
import {
  getRecommendations,
  type OBRecommendation,
} from '@/lib/services/openbiliclaw-client';
import { FeedStream } from '@/components/FeedStream';
import { COPY } from '@/lib/ui/copy';
import type { FeedItem } from '@/types';
import type { WorkspaceEchoMessage } from '@/types/page-types';
import type { EchoData } from '@/components/EchoCard';

interface CrossCourseFeedPanelProps {
  /** 打开某条收集内容 */
  onOpenCapture?: (captureId: string) => void;
  /** 让同学解释 */
  onAskTutor?: (text: string) => void;
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
 *  2. B站视频推荐（OpenBiliClaw）—— 基于个人 B站画像，跨课程
 *  3. Echo 沉淀卡（workspaceEchoes）—— 并入作一种 item type
 *
 * 落位：侧栏「收集 → 相关信息」右侧抽屉（替换原「笔记总结」Echo 列表）。
 */
export function CrossCourseFeedPanel({
  onOpenCapture,
  onAskTutor,
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

  const { items: llmItems, isLoading, error, generate } = useFeedStream({
    workspaceId: workspaceId ?? '',
    captures,
    learnerProfile,
    notes: notes.map((n) => ({ text: n.text, source: n.source })),
    accessToken,
  });

  const hasGeneratedRef = useRef(false);
  useEffect(() => {
    if (captures.length > 0 && workspaceId && !hasGeneratedRef.current && !isLoading) {
      hasGeneratedRef.current = true;
      void generate();
    }
  }, [captures.length, workspaceId, isLoading, generate]);

  // ── B站推荐（OpenBiliClaw） ──
  const { online: obOnline } = useOpenBiliClawConnection();
  const [obRecs, setObRecs] = useState<OBRecommendation[]>([]);
  const [obLoading, setObLoading] = useState(false);
  const [needsCookie, setNeedsCookie] = useState(false);
  const [obSkipped, setObSkipped] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try { return localStorage.getItem('mm-ob-skipped') === '1'; } catch { return false; }
  });

  const refreshObRecs = useCallback(async () => {
    if (!obOnline) return;
    setObLoading(true);
    const recs = await getRecommendations(5);
    setObRecs(recs);
    setNeedsCookie(recs.length === 0);
    setObLoading(false);
  }, [obOnline]);

  useEffect(() => {
    if (obOnline) {
      void refreshObRecs();
    } else {
      setObRecs([]);
      setNeedsCookie(false);
    }
  }, [obOnline, refreshObRecs]);

  const handleSkipOb = useCallback(() => {
    setObSkipped(true);
    try { localStorage.setItem('mm-ob-skipped', '1'); } catch { /* ignore */ }
  }, []);

  // ── 合并三个数据源为统一 FeedItem 流 ──
  const biliItems: FeedItem[] = obRecs.map((rec) => ({
    type: 'bili-recommend',
    title: rec.title,
    body: rec.expression,
    coverUrl: rec.cover_url,
    upName: rec.up_name,
    contentUrl: rec.content_url || `https://www.bilibili.com/video/${rec.bvid}`,
    topicLabel: rec.topic_label,
    bvid: rec.bvid,
    actionType: 'open-bilibili',
    actionLabel: COPY.feed.obWatchOnBilibili,
  }));

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
    } else if (item.actionType === 'open-bilibili' && item.contentUrl) {
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

  const showEmptyFeed = !isLoading && !error && llmItems.length === 0 && biliItems.length === 0 && echoItems.length === 0;
  const canGenerate = captures.length > 0 && !!workspaceId;

  return (
    <div className="flex h-full flex-col">
      {/* 顶部 OpenBiliClaw 轻引导卡（在线但还没推荐时，用户没点过「现在不用」才显示） */}
      {obOnline && needsCookie && !obLoading && !obSkipped && (
        <div className="mb-4 rounded-xl border border-divider bg-paper px-4 py-3">
          <p className="text-[13px] leading-relaxed text-ink-secondary">
            {COPY.feed.obIntroCardHint}
          </p>
          <div className="mt-2.5 flex items-center gap-3">
            <a
              href={COPY.feed.obInstallUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center rounded-lg bg-pine px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-pine-deep"
            >
              {COPY.feed.obInstallButton}
            </a>
            <button
              type="button"
              onClick={handleSkipOb}
              className="text-[11px] text-ink-muted underline-offset-2 transition-colors hover:text-ink-secondary hover:underline"
            >
              {COPY.feed.obSkipButton}
            </button>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-muted">
            {COPY.feed.obOtherBrowsersNote} ·{' '}
            <a
              href={COPY.feed.obInstallUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-pine underline-offset-2 hover:underline"
            >
              {COPY.feed.obReleasesLinkText}
            </a>
            {' · '}
            {COPY.feed.obSafariNote}
          </p>
        </div>
      )}

      {/* 统一信息流：LLM 探针 + B站推荐 + Echo 沉淀 */}
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
            items={[...llmItems, ...biliItems, ...echoItems]}
            isLoading={isLoading}
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