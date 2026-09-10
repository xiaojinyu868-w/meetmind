'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AppExecutionResult } from '@/lib/ai-native/types';
import type { TranscriptSegment } from '@/types';
import { EvidenceChip } from '@/components/apps/evidence/EvidenceChip';
import { APPS_COPY } from '@/lib/ui/copy-apps';
import { AppWindowPlaceholder } from './AppWindowPlaceholder';
import {
  treeToMarkdown,
  markdownToTree,
  type MindmapNode,
} from '@/lib/ai-native/plugins/mindmap-tree';
import { PALETTE, getBranchHue } from './mindmap-layout';
import { MindmapCanvas } from './MindmapCanvas';

/* ================================================================== */
/*  Types                                                              */
/* ================================================================== */

interface MindmapWindowProps {
  result: AppExecutionResult | null;
  transcript: TranscriptSegment[];
  onSeek?: (startMs: number) => void;
  /** 窄屏可以先给可读大纲；全屏始终由用户主动触发。 */
  defaultViewMode?: ViewMode;
  /** 宿主已是全屏舞台：不再提供窗口自己的第二层「全屏」（否则叠两层，返回被盖住） */
  hostFullscreen?: boolean;
}

interface MindmapPayload {
  root?: string;
  markdown?: string;
  children?: MindmapNode[];
  branches?: Array<{ title?: string; points?: string[]; startMs?: number }>;
}

type ViewMode = 'mindmap' | 'outline';

/* ================================================================== */
/*  数据标准化                                                          */
/* ================================================================== */

function normalizePayload(result: AppExecutionResult | null): {
  root: string;
  children: MindmapNode[];
  markdown: string;
} {
  if (!result) return { root: '课堂知识结构', children: [], markdown: '' };
  const payload = (result.render?.payload || {}) as MindmapPayload;

  if (payload.markdown) {
    const parsed = markdownToTree(payload.markdown);
    return { root: parsed.root, children: parsed.children, markdown: payload.markdown };
  }
  if (Array.isArray(payload.children) && payload.children.length > 0) {
    const root = payload.root?.trim() || result.render?.title || '课堂知识结构';
    const md = treeToMarkdown(root, payload.children);
    return { root, children: payload.children, markdown: md };
  }
  if (Array.isArray(payload.branches) && payload.branches.length > 0) {
    const rootLabel = payload.root?.trim() || result.render?.title || '课堂知识结构';
    const children: MindmapNode[] = payload.branches
      .filter((b) => b.title)
      .map((b) => ({
        title: b.title!,
        startMs: b.startMs,
        children: Array.isArray(b.points) ? b.points.filter(Boolean).map((p) => ({ title: p })) : [],
      }));
    const md = treeToMarkdown(rootLabel, children);
    return { root: rootLabel, children, markdown: md };
  }
  const mindmapCard = result.cards.find((c) => c.type === 'mindmap');
  if (mindmapCard?.body) {
    const parsed = markdownToTree(mindmapCard.body);
    return { root: parsed.root, children: parsed.children, markdown: mindmapCard.body };
  }
  return { root: '课堂知识结构', children: [], markdown: '' };
}

/* ================================================================== */
/*  大纲模式 — 浅色递归树                                               */
/* ================================================================== */

