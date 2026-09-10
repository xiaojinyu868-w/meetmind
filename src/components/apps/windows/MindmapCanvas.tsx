'use client';

/**
 * MindmapCanvas — 自绘 SVG 思维导图画布（从 MindmapWindow 提出，2026-09-10）。
 *
 * v7：米白纸 + 文字坐在墨线上；按一级主干配色。交互（这次打磨的重点）：
 * - 平移有惯性与边界（mindmap-gestures：松手按速度滑行、任何方向至少留 96px 内容在视口里）；
 * - 滚轮以光标为锚缩放；触屏双指缩放（Pointer Events 两指）；「适应」一键回全图；
 * - 悬停一个节点：根到它的整条路径提亮，其余退淡（180ms）；
 * - 折叠 / 展开：节点 <g> 用 CSS transform 定位并带 300ms 过渡，新节点淡入，收起的子树淡出；
 * - 键盘：容器可聚焦，↑↓ 在兄弟间、←→ 在父子间移动焦点（pine 环），回车 / 空格 折叠 / 展开，
 *   一级主干回车 = 只看这一支；
 * - 折叠点位的命中区在触屏上放大到 44px。
 * pointerdown 时不能立刻 setPointerCapture（会吃掉 <text> 的 click，2026-09-09 实测），位移 > 3px 才捕获。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { MindmapNode } from '@/lib/ai-native/plugins/mindmap-tree';
import { APPS_COPY } from '@/lib/ui/copy-apps';
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
import {
  applyPinch,
  clampPan,
  inertiaStep,
  mindmapKeyTarget,
  pathIdsOf,
  shouldStartInertia,
  zoomAround,
  type Point,
  type ViewTransform,
} from './mindmap-gestures';
import { useCoarsePointer, prefersReducedMotion } from './app-motion';
import { useKeyboardHintOnce } from './keyboard-hints';

const MIN_READABLE_SCALE = 0.6;
// 允许把小图放大到铺满视口（豆包式：进来就大、就清楚），不再卡在 1.x 让小图缩在角落
const MAX_FIT_SCALE = 2.2;
// 自适应时留的边距系数（铺到 ~92%，四周留口气）
const FIT_MARGIN = 0.92;
const PADDING = 56;
const FONT_FAMILY = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif";

/** 收集"所有有子节点的节点 id" + root —— 用于默认整图展开 */
export function buildFullExpandedSet(treeChildren: MindmapNode[]): Set<string> {
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

interface MindmapCanvasProps {
  rootTitle: string;
  children: MindmapNode[];
  className?: string;
  style?: CSSProperties;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

export function MindmapCanvas({ rootTitle, children: treeChildren, className, style, isFullscreen, onToggleFullscreen }: MindmapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const coarse = useCoarsePointer();
  const showHint = useKeyboardHintOnce('mindmap');

  // 第一性原理：用户打开就该看见整张图。默认整棵树展开。
  const [expandedSet, setExpandedSet] = useState<Set<string>>(() => buildFullExpandedSet(treeChildren));
  const [transform, setTransform] = useState<ViewTransform>({ x: 0, y: 0, scale: 1 });
  /** 聚焦的一级主干下标；null = 看全图 */
  const [focusedBranch, setFocusedBranch] = useState<number | null>(null);
  /** 悬停 / 键盘焦点的节点 id */
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [containerFocused, setContainerFocused] = useState(false);
  /** 最近一次交互来自键盘：只有这时才画焦点环（鼠标点画布也会让容器获得焦点，不该出环） */
  const [keyNav, setKeyNav] = useState(false);
  /** 正在拖或惯性滑行：transform 不做过渡 */
  const [moving, setMoving] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number; moved: boolean; lastX: number; lastY: number; lastT: number; vx: number; vy: number } | null>(null);
  const pointersRef = useRef(new Map<number, Point>());
  const pinchRef = useRef<[Point, Point] | null>(null);
  const inertiaRef = useRef(0);
  const isAnimatingRef = useRef(false);

  // 手机首屏先看清主干；桌面画布更宽，默认展开整图。用户仍可随时点"展开"查看全部节点。
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

  const svgWidth = layout.bb.maxX - layout.bb.minX + PADDING * 2;
  const svgHeight = layout.bb.maxY - layout.bb.minY + PADDING * 2;
  const offsetX = -layout.bb.minX + PADDING;
  const offsetY = -layout.bb.minY + PADDING;
  const contentSize = useMemo(() => ({ width: svgWidth, height: svgHeight }), [svgWidth, svgHeight]);

  const viewport = () => {
    const rect = containerRef.current?.getBoundingClientRect();
    return { width: rect?.width ?? 0, height: rect?.height ?? 0 };
  };
  const clamp = useCallback((t: ViewTransform) => clampPan(t, contentSize, viewport()), [contentSize]);

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
    cancelAnimationFrame(inertiaRef.current);
    setMoving(false);
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
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const anchor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      setTransform((t) => clampPan(zoomAround(t, delta, anchor), contentSize, { width: rect.width, height: rect.height }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [contentSize]);

  useEffect(() => () => cancelAnimationFrame(inertiaRef.current), []);

  const startInertia = useCallback((velocity: Point) => {
    if (!shouldStartInertia(velocity) || prefersReducedMotion()) { setMoving(false); setTransform((t) => clamp(t)); return; }
    let v = velocity;
    let last = performance.now();
    const tick = (now: number) => {
      const step = inertiaStep(v, Math.min(48, now - last));
      last = now;
      if (!step) { setMoving(false); setTransform((t) => clamp(t)); return; }
      v = step.velocity;
      setTransform((t) => clamp({ ...t, x: t.x + step.delta.x, y: t.y + step.delta.y }));
      inertiaRef.current = requestAnimationFrame(tick);
    };
    inertiaRef.current = requestAnimationFrame(tick);
  }, [clamp]);

  // 拖拽平移 / 双指缩放（Pointer Events，触屏与鼠标共用）
  const handlePointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    setKeyNav(false);
    cancelAnimationFrame(inertiaRef.current);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      pinchRef.current = [a, b];
      dragRef.current = null;
      setMoving(true);
      return;
    }
    dragRef.current = { startX: e.clientX, startY: e.clientY, originX: transform.x, originY: transform.y, moved: false, lastX: e.clientX, lastY: e.clientY, lastT: performance.now(), vx: 0, vy: 0 };
  }, [transform.x, transform.y]);

  const handlePointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (pointersRef.current.has(e.pointerId)) pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinchRef.current && pointersRef.current.size >= 2) {
      const [a, b] = [...pointersRef.current.values()];
      const from = pinchRef.current;
      const rect = e.currentTarget.getBoundingClientRect();
      const toLocal = (p: Point) => ({ x: p.x - rect.left, y: p.y - rect.top });
      setTransform((t) => clampPan(applyPinch(t, [toLocal(from[0]), toLocal(from[1])], [toLocal(a), toLocal(b)]), contentSize, { width: rect.width, height: rect.height }));
      pinchRef.current = [a, b];
      return;
    }
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
      drag.moved = true;
      setMoving(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    if (!drag.moved) return;
    const now = performance.now();
    const dt = Math.max(1, now - drag.lastT);
    // 速度做一点平滑（0.6 新 + 0.4 旧），避免松手前一帧的抖动决定惯性方向
    drag.vx = 0.6 * ((e.clientX - drag.lastX) / dt) + 0.4 * drag.vx;
    drag.vy = 0.6 * ((e.clientY - drag.lastY) / dt) + 0.4 * drag.vy;
    drag.lastX = e.clientX; drag.lastY = e.clientY; drag.lastT = now;
    setTransform((t) => ({ ...t, x: drag.originX + dx, y: drag.originY + dy }));
  }, [contentSize]);

  const handlePointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(e.pointerId);
    if (pinchRef.current) {
      if (pointersRef.current.size < 2) { pinchRef.current = null; setMoving(false); setTransform((t) => clamp(t)); }
      return;
    }
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    const drag = dragRef.current;
    if (drag?.moved) {
      // 松手超过 80ms 没动就不给惯性（用户是停住再松手的）
      const stale = performance.now() - drag.lastT > 80;
      startInertia(stale ? { x: 0, y: 0 } : { x: drag.vx, y: drag.vy });
      // 延后清空：让紧随其后的 click 还能读到 moved，拖完松手不误触聚焦
      setTimeout(() => { if (dragRef.current === drag) dragRef.current = null; }, 0);
    } else {
      dragRef.current = null;
    }
  }, [clamp, startInertia]);

  const zoomBy = useCallback((factor: number) => {
    const { width, height } = viewport();
    setTransform((t) => clamp(zoomAround(t, factor, { x: width / 2, y: height / 2 })));
  }, [clamp]);

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

  // 键盘：方向键移动焦点，回车 / 空格 折叠展开（主干 = 只看这一支）
  const navNodes = useMemo(() => layout.nodes.map((node) => ({ id: node.id, y: node.y, side: node.side })), [layout.nodes]);
  const handleKeyDown = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key.startsWith('Arrow') || e.key === 'Enter' || e.key === ' ') setKeyNav(true);
    if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      const target = mindmapKeyTarget(navNodes, focusId ?? 'root', e.key);
      if (target) setFocusId(target);
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && focusId) {
      e.preventDefault();
      const node = layout.nodes.find((item) => item.id === focusId);
      if (!node) return;
      if (node.depth === 1) focusBranch(branchIndexOf(node.id));
      else if (node.hasChildren) toggleNode(node.id);
      return;
    }
    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomBy(1.25); }
    if (e.key === '-') { e.preventDefault(); zoomBy(0.8); }
    if (e.key === '0') { e.preventDefault(); fitToView(); }
  }, [fitToView, focusBranch, focusId, layout.nodes, navNodes, toggleNode, zoomBy]);

  // 文字基线 / 墨线 y；x 方向按生长侧镜像（左侧节点：折叠点在左、文字贴盒子右缘）。坐标相对节点自身 (node.x, node.y)
  const underlineY = (node: LayoutNode) => node.height - 7;
  const textBaselineY = (node: LayoutNode) => node.height - 12;
  const nodeTextWidth = (node: LayoutNode) => measureText(node.title, getFontSize(node.depth));
  const textStartX = (node: LayoutNode) => (node.side === 'left' ? node.width - nodeTextWidth(node) : 0);
  const markerCx = (node: LayoutNode) => (node.side === 'left' ? textStartX(node) - 13 : nodeTextWidth(node) + 13);
  /** 连线在节点上的接点（绝对坐标）：朝向父节点那一端 */
  const edgeInX = (node: LayoutNode) => (node.side === 'left' ? node.x + node.width : node.x);
  const edgeOutX = (node: LayoutNode) => (node.side === 'left' ? node.x + textStartX(node) - 6 : node.x + nodeTextWidth(node) + 6);

  const showKeyFocus = keyNav && containerFocused;
  const highlightId = hoverId ?? (showKeyFocus ? focusId : null);
  const highlightPath = useMemo(() => (highlightId ? pathIdsOf(highlightId) : null), [highlightId]);
  const hitRadius = coarse ? 22 : 12;
  const reduced = prefersReducedMotion();
  const nodeTransition = reduced ? undefined : 'transform 300ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 180ms ease';

  return (
    <div
      ref={containerRef}
      className={`mm-focus-inset relative overflow-hidden outline-none ${className || ''}`}
      style={{ background: PALETTE.bg, cursor: moving ? 'grabbing' : 'grab', touchAction: 'none', ...style }}
      tabIndex={0}
      role="application"
      aria-label={APPS_COPY.mindmap.appName}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={handleKeyDown}
      onFocus={(e) => { if (e.target === e.currentTarget) { setContainerFocused(true); if (!focusId) setFocusId('root'); } }}
      onBlur={(e) => { if (e.target === e.currentTarget) setContainerFocused(false); }}
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
          transition: moving || reduced ? 'none' : 'transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        <g transform={`translate(${offsetX}, ${offsetY})`}>
          {/* 连线 —— 从父节点墨线右端流向子节点墨线左端，颜色随子节点所属主干；悬停路径提亮、其余退淡 */}
          {layout.edges.map((edge) => {
            const branchIdx = branchIndexOf(edge.to.id);
            const hue = getBranchHue(branchIdx);
            const fromRoot = edge.from.depth === 0;
            const leftward = edge.to.side === 'left';
            const x1 = fromRoot
              ? (leftward ? edge.from.x : edge.from.x + edge.from.width)
              : edgeOutX(edge.from);
            const y1 = fromRoot ? edge.from.y + edge.from.height / 2 : edge.from.y + underlineY(edge.from);
            const x2 = edgeInX(edge.to);
            const y2 = edge.to.y + underlineY(edge.to);
            const cpOffset = Math.max(18, Math.min(LEVEL_GAP_X * 0.6, Math.abs(x2 - x1) * 0.5)) * (leftward ? -1 : 1);
            const d = `M ${x1} ${y1} C ${x1 + cpOffset} ${y1}, ${x2 - cpOffset} ${y2}, ${x2} ${y2}`;
            const onPath = highlightPath?.has(edge.to.id) ?? false;
            const baseOpacity = edge.to.depth <= 1 ? 0.85 : 0.45;
            const opacity = highlightPath ? (onPath ? 1 : baseOpacity * 0.28) : baseOpacity;
            const dimmed = focusedBranch !== null && branchIdx !== focusedBranch;
            return (
              <path
                key={`edge-${edge.to.id}`}
                d={d}
                fill="none"
                stroke={hue.line}
                strokeWidth={(edge.to.depth === 1 ? 2 : 1.5) + (onPath ? 0.8 : 0)}
                strokeLinecap="round"
                opacity={dimmed ? 0.2 : opacity}
                style={{ transition: reduced ? undefined : 'opacity 180ms ease, stroke-width 180ms ease', animation: reduced ? undefined : 'fadeIn 220ms ease-out' }}
              />
            );
          })}

          {/* 节点：<g> 用 CSS transform 定位（折叠 / 展开时位置平滑过渡），新节点淡入 */}
          {layout.nodes.map((node) => {
            const isRoot = node.depth === 0;
            const branchIdx = branchIndexOf(node.id);
            const hue = getBranchHue(branchIdx);
            const fontSize = getFontSize(node.depth);
            const fontWeight = isRoot ? 700 : node.depth === 1 ? 650 : 500;
            const tw = nodeTextWidth(node);
            const dimmedByBranch = focusedBranch !== null && !isRoot && branchIdx !== focusedBranch;
            const offPath = highlightPath ? !highlightPath.has(node.id) : false;
            const opacity = dimmedByBranch ? 0.35 : offPath ? 0.45 : 1;
            const isKeyFocus = showKeyFocus && focusId === node.id;
            const groupStyle: CSSProperties = {
              transform: `translate(${node.x}px, ${node.y}px)`,
              transition: nodeTransition,
              animation: reduced ? undefined : 'fadeIn 220ms ease-out',
              opacity,
            };

            if (isRoot) {
              // 根：墨松绿胶囊，白字，整张图的起点
              return (
                <g key={node.id} style={groupStyle}>
                  <title>{node.fullTitle}</title>
                  {isKeyFocus ? <rect x={-4} y={-4} width={node.width + 8} height={node.height + 8} rx={(node.height + 8) / 2} fill="none" stroke={PALETTE.accent} strokeWidth={1.5} strokeDasharray="3 3" /> : null}
                  <rect x={0} y={0} width={node.width} height={node.height} rx={node.height / 2} ry={node.height / 2} fill={PALETTE.accent} />
                  <text
                    x={node.width / 2}
                    y={node.height / 2}
                    fontSize={fontSize}
                    fontWeight={700}
                    fontFamily={FONT_FAMILY}
                    dominantBaseline="central"
                    textAnchor="middle"
                    style={{ fill: 'var(--mm-card)', userSelect: 'none' }}
                    onMouseEnter={() => setHoverId(node.id)}
                    onMouseLeave={() => setHoverId(null)}
                  >
                    {node.title}
                  </text>
                </g>
              );
            }

            const isTrunk = node.depth === 1;
            const tx = textStartX(node);
            return (
              <g key={node.id} style={groupStyle}>
                <title>{node.fullTitle}</title>
                {isKeyFocus ? (
                  <rect x={tx - 6} y={4} width={tw + 12} height={node.height - 2} rx={7} fill="none" stroke={PALETTE.accent} strokeWidth={1.5} strokeDasharray="3 3" />
                ) : null}
                {/* 文字：一级主干可点 → 只看这一支 */}
                <text
                  x={tx}
                  y={textBaselineY(node)}
                  fontSize={fontSize}
                  fontWeight={fontWeight}
                  fontFamily={FONT_FAMILY}
                  fill={hue.text}
                  dominantBaseline="alphabetic"
                  textAnchor="start"
                  style={{ userSelect: 'none', cursor: isTrunk ? 'pointer' : 'default' }}
                  onMouseEnter={() => setHoverId(node.id)}
                  onMouseLeave={() => setHoverId(null)}
                  onMouseDown={isTrunk ? (e) => e.stopPropagation() : undefined}
                  onClick={isTrunk ? (e) => { e.stopPropagation(); if (!dragRef.current?.moved) focusBranch(branchIdx); } : undefined}
                >
                  {node.title}
                </text>

                {/* 墨线（文字下划线，朱批/松墨手感） */}
                <line
                  x1={tx}
                  y1={underlineY(node)}
                  x2={tx + tw}
                  y2={underlineY(node)}
                  stroke={hue.line}
                  strokeWidth={node.depth === 1 ? 2.4 : 1.8}
                  strokeLinecap="round"
                  opacity={node.depth <= 1 ? 0.9 : 0.6}
                />

                {/* 折叠点位：有子节点时出现的小圆，收起态实心、展开态空心；命中区触屏 44px */}
                {node.hasChildren && (
                  <g
                    style={{ cursor: 'pointer' }}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); if (!dragRef.current?.moved) toggleNode(node.id); }}
                  >
                    <circle cx={markerCx(node)} cy={underlineY(node)} r={hitRadius} fill="transparent" />
                    <circle
                      cx={markerCx(node)}
                      cy={underlineY(node)}
                      r={5}
                      fill={node.expanded ? PALETTE.bg : hue.marker}
                      stroke={hue.marker}
                      strokeWidth={1.6}
                      style={{ transition: reduced ? undefined : 'fill 180ms ease' }}
                    />
                    {!node.expanded && (
                      <text
                        x={markerCx(node)}
                        y={underlineY(node)}
                        fontSize={9}
                        fontWeight={700}
                        dominantBaseline="central"
                        textAnchor="middle"
                        style={{ fill: 'var(--mm-card)', userSelect: 'none', pointerEvents: 'none' }}
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
        <button type="button" onClick={() => zoomBy(0.8)} className="mm-press mm-focus flex h-7 w-7 items-center justify-center rounded-full text-[15px] leading-none hover:text-ink" aria-label={APPS_COPY.mindmap.zoomOut}>−</button>
        <span className="min-w-[4ch] text-center tabular-nums" style={{ color: PALETTE.textMuted }}>{Math.round(transform.scale * 100)}%</span>
        <button type="button" onClick={() => zoomBy(1.25)} className="mm-press mm-focus flex h-7 w-7 items-center justify-center rounded-full text-[15px] leading-none hover:text-ink" aria-label={APPS_COPY.mindmap.zoomIn}>+</button>
        <span className="h-3.5 w-px" style={{ background: PALETTE.border }} aria-hidden />
        <button type="button" onClick={fitToView} className="mm-focus rounded px-1 py-1 transition hover:text-ink">{APPS_COPY.mindmap.fit}</button>
        {focusedBranch !== null ? (
          <button type="button" onClick={expandAll} className="mm-focus rounded px-1 py-1 font-medium transition hover:text-ink" style={{ color: PALETTE.accent }}>{APPS_COPY.mindmap.showAll}</button>
        ) : (
          <>
            <button type="button" onClick={expandAll} className="mm-focus rounded px-1 py-1 transition hover:text-ink">{APPS_COPY.mindmap.expandAll}</button>
            <button type="button" onClick={collapseAll} className="mm-focus rounded px-1 py-1 transition hover:text-ink">{APPS_COPY.mindmap.trunkOnly}</button>
          </>
        )}
        {onToggleFullscreen && !isFullscreen ? (
          <>
            <span className="h-3.5 w-px" style={{ background: PALETTE.border }} aria-hidden />
            <button type="button" onClick={onToggleFullscreen} className="mm-focus rounded px-1 py-1 transition hover:text-ink">{APPS_COPY.mindmap.fullscreen}</button>
          </>
        ) : null}
      </div>

      {/* 左下提示：一行淡字（手势常驻一句；键盘那句只在第一次进入出现一次） */}
      <p className="pointer-events-none absolute bottom-4 left-4 z-10 text-[11px]" style={{ color: PALETTE.textMuted }}>
        <span className="sm:hidden">{APPS_COPY.mindmap.mobileGestureHint}</span>
        <span className="hidden sm:inline">{APPS_COPY.mindmap.desktopGestureHint}{showHint ? ` · ${APPS_COPY.mindmap.keyboardHint}` : ''}</span>
      </p>
    </div>
  );
}
