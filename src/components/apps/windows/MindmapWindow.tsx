'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AppExecutionResult } from '@/lib/ai-native/types';
import type { TranscriptSegment } from '@/types';
import { EvidenceChip } from '@/components/apps/evidence/EvidenceChip';
import {
  treeToMarkdown,
  markdownToTree,
  type MindmapNode,
} from '@/lib/ai-native/plugins/mindmap.plugin';
import {
  type LayoutNode,
  PALETTE,
  NODE_PAD_X,
  LEVEL_GAP_X,
  FONT_SIZE_ROOT,
  getBranchHue,
  branchIndexOf,
  measureText,
  getFontSize,
  buildLayoutTree,
  assignPositions,
  flattenLayout,
  boundingBox,
} from './mindmap-layout';

/* ================================================================== */
/*  Types                                                              */
/* ================================================================== */

interface MindmapWindowProps {
  result: AppExecutionResult | null;
  transcript: TranscriptSegment[];
  onSeek?: (startMs: number) => void;
  /** 在"查看结果"类场景（复习工作区 / 独立结果页）默认进入全屏沉浸态——思维导图全屏才有用 */
  defaultFullscreen?: boolean;
}

interface MindmapPayload {
  root?: string;
  markdown?: string;
  children?: MindmapNode[];
  branches?: Array<{ title?: string; points?: string[]; startMs?: number }>;
}

type ViewMode = 'mindmap' | 'outline';

const MIN_READABLE_SCALE = 0.6;
// 允许把小图放大到铺满视口（豆包式：进来就大、就清楚），不再卡在 1.x 让小图缩在角落
const MAX_FIT_SCALE = 2.2;
// 自适应时留的边距系数（铺到 ~92%，四周留口气）
const FIT_MARGIN = 0.92;

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

/** 收集"所有有子节点的节点 id" + root —— 用于默认整图展开 */
function buildFullExpandedSet(treeChildren: MindmapNode[]): Set<string> {
  const set = new Set<string>(['root']);
  const walk = (nodes: MindmapNode[], parentId: string) => {
    nodes.forEach((node, i) => {
      const id = `${parentId}-${i}`;
      if (Array.isArray(node.children) && node.children.length > 0) {
        set.add(id);
        walk(node.children, id);
      }
    });
  };
  walk(treeChildren, 'root');
  return set;
}

/* ================================================================== */
/*  自绘 SVG 思维导图渲染器 —— v7：米白纸 + 文字坐在墨线上               */
/* ================================================================== */