function OutlineNode({
  node,
  depth,
  transcript,
  cards,
  onSeek,
}: {
  node: MindmapNode;
  depth: number;
  transcript: TranscriptSegment[];
  cards: AppExecutionResult['cards'];
  onSeek?: (startMs: number) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = Array.isArray(node.children) && node.children.length > 0;
  const hue = getBranchHue(depth === 0 ? 0 : (depth - 1));

  const matchCard = cards.find((c) => c.title === node.title && c.citations?.[0]);
  const citation = matchCard?.citations?.[0];

  const fontSizes = ['15px', '14px', '13px', '13px', '13px'];
  const fontWeights = ['650', '550', '500', '400', '400'];
  const fontSize = fontSizes[Math.min(depth, fontSizes.length - 1)];
  const fontWeight = fontWeights[Math.min(depth, fontWeights.length - 1)];

  return (
    <div style={{ marginLeft: depth > 0 ? 20 : 0 }}>
      <div
        className="group flex items-start gap-2 rounded-lg px-2 py-1.5 transition-colors duration-150"
        style={{ cursor: hasChildren ? 'pointer' : 'default' }}
        onClick={hasChildren ? () => setExpanded((p) => !p) : undefined}
        onKeyDown={hasChildren ? (e) => { if (e.key === 'Enter' || e.key === ' ') setExpanded((p) => !p); } : undefined}
        role={hasChildren ? 'button' : undefined}
        tabIndex={hasChildren ? 0 : undefined}
      >
        {hasChildren ? (
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center transition-all duration-200" style={{ color: hue.line }}>
            <svg className="h-3 w-3 transition-transform duration-200" style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </span>
        ) : (
          <span className="mt-2 flex h-2 w-2 shrink-0"><span className="block h-1.5 w-1.5 rounded-full" style={{ background: hue.line, opacity: 0.6 }} /></span>
        )}
        <span className="flex-1 leading-relaxed" style={{ color: depth === 0 ? PALETTE.textPrimary : PALETTE.textSecondary, fontSize, fontWeight }}>{node.title}</span>
        {citation ? (
          <span className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
            <EvidenceChip citation={citation} transcript={transcript} onSeek={onSeek} />
          </span>
        ) : null}
      </div>
      {hasChildren && expanded ? (
        <div className="animate-fade-in" style={{ borderLeft: `2px solid ${hue.line}25`, marginLeft: 10, paddingLeft: 8 }}>
          {node.children!.map((child, index) => (
            <OutlineNode key={`${child.title}-${index}`} node={child} depth={depth + 1} transcript={transcript} cards={cards} onSeek={onSeek} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ================================================================== */
/*  主组件                                                              */
/* ================================================================== */

export function MindmapWindow({ result, transcript, onSeek, defaultViewMode = 'mindmap', hostFullscreen = false }: MindmapWindowProps) {
  const { root, children, markdown } = useMemo(() => normalizePayload(result), [result]);
  // 手机或三栏中的窄学习区优先给可读大纲；宽画布才默认展示整图。
  const shellRef = useRef<HTMLElement>(null);
  const userSelectedViewRef = useRef(false);
  const [viewMode, setViewMode] = useState<ViewMode>(defaultViewMode);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const enterFullscreen = useCallback(() => {
    // “全屏”是看导图的动作：即使当前因窄容器落在大纲，也直接进入完整画布。
    userSelectedViewRef.current = true;
    setViewMode('mindmap');
    setIsFullscreen(true);
  }, []);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const syncViewToContainer = () => {
      if (userSelectedViewRef.current) return;
      setViewMode(shell.getBoundingClientRect().width < 680 ? 'outline' : defaultViewMode);
    };
    syncViewToContainer();
    const observer = new ResizeObserver(syncViewToContainer);
    observer.observe(shell);
    return () => observer.disconnect();
  }, [defaultViewMode, result]);

  const totalNodes = useMemo(() => {
    const count = (nodes: MindmapNode[]): number => nodes.reduce((sum, n) => sum + 1 + count(n.children || []), 0);
    return count(children);
  }, [children]);

  const treeDepthValue = useMemo(() => {
    const d = (nodes: MindmapNode[]): number => {
      if (nodes.length === 0) return 0;
      return 1 + Math.max(0, ...nodes.map((n) => d(n.children || [])));
    };
    return d(children);
  }, [children]);

  const handleCopyOutline = useCallback(() => {
    if (!markdown) return;
    navigator.clipboard.writeText(markdown).then(() => {
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    }).catch(() => { /* silent */ });
  }, [markdown]);

  // Esc 退出全屏
  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsFullscreen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isFullscreen]);

  // 加载中：与其他应用同一套"有根的等待"（这节课的原话掠过 + 秒数）
  if (!result) {
    return <AppWindowPlaceholder status="loading" appName={APPS_COPY.mindmap.appName} transcript={transcript} />;
  }

  // 空态
  if (children.length === 0) {
    return (
      <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-4 rounded-2xl" style={{ background: PALETTE.bg, border: `1px dashed ${PALETTE.border}` }}>
        <div className="flex h-14 w-14 items-center justify-center rounded-full" style={{ background: `${PALETTE.accent}10` }}>
          <svg className="h-7 w-7" style={{ color: PALETTE.textMuted }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 3.75H6A2.25 2.25 0 003.75 6v1.5M16.5 3.75H18A2.25 2.25 0 0120.25 6v1.5m0 9V18A2.25 2.25 0 0118 20.25h-1.5m-9 0H6A2.25 2.25 0 013.75 18v-1.5" />
          </svg>
        </div>
        <div className="text-center">
          <p className="text-sm font-medium" style={{ color: PALETTE.textSecondary }}>{APPS_COPY.placeholder.emptyTitle(APPS_COPY.mindmap.appName)}</p>
          <p className="mt-1 text-xs" style={{ color: PALETTE.textMuted }}>{APPS_COPY.placeholder.emptyBody(APPS_COPY.mindmap.appName)}</p>
        </div>
      </div>
    );
  }

  const toolbar = (
    <header className="flex items-center justify-between px-4 py-2.5" style={{ background: PALETTE.bgToolbar, borderBottom: `1px solid ${PALETTE.border}`, borderRadius: isFullscreen ? 0 : '12px 12px 0 0' }}>
      <div className="flex items-baseline gap-4 text-[13px]">
        {(['mindmap', 'outline'] as const).map((mode) => {
          const isActive = viewMode === mode;
          return (
            <button
              key={mode}
              type="button"
              aria-pressed={isActive}
              onClick={() => { userSelectedViewRef.current = true; setViewMode(mode); }}
              className={`pb-0.5 transition-colors ${isActive ? 'border-b-[1.5px] border-pine font-medium text-ink' : 'border-b-[1.5px] border-transparent text-ink-muted hover:text-ink'}`}
            >
              {mode === 'mindmap' ? APPS_COPY.mindmap.viewMap : APPS_COPY.mindmap.viewOutline}
            </button>
          );
        })}
        <span className="hidden text-[12px] sm:inline" style={{ color: PALETTE.textMuted }}>{APPS_COPY.mindmap.stats(children.length, totalNodes, treeDepthValue)}</span>
      </div>
      <div className="flex items-center gap-4 text-[12.5px]" style={{ color: PALETTE.textSecondary }}>
        {!hostFullscreen || isFullscreen ? (
          <button type="button" onClick={isFullscreen ? () => setIsFullscreen(false) : enterFullscreen} className="transition hover:text-ink">
            {isFullscreen ? APPS_COPY.mindmap.exitFullscreen : APPS_COPY.mindmap.fullscreen}
          </button>
        ) : null}
        <button type="button" onClick={handleCopyOutline} className="transition hover:text-ink" style={copyFeedback ? { color: PALETTE.accent } : undefined}>
          {copyFeedback ? APPS_COPY.mindmap.copied : APPS_COPY.mindmap.copyOutline}
        </button>
      </div>
    </header>
  );

  const body = viewMode === 'mindmap' ? (
    <MindmapCanvas
      rootTitle={root}
      className="min-h-0 flex-1"
      style={isFullscreen ? undefined : { borderRadius: '0 0 12px 12px', border: `1px solid ${PALETTE.border}`, borderTop: 'none' }}
      isFullscreen={isFullscreen || hostFullscreen}
      onToggleFullscreen={hostFullscreen ? undefined : enterFullscreen}
    >
      {children}
    </MindmapCanvas>
  ) : (
    <div className="min-h-0 flex-1 overflow-auto p-4 md:p-5" style={{ background: PALETTE.bg, borderRadius: isFullscreen ? 0 : '0 0 12px 12px', border: isFullscreen ? 'none' : `1px solid ${PALETTE.border}`, borderTop: 'none' }}>
      <h2 className="mb-3 border-b pb-3 text-[17px] font-semibold tracking-[-0.01em]" style={{ color: PALETTE.textPrimary, borderColor: PALETTE.border }}>{root}</h2>
      <div className="space-y-0.5">
        {children.map((child, index) => (
          <OutlineNode key={`${child.title}-${index}`} node={child} depth={0} transcript={transcript} cards={result?.cards || []} onSeek={onSeek} />
        ))}
      </div>
    </div>
  );

  // 全屏：沉浸阅读层（第一性原理——给用户一块真正能看清的大画布）
  if (isFullscreen && typeof document !== 'undefined') {
    return createPortal(
      <div className="fixed inset-0 z-[120] flex flex-col animate-fade-in" style={{ background: PALETTE.bg }}>
        {toolbar}
        {body}
      </div>,
      document.body
    );
  }

  return (
    <section
      ref={shellRef}
      className="flex h-[clamp(30rem,calc(100dvh-7rem),52rem)] min-h-[30rem] flex-col gap-0 animate-fade-in"
      data-testid="mindmap-window"
    >
      {toolbar}
      {body}
    </section>
  );
}
