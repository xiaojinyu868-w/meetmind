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
import {
  type LayoutNode,
  PALETTE,
  NODE_PAD_X,
  LEVEL_GAP_X,
  FONT_SIZE_ROOT,
  getBranchHue,
  branchIndexOf,
  measureText,
  compactVisualLabel,
  getFontSize,
  buildLayoutTree,
  assignPositionsBilateral,
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
  /** 窄屏可以先给可读大纲；全屏始终由用户主动触发。 */
  defaultViewMode?: ViewMode;
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

/** 只展开某一条主干（含它的整棵子树）：聚焦一支 */
function buildBranchExpandedSet(treeChildren: MindmapNode[], branchIndex: number): Set<string> {
  const set = new Set<string>(['root']);
  const branch = treeChildren[branchIndex];
  if (!branch) return set;
  const branchId = `root-${branchIndex}`;
  const walk = (nodes: MindmapNode[], parentId: string) => {
    nodes.forEach((node, i) => {
      const id = `${parentId}-${i}`;
      if (Array.isArray(node.children) && node.children.length > 0) {
        set.add(id);
        walk(node.children, id);
      }
    });
  };
  if (Array.isArray(branch.children) && branch.children.length > 0) {
    set.add(branchId);
    walk(branch.children, branchId);
  }
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
  /** 聚焦的一级主干下标；null = 看全图 */
  const [focusedBranch, setFocusedBranch] = useState<number | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);
  const isAnimatingRef = useRef(false);

  // 手机首屏先看清主干；桌面画布更宽，默认展开整图。
  // 用户仍可随时点“展开”查看全部节点。
  useEffect(() => {
    const isCompactViewport = window.matchMedia('(max-width: 639px)').matches;
    setExpandedSet(isCompactViewport ? new Set<string>(['root']) : buildFullExpandedSet(treeChildren));
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
    const rootLabel = compactVisualLabel(rootTitle, FONT_SIZE_ROOT, 260);
    const rootNode: LayoutNode = {
      id: 'root',
      title: rootLabel,
      fullTitle: rootTitle,
      depth: 0,
      x: 0,
      y: 0,
      width: measureText(rootLabel, FONT_SIZE_ROOT) + NODE_PAD_X * 2,
      height: 40,
      children: buildLayoutTree(treeChildren, 1, expandedSet, 'root'),
      expanded: true,
      hasChildren: treeChildren.length > 0,
    };

    assignPositionsBilateral(rootNode, 0, 0);
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

  // 拖拽平移。注意：pointerdown 时不能立刻 setPointerCapture——捕获后 pointerup 落在容器上，
  // 浏览器就把 click 派发给容器而不是节点文字，导致点主干聚焦 / 点圆点折叠全部失效。
  // 只在真的拖起来（位移 > 3px）之后才捕获，既保住节点点击，又不会拖出容器就丢事件。
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, originX: transform.x, originY: transform.y, moved: false };
  }, [transform.x, transform.y]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
      drag.moved = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    if (!drag.moved) return;
    setTransform((t) => ({ ...t, x: drag.originX + dx, y: drag.originY + dy }));
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    // 延后清空：让紧随其后的 click 还能读到 moved，拖完松手不误触聚焦
    const drag = dragRef.current;
    if (drag?.moved) setTimeout(() => { if (dragRef.current === drag) dragRef.current = null; }, 0);
    else dragRef.current = null;
  }, []);

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
    setFocusedBranch(null);
    setExpandedSet(buildFullExpandedSet(treeChildren));
    requestAnimationFrame(() => fitToView());
  }, [treeChildren, fitToView]);

  const collapseAll = useCallback(() => {
    setFocusedBranch(null);
    setExpandedSet(new Set<string>(['root']));
    requestAnimationFrame(() => fitToView());
  }, [fitToView]);

  // 聚焦一支：点一级主干的文字 → 只展开这一支并铺满；再点同一支回到全图
  const focusBranch = useCallback((branchIndex: number) => {
    if (focusedBranch === branchIndex) {
      expandAll();
      return;
    }
    setFocusedBranch(branchIndex);
    setExpandedSet(buildBranchExpandedSet(treeChildren, branchIndex));
    requestAnimationFrame(() => fitToView());
  }, [expandAll, fitToView, focusedBranch, treeChildren]);

  // 文字基线 / 墨线 y；x 方向按生长侧镜像（左侧节点：折叠点在左、文字贴盒子右缘）
  const underlineY = (node: LayoutNode) => node.y + node.height - 7;
  const textBaselineY = (node: LayoutNode) => node.y + node.height - 12;
  const nodeTextWidth = (node: LayoutNode) => measureText(node.title, getFontSize(node.depth));
  const textStartX = (node: LayoutNode) => (node.side === 'left' ? node.x + node.width - nodeTextWidth(node) : node.x);
  const markerCx = (node: LayoutNode) => (node.side === 'left' ? textStartX(node) - 13 : node.x + nodeTextWidth(node) + 13);
  /** 连线在节点上的接点：朝向父节点那一端 */
  const edgeInX = (node: LayoutNode) => (node.side === 'left' ? node.x + node.width : node.x);
  const edgeOutX = (node: LayoutNode) => (node.side === 'left' ? textStartX(node) - 6 : node.x + nodeTextWidth(node) + 6);

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden ${className || ''}`}
      style={{ background: PALETTE.bg, cursor: dragRef.current?.moved ? 'grabbing' : 'grab', touchAction: 'none', ...style }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {/* 极淡纸纹 */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.5]"
        style={{ background: `radial-gradient(circle at 30% 20%, ${PALETTE.bgSurface} 0%, transparent 60%)` }}
      />

      <svg
        width={svgWidth}
        height={svgHeight}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          transformOrigin: '0 0',
          transition: dragRef.current ? 'none' : 'transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        <g transform={`translate(${offsetX}, ${offsetY})`}>
          {/* 连线 —— 从父节点墨线右端流向子节点墨线左端，颜色随子节点所属主干 */}
          {layout.edges.map((edge, i) => {
            const branchIdx = branchIndexOf(edge.to.id);
            const hue = getBranchHue(branchIdx);
            const fromRoot = edge.from.depth === 0;
            const leftward = edge.to.side === 'left';
            const x1 = fromRoot
              ? (leftward ? edge.from.x : edge.from.x + edge.from.width)
              : edgeOutX(edge.from);
            const y1 = fromRoot ? edge.from.y + edge.from.height / 2 : underlineY(edge.from);
            const x2 = edgeInX(edge.to);
            const y2 = underlineY(edge.to);
            const cpOffset = Math.max(18, Math.min(LEVEL_GAP_X * 0.6, Math.abs(x2 - x1) * 0.5)) * (leftward ? -1 : 1);
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
                  <title>{node.fullTitle}</title>
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
                    dominantBaseline="central"
                    textAnchor="middle"
                    style={{ fill: 'var(--mm-card)', userSelect: 'none' }}
                  >
                    {node.title}
                  </text>
                </g>
              );
            }

            const isTrunk = node.depth === 1;
            const dimmed = focusedBranch !== null && branchIdx !== focusedBranch;
            return (
              <g key={node.id} opacity={dimmed ? 0.35 : 1} style={{ transition: 'opacity 240ms ease' }}>
                <title>{node.fullTitle}</title>
                {/* 文字：一级主干可点 → 只看这一支 */}
                <text
                  x={textStartX(node)}
                  y={textBaselineY(node)}
                  fontSize={fontSize}
                  fontWeight={fontWeight}
                  fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif"
                  fill={hue.text}
                  dominantBaseline="alphabetic"
                  textAnchor="start"
                  style={{ userSelect: 'none', cursor: isTrunk ? 'pointer' : undefined }}
                  onMouseDown={isTrunk ? (e) => e.stopPropagation() : undefined}
                  onClick={isTrunk ? (e) => { e.stopPropagation(); if (!dragRef.current?.moved) focusBranch(branchIdx); } : undefined}
                >
                  {node.title}
                </text>

                {/* 墨线（文字下划线，朱批/松墨手感） */}
                <line
                  x1={textStartX(node)}
                  y1={underlineY(node)}
                  x2={textStartX(node) + tw}
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
                    <circle cx={markerCx(node)} cy={underlineY(node)} r={10} fill="transparent" />
                    <circle
                      cx={markerCx(node)}
                      cy={underlineY(node)}
                      r={5}
                      fill={node.expanded ? PALETTE.bg : hue.marker}
                      stroke={hue.marker}
                      strokeWidth={1.6}
                    />
                    {!node.expanded && (
                      <text
                        x={markerCx(node)}
                        y={underlineY(node)}
                        fontSize={9}
                        fontWeight={700}
                        dominantBaseline="central"
                        textAnchor="middle"
                        style={{ fill: 'var(--mm-card)', userSelect: 'none' }}
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

      {/* 右下角：一行文字控件，不做玻璃盒 */}
      <div
        className="absolute bottom-3 right-3 z-10 flex items-center gap-3 rounded-full px-3 py-1.5 text-[12px]"
        style={{ background: `${PALETTE.bgSurface}e6`, color: PALETTE.textSecondary }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button type="button" onClick={() => zoomBy(0.8)} className="px-1 text-[15px] leading-none transition hover:text-ink" aria-label={APPS_COPY.mindmap.zoomOut}>−</button>
        <span className="tabular-nums" style={{ color: PALETTE.textMuted }}>{Math.round(transform.scale * 100)}%</span>
        <button type="button" onClick={() => zoomBy(1.25)} className="px-1 text-[15px] leading-none transition hover:text-ink" aria-label={APPS_COPY.mindmap.zoomIn}>+</button>
        <span className="h-3.5 w-px" style={{ background: PALETTE.border }} aria-hidden />
        <button type="button" onClick={fitToView} className="transition hover:text-ink">{APPS_COPY.mindmap.fit}</button>
        {focusedBranch !== null ? (
          <button type="button" onClick={expandAll} className="font-medium transition hover:text-ink" style={{ color: PALETTE.accent }}>{APPS_COPY.mindmap.showAll}</button>
        ) : (
          <>
            <button type="button" onClick={expandAll} className="transition hover:text-ink">{APPS_COPY.mindmap.expandAll}</button>
            <button type="button" onClick={collapseAll} className="transition hover:text-ink">{APPS_COPY.mindmap.trunkOnly}</button>
          </>
        )}
        {onToggleFullscreen && !isFullscreen ? (
          <>
            <span className="h-3.5 w-px" style={{ background: PALETTE.border }} aria-hidden />
            <button type="button" onClick={onToggleFullscreen} className="transition hover:text-ink">{APPS_COPY.mindmap.fullscreen}</button>
          </>
        ) : null}
      </div>

      {/* 左下提示：一行淡字 */}
      <p className="pointer-events-none absolute bottom-4 left-4 z-10 text-[11px]" style={{ color: PALETTE.textMuted }}>
        <span className="sm:hidden">{APPS_COPY.mindmap.mobileGestureHint}</span>
        <span className="hidden sm:inline">{APPS_COPY.mindmap.desktopGestureHint}</span>
      </p>
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

export function MindmapWindow({ result, transcript, onSeek, defaultViewMode = 'mindmap' }: MindmapWindowProps) {
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
        <button type="button" onClick={isFullscreen ? () => setIsFullscreen(false) : enterFullscreen} className="transition hover:text-ink">
          {isFullscreen ? APPS_COPY.mindmap.exitFullscreen : APPS_COPY.mindmap.fullscreen}
        </button>
        <button type="button" onClick={handleCopyOutline} className="transition hover:text-ink" style={copyFeedback ? { color: PALETTE.accent } : undefined}>
          {copyFeedback ? APPS_COPY.mindmap.copied : APPS_COPY.mindmap.copyOutline}
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
      onToggleFullscreen={enterFullscreen}
    >
      {children}
    </CustomMindmapRenderer>
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