function CustomMindmapRenderer({
  rootTitle,
  children: treeChildren,
  className,
  style,
  isFullscreen,
  onToggleFullscreen,
}: {
  rootTitle: string;
  children: MindmapNode[];
  className?: string;
  style?: React.CSSProperties;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  // 第一性原理：用户打开就该看见整张图。默认整棵树展开。
  const [expandedSet, setExpandedSet] = useState<Set<string>>(() => buildFullExpandedSet(treeChildren));
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);
  const isAnimatingRef = useRef(false);

  // treeChildren 变化时重新整图展开
  useEffect(() => {
    setExpandedSet(buildFullExpandedSet(treeChildren));
  }, [treeChildren]);

  const toggleNode = useCallback((id: string) => {
    setExpandedSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // 构建布局
  const layout = useMemo(() => {
    const rootNode: LayoutNode = {
      id: 'root',
      title: rootTitle,
      depth: 0,
      x: 0,
      y: 0,
      width: measureText(rootTitle, FONT_SIZE_ROOT) + NODE_PAD_X * 2,
      height: 40,
      children: buildLayoutTree(treeChildren, 1, expandedSet, 'root'),
      expanded: true,
      hasChildren: treeChildren.length > 0,
    };

    assignPositions(rootNode, 0, 0);
    const { nodes, edges } = flattenLayout(rootNode);
    const bb = boundingBox(nodes);
    return { nodes, edges, bb, rootNode };
  }, [rootTitle, treeChildren, expandedSet]);

  const PADDING = 56;
  const svgWidth = layout.bb.maxX - layout.bb.minX + PADDING * 2;
  const svgHeight = layout.bb.maxY - layout.bb.minY + PADDING * 2;
  const offsetX = -layout.bb.minX + PADDING;
  const offsetY = -layout.bb.minY + PADDING;

  // 自适应：整图尽量铺满视口（小图也放大到清楚），但绝不缩到读不清；放不下时让根节点贴左上
  const fitToView = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const scaleRaw = Math.min(rect.width / svgWidth, rect.height / svgHeight) * FIT_MARGIN;
    const scale = Math.min(Math.max(scaleRaw, MIN_READABLE_SCALE), MAX_FIT_SCALE);
    const fitsW = svgWidth * scale <= rect.width;
    const fitsH = svgHeight * scale <= rect.height;
    const x = fitsW ? (rect.width - svgWidth * scale) / 2 : 24;
    const y = fitsH ? (rect.height - svgHeight * scale) / 2 : 24;
    isAnimatingRef.current = true;
    setTransform({ x, y, scale });
    setTimeout(() => { isAnimatingRef.current = false; }, 420);
  }, [svgWidth, svgHeight]);

  // 初次 / 尺寸变化自适应
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const raf = requestAnimationFrame(() => fitToView());
    const ro = new ResizeObserver(() => { if (!isAnimatingRef.current) fitToView(); });
    ro.observe(el);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [fitToView]);

  // 滚轮缩放 —— 用原生非被动监听器，否则 React 的 onWheel 是 passive，preventDefault 会报警告且失效。
  // 以光标为锚点缩放：光标下的内容不动（这是"顺手"的关键）。
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      setTransform((t) => {
        const newScale = Math.min(2.6, Math.max(0.3, t.scale * delta));
        const ratio = newScale / t.scale;
        return { scale: newScale, x: mx - (mx - t.x) * ratio, y: my - (my - t.y) * ratio };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // 拖拽平移
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, originX: transform.x, originY: transform.y, moved: false };
  }, [transform.x, transform.y]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
    const nextX = drag.originX + dx;
    const nextY = drag.originY + dy;
    setTransform((t) => ({ ...t, x: nextX, y: nextY }));
  }, []);

  const handleMouseUp = useCallback(() => { dragRef.current = null; }, []);

  const zoomBy = useCallback((factor: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    const cx = rect ? rect.width / 2 : 0;
    const cy = rect ? rect.height / 2 : 0;
    setTransform((t) => {
      const newScale = Math.min(2.6, Math.max(0.3, t.scale * factor));
      const ratio = newScale / t.scale;
      return { scale: newScale, x: cx - (cx - t.x) * ratio, y: cy - (cy - t.y) * ratio };
    });
  }, []);

  // 展开 / 收起全部
  const expandAll = useCallback(() => {
    setExpandedSet(buildFullExpandedSet(treeChildren));
    requestAnimationFrame(() => fitToView());
  }, [treeChildren, fitToView]);

  const collapseAll = useCallback(() => {
    setExpandedSet(new Set<string>(['root']));
    requestAnimationFrame(() => fitToView());
  }, [fitToView]);

  // 文字基线 / 墨线 y
  const underlineY = (node: LayoutNode) => node.y + node.height - 7;
  const textBaselineY = (node: LayoutNode) => node.y + node.height - 12;
  const nodeTextWidth = (node: LayoutNode) => measureText(node.title, getFontSize(node.depth));

  const ctrlBtn =
    'flex h-8 w-8 items-center justify-center rounded-lg text-[15px] transition-colors';
  const ctrlBtnStyle: React.CSSProperties = {
    background: PALETTE.bgSurface,
    border: `1px solid ${PALETTE.border}`,
    color: PALETTE.textSecondary,
  };

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden ${className || ''}`}
      style={{ background: PALETTE.bg, cursor: dragRef.current?.moved ? 'grabbing' : 'grab', ...style }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* 极淡纸纹 */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.5]"
        style={{ background: `radial-gradient(circle at 30% 20%, ${PALETTE.bgSurface} 0%, transparent 60%)` }}
      />

      <svg
        width="100%"
        height="100%"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          transformOrigin: '0 0',
          transition: dragRef.current ? 'none' : 'transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
      >
        <g transform={`translate(${offsetX}, ${offsetY})`}>
          {/* 连线 —— 从父节点墨线右端流向子节点墨线左端，颜色随子节点所属主干 */}
          {layout.edges.map((edge, i) => {
            const branchIdx = branchIndexOf(edge.to.id);
            const hue = getBranchHue(branchIdx);
            const fromRoot = edge.from.depth === 0;
            const x1 = fromRoot
              ? edge.from.x + edge.from.width
              : edge.from.x + nodeTextWidth(edge.from) + 6;
            const y1 = fromRoot ? edge.from.y + edge.from.height / 2 : underlineY(edge.from);
            const x2 = edge.to.x;
            const y2 = underlineY(edge.to);
            const cpOffset = Math.max(18, Math.min(LEVEL_GAP_X * 0.6, Math.abs(x2 - x1) * 0.5));
            const d = `M ${x1} ${y1} C ${x1 + cpOffset} ${y1}, ${x2 - cpOffset} ${y2}, ${x2} ${y2}`;
            return (
              <path
                key={`edge-${i}`}
                d={d}
                fill="none"
                stroke={hue.line}
                strokeWidth={edge.to.depth === 1 ? 2 : 1.5}
                strokeLinecap="round"
                opacity={edge.to.depth <= 1 ? 0.85 : 0.45}
              />
            );
          })}

          {/* 节点 */}
          {layout.nodes.map((node) => {
            const isRoot = node.depth === 0;
            const branchIdx = branchIndexOf(node.id);
            const hue = getBranchHue(branchIdx);
            const fontSize = getFontSize(node.depth);
            const fontWeight = isRoot ? 700 : node.depth === 1 ? 650 : 500;
            const tw = nodeTextWidth(node);

            if (isRoot) {
              // 根：墨松绿胶囊，白字，整张图的起点（贴左侧）
              return (
                <g key={node.id}>
                  <rect
                    x={node.x}
                    y={node.y}
                    width={node.width}
                    height={node.height}
                    rx={node.height / 2}
                    ry={node.height / 2}
                    fill={PALETTE.accent}
                  />
                  <text
                    x={node.x + node.width / 2}
                    y={node.y + node.height / 2}
                    fontSize={fontSize}
                    fontWeight={700}
                    fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif"
                    fill="#ffffff"
                    dominantBaseline="central"
                    textAnchor="middle"
                    style={{ userSelect: 'none' }}
                  >
                    {node.title}
                  </text>
                </g>
              );
            }

            return (
              <g key={node.id}>
                {/* 文字 */}
                <text
                  x={node.x}
                  y={textBaselineY(node)}
                  fontSize={fontSize}
                  fontWeight={fontWeight}
                  fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif"
                  fill={hue.text}
                  dominantBaseline="alphabetic"
                  textAnchor="start"
                  style={{ userSelect: 'none' }}
                >
                  {node.title}
                </text>

                {/* 墨线（文字下划线，朱批/松墨手感） */}
                <line
                  x1={node.x}
                  y1={underlineY(node)}
                  x2={node.x + tw}
                  y2={underlineY(node)}
                  stroke={hue.line}
                  strokeWidth={node.depth === 1 ? 2.4 : 1.8}
                  strokeLinecap="round"
                  opacity={node.depth <= 1 ? 0.9 : 0.6}
                />

                {/* 折叠点位：有子节点时出现的小圆，收起态实心、展开态空心 */}
                {node.hasChildren && (
                  <g
                    style={{ cursor: 'pointer' }}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); if (!dragRef.current?.moved) toggleNode(node.id); }}
                  >
                    {/* 命中区域 */}
                    <circle cx={node.x + tw + 13} cy={underlineY(node)} r={10} fill="transparent" />
                    <circle
                      cx={node.x + tw + 13}
                      cy={underlineY(node)}
                      r={5}
                      fill={node.expanded ? PALETTE.bg : hue.marker}
                      stroke={hue.marker}
                      strokeWidth={1.6}
                    />
                    {!node.expanded && (
                      <text
                        x={node.x + tw + 13}
                        y={underlineY(node)}
                        fontSize={9}
                        fontWeight={700}
                        fill="#ffffff"
                        dominantBaseline="central"
                        textAnchor="middle"
                        style={{ userSelect: 'none' }}
                      >
                        +
                      </text>
                    )}
                  </g>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {/* 右下角控制面板 */}
      <div
        className="absolute bottom-3 right-3 z-10 flex items-center gap-1 rounded-xl p-1"
        style={{ background: `${PALETTE.bgSurface}f2`, border: `1px solid ${PALETTE.border}`, backdropFilter: 'blur(8px)', boxShadow: '0 4px 16px rgba(28,27,25,0.08)' }}
      >
        <button type="button" onClick={() => zoomBy(0.8)} className={ctrlBtn} style={ctrlBtnStyle} title="缩小">−</button>
        <button type="button" onClick={() => zoomBy(1.25)} className={ctrlBtn} style={ctrlBtnStyle} title="放大">+</button>
        <button type="button" onClick={fitToView} className={ctrlBtn} style={ctrlBtnStyle} title="适应窗口">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}><path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9 3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5 5.25 5.25" /></svg>
        </button>
        <span className="mx-0.5 h-5 w-px" style={{ background: PALETTE.border }} />
        <button type="button" onClick={expandAll} className="rounded-lg px-2 text-[12px] transition-colors" style={ctrlBtnStyle} title="全部展开">展开</button>
        <button type="button" onClick={collapseAll} className="rounded-lg px-2 text-[12px] transition-colors" style={ctrlBtnStyle} title="只看主干">主干</button>
        {onToggleFullscreen && (
          <>
            <span className="mx-0.5 h-5 w-px" style={{ background: PALETTE.border }} />
            <button type="button" onClick={onToggleFullscreen} className={ctrlBtn} style={ctrlBtnStyle} title={isFullscreen ? '退出全屏' : '全屏查看'}>
              {isFullscreen ? (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}><path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M15 9h4.5M15 9V4.5M9 15v4.5M9 15H4.5m10.5 0h4.5m-4.5 0v4.5" /></svg>
              ) : (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M20.25 3.75v4.5m0-4.5h-4.5m4.5 0L15 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15m11.25 5.25v-4.5m0 4.5h-4.5m4.5 0L15 15" /></svg>
              )}
            </button>
          </>
        )}
      </div>

      {/* 底部提示 */}
      <div className="pointer-events-none absolute bottom-3 left-3 z-10">
        <p className="rounded-full px-3 py-1 text-[11px]" style={{ background: `${PALETTE.bgSurface}cc`, border: `1px solid ${PALETTE.border}`, color: PALETTE.textMuted }}>
          滚轮缩放 · 拖拽平移
        </p>
      </div>
    </div>
  );
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
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition-all duration-200" style={{ background: expanded ? `${hue.line}1f` : 'transparent', color: hue.line }}>
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

export function MindmapWindow({ result, transcript, onSeek, defaultFullscreen = false }: MindmapWindowProps) {
  const { root, children, markdown } = useMemo(() => normalizePayload(result), [result]);
  const [viewMode, setViewMode] = useState<ViewMode>('mindmap');
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(defaultFullscreen);

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

  // 加载中
  if (!result) {
    return (
      <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-4 rounded-2xl" style={{ background: PALETTE.bg, border: `1px solid ${PALETTE.border}` }}>
        <div className="relative">
          <div className="absolute inset-0 animate-ping rounded-full opacity-20" style={{ background: PALETTE.accent }} />
          <div className="relative flex h-14 w-14 items-center justify-center rounded-full" style={{ background: `${PALETTE.accent}15`, border: `2px solid ${PALETTE.accent}33` }}>
            <svg className="h-6 w-6 animate-spin" style={{ color: PALETTE.accent }} fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        </div>
        <div className="text-center">
          <p className="text-sm font-medium" style={{ color: PALETTE.textPrimary }}>正在构建思维导图</p>
          <p className="mt-1 text-xs" style={{ color: PALETTE.textMuted }}>AI 正在分析课堂内容，梳理知识结构...</p>
        </div>
      </div>
    );
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
          <p className="text-sm font-medium" style={{ color: PALETTE.textSecondary }}>暂未生成思维导图</p>
          <p className="mt-1 text-xs" style={{ color: PALETTE.textMuted }}>请点击&ldquo;重新生成&rdquo;以获取课堂知识结构</p>
        </div>
      </div>
    );
  }

  const toolbar = (
    <header className="flex items-center justify-between px-4 py-2.5" style={{ background: PALETTE.bgToolbar, borderBottom: `1px solid ${PALETTE.border}`, borderRadius: isFullscreen ? 0 : '12px 12px 0 0' }}>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-0.5 rounded-lg p-0.5" style={{ background: PALETTE.bg, border: `1px solid ${PALETTE.border}` }}>
          {(['mindmap', 'outline'] as const).map((mode) => {
            const isActive = viewMode === mode;
            const label = mode === 'mindmap' ? '导图' : '大纲';
            const icon = mode === 'mindmap' ? (
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 3.75H6A2.25 2.25 0 003.75 6v1.5M16.5 3.75H18A2.25 2.25 0 0120.25 6v1.5m0 9V18A2.25 2.25 0 0118 20.25h-1.5m-9 0H6A2.25 2.25 0 013.75 18v-1.5" /></svg>
            ) : (
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" /></svg>
            );
            return (
              <button key={mode} type="button" onClick={() => setViewMode(mode)} className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-200" style={{ background: isActive ? PALETTE.accent : 'transparent', color: isActive ? '#fff' : PALETTE.textSecondary }}>
                {icon}{label}
              </button>
            );
          })}
        </div>
        <div className="hidden items-center gap-2 text-xs sm:flex" style={{ color: PALETTE.textMuted }}>
          <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: getBranchHue(0).line }} />{children.length} 个分支</span>
          <span style={{ color: PALETTE.border }}>·</span>
          <span>{totalNodes} 个节点</span>
          <span style={{ color: PALETTE.border }}>·</span>
          <span>{treeDepthValue} 层</span>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <button type="button" onClick={() => setIsFullscreen((p) => !p)} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all duration-200" style={{ border: `1px solid ${PALETTE.border}`, background: 'transparent', color: PALETTE.textSecondary }} title={isFullscreen ? '退出全屏' : '全屏查看'}>
          {isFullscreen ? (
            <><svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}><path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M15 9h4.5M15 9V4.5M9 15v4.5M9 15H4.5m10.5 0h4.5m-4.5 0v4.5" /></svg>退出全屏</>
          ) : (
            <><svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M20.25 3.75v4.5m0-4.5h-4.5m4.5 0L15 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15m11.25 5.25v-4.5m0 4.5h-4.5m4.5 0L15 15" /></svg>全屏</>
          )}
        </button>
        <button type="button" onClick={handleCopyOutline} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all duration-200" style={{ border: `1px solid ${PALETTE.border}`, background: 'transparent', color: copyFeedback ? PALETTE.accent : PALETTE.textSecondary }} title="复制文本大纲到剪贴板">
          {copyFeedback ? (
            <><svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>已复制</>
          ) : (
            <><svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" /></svg>复制</>
          )}
        </button>
      </div>
    </header>
  );

  const body = viewMode === 'mindmap' ? (
    <CustomMindmapRenderer
      rootTitle={root}
      className="min-h-0 flex-1"
      style={isFullscreen ? undefined : { borderRadius: '0 0 12px 12px', border: `1px solid ${PALETTE.border}`, borderTop: 'none' }}
      isFullscreen={isFullscreen}
      onToggleFullscreen={() => setIsFullscreen((p) => !p)}
    >
      {children}
    </CustomMindmapRenderer>
  ) : (
    <div className="min-h-0 flex-1 overflow-auto p-4 md:p-5" style={{ background: PALETTE.bg, borderRadius: isFullscreen ? 0 : '0 0 12px 12px', border: isFullscreen ? 'none' : `1px solid ${PALETTE.border}`, borderTop: 'none' }}>
      <div className="mb-4 flex items-center gap-3 pb-3" style={{ borderBottom: `1px solid ${PALETTE.border}` }}>
        <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: `${PALETTE.accent}18` }}>
          <svg className="h-4 w-4" style={{ color: PALETTE.accent }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 3.75H6A2.25 2.25 0 003.75 6v1.5M16.5 3.75H18A2.25 2.25 0 0120.25 6v1.5m0 9V18A2.25 2.25 0 0118 20.25h-1.5m-9 0H6A2.25 2.25 0 013.75 18v-1.5" /></svg>
        </span>
        <h2 className="text-lg font-semibold" style={{ color: PALETTE.textPrimary }}>{root}</h2>
      </div>
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
    <section className="flex h-full flex-col gap-0 animate-fade-in" data-testid="mindmap-window">
      {toolbar}
      {body}
    </section>
  );
}
