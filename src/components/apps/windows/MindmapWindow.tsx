'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppExecutionResult } from '@/lib/ai-native/types';
import type { TranscriptSegment } from '@/types';
import { EvidenceChip } from '@/components/apps/evidence/EvidenceChip';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import {
  treeToMarkdown,
  markdownToTree,
  type MindmapNode,
} from '@/lib/ai-native/plugins/mindmap.plugin';

/* ================================================================== */
/*  Types                                                              */
/* ================================================================== */

interface MindmapWindowProps {
  result: AppExecutionResult | null;
  transcript: TranscriptSegment[];
  onSeek?: (startMs: number) => void;
}

interface MindmapPayload {
  root?: string;
  markdown?: string;
  children?: MindmapNode[];
  branches?: Array<{ title?: string; points?: string[]; startMs?: number }>;
}

type ViewMode = 'mindmap' | 'outline';

/* ================================================================== */
/*  色板 — 对标 NotebookLM 暗色                                        */
/* ================================================================== */

const PALETTE = {
  bg: '#1b1d2a',
  bgSurface: '#242638',
  bgToolbar: '#1e2030',
  border: '#2e3148',
  textPrimary: '#eaedf3',
  textSecondary: '#a0a3bd',
  textMuted: '#6c6f8a',
  accent: '#7c6ef0',
};

const MATH_SYNTAX_REGEX = /(?:\$[^$\n]+\$|\\\([^)\n]+\\\)|\\\[[^\]\n]+\\\])/;

function hasMathSyntax(text: string): boolean {
  return MATH_SYNTAX_REGEX.test(text || '');
}

function MathLabel({
  content,
  align,
  color,
  fontSize,
  fontWeight,
}: {
  content: string;
  align: 'left' | 'center';
  color: string;
  fontSize: number | string;
  fontWeight: number | string;
}) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: align === 'center' ? 'center' : 'flex-start',
        color,
        fontSize,
        fontWeight,
        lineHeight: 1.2,
        textAlign: align,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        userSelect: 'none',
      }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          p: ({ children }) => <span>{children}</span>,
          strong: ({ children }) => <strong>{children}</strong>,
          em: ({ children }) => <em>{children}</em>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

/**
 * 层级色板 — 同一 depth 的所有节点使用同一颜色
 * depth 0 = 根节点（accent 紫）
 * depth 1 = 一级子节点 → DEPTH_HUES[0]
 * depth 2 = 二级子节点 → DEPTH_HUES[1]
 * ...
 */
const DEPTH_HUES = [
  { node: '#7c6ef0', nodeBg: 'rgba(124,110,240,0.14)', line: 'rgba(124,110,240,0.50)', expandBtn: '#7c6ef0' },
  { node: '#59a5f5', nodeBg: 'rgba(89,165,245,0.14)',  line: 'rgba(89,165,245,0.50)',  expandBtn: '#59a5f5' },
  { node: '#4ecdc4', nodeBg: 'rgba(78,205,196,0.14)',  line: 'rgba(78,205,196,0.50)',  expandBtn: '#4ecdc4' },
  { node: '#f7b731', nodeBg: 'rgba(247,183,49,0.14)',  line: 'rgba(247,183,49,0.50)',  expandBtn: '#f7b731' },
  { node: '#fc5c65', nodeBg: 'rgba(252,92,101,0.14)',  line: 'rgba(252,92,101,0.50)',  expandBtn: '#fc5c65' },
  { node: '#a55eea', nodeBg: 'rgba(165,94,234,0.14)',  line: 'rgba(165,94,234,0.50)',  expandBtn: '#a55eea' },
  { node: '#26de81', nodeBg: 'rgba(38,222,129,0.14)',  line: 'rgba(38,222,129,0.50)',  expandBtn: '#26de81' },
  { node: '#fd9644', nodeBg: 'rgba(253,150,68,0.14)',  line: 'rgba(253,150,68,0.50)',  expandBtn: '#fd9644' },
];

/** 根据 depth 获取色调 */
function getHueByDepth(depth: number) {
  if (depth === 0) {
    return { node: PALETTE.accent, nodeBg: 'rgba(124,110,240,0.22)', line: 'rgba(124,110,240,0.55)', expandBtn: PALETTE.accent };
  }
  return DEPTH_HUES[(depth - 1) % DEPTH_HUES.length];
}

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
    const root = payload.root?.trim() || result.render?.title || '课堂知识结构';
    const children: MindmapNode[] = payload.branches
      .filter((b) => b.title)
      .map((b) => ({
        title: b.title!,
        startMs: b.startMs,
        children: Array.isArray(b.points) ? b.points.filter(Boolean).map((p) => ({ title: p })) : [],
      }));
    const md = treeToMarkdown(root, children);
    return { root, children, markdown: md };
  }
  const mindmapCard = result.cards.find((c) => c.type === 'mindmap');
  if (mindmapCard?.body) {
    const parsed = markdownToTree(mindmapCard.body);
    return { root: parsed.root, children: parsed.children, markdown: mindmapCard.body };
  }
  return { root: '课堂知识结构', children: [], markdown: '' };
}

/* ================================================================== */
/*  布局引擎 — 计算每个节点的 x/y 坐标                                  */
/* ================================================================== */

interface LayoutNode {
  id: string;
  title: string;
  depth: number;
  x: number;
  y: number;
  width: number;
  height: number;
  children: LayoutNode[];
  expanded: boolean;
  hasChildren: boolean;
}

const NODE_H = 40;
const NODE_PAD_X = 20;
const LEVEL_GAP_X = 70;
const SIBLING_GAP_Y = 12;
const FONT_SIZE_ROOT = 15;
const FONT_SIZE_L1 = 14;
const FONT_SIZE_OTHER = 13;

/** 估算文字渲染宽度 */
function measureText(text: string, fontSize: number): number {
  let w = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    w += code > 0x7f ? fontSize * 1.05 : fontSize * 0.58;
  }
  return Math.ceil(w);
}

function getFontSize(depth: number): number {
  if (depth === 0) return FONT_SIZE_ROOT;
  if (depth === 1) return FONT_SIZE_L1;
  return FONT_SIZE_OTHER;
}

/** 递归构建 LayoutNode 树 */
function buildLayoutTree(
  nodes: MindmapNode[],
  depth: number,
  expandedSet: Set<string>,
  parentId: string,
): LayoutNode[] {
  return nodes.map((node, idx) => {
    const id = `${parentId}-${idx}`;
    const fontSize = getFontSize(depth);
    const textW = measureText(node.title, fontSize);
    const hasChildren = Array.isArray(node.children) && node.children.length > 0;
    // 展开按钮宽度：hasChildren 时留出空间给右侧 > 按钮
    const expandBtnW = hasChildren ? 32 : 0;
    const width = textW + NODE_PAD_X * 2 + expandBtnW;
    const height = NODE_H;
    const expanded = expandedSet.has(id);

    const childLayouts =
      hasChildren && expanded
        ? buildLayoutTree(node.children!, depth + 1, expandedSet, id)
        : [];

    return { id, title: node.title, depth, x: 0, y: 0, width, height, children: childLayouts, expanded, hasChildren };
  });
}

/** 计算子树的总高度 */
function subtreeHeight(node: LayoutNode): number {
  if (node.children.length === 0) return node.height;
  const sum = node.children.reduce((s, c) => s + subtreeHeight(c), 0) + SIBLING_GAP_Y * (node.children.length - 1);
  return Math.max(node.height, sum);
}

/** 递归赋坐标 */
function assignPositions(node: LayoutNode, x: number, yCenter: number) {
  node.x = x;
  node.y = yCenter - node.height / 2;

  if (node.children.length === 0) return;

  const childX = x + node.width + LEVEL_GAP_X;
  const totalH = node.children.reduce((s, c) => s + subtreeHeight(c), 0) + SIBLING_GAP_Y * (node.children.length - 1);
  let currentY = yCenter - totalH / 2;

  for (const child of node.children) {
    const sh = subtreeHeight(child);
    const childCenter = currentY + sh / 2;
    assignPositions(child, childX, childCenter);
    currentY += sh + SIBLING_GAP_Y;
  }
}

/** 收集所有节点 + 边 */
function flattenLayout(node: LayoutNode): { nodes: LayoutNode[]; edges: Array<{ from: LayoutNode; to: LayoutNode }> } {
  const nodes: LayoutNode[] = [node];
  const edges: Array<{ from: LayoutNode; to: LayoutNode }> = [];
  for (const child of node.children) {
    edges.push({ from: node, to: child });
    const sub = flattenLayout(child);
    nodes.push(...sub.nodes);
    edges.push(...sub.edges);
  }
  return { nodes, edges };
}

/** 计算 bounding box */
function boundingBox(nodes: LayoutNode[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x + n.width > maxX) maxX = n.x + n.width;
    if (n.y + n.height > maxY) maxY = n.y + n.height;
  }
  return { minX, minY, maxX, maxY };
}

/** 在布局树中查找指定 id 的节点 */
function findLayoutNode(node: LayoutNode, id: string): LayoutNode | null {
  if (node.id === id) return node;
  for (const child of node.children) {
    const found = findLayoutNode(child, id);
    if (found) return found;
  }
  return null;
}

/* ================================================================== */
/*  自绘 SVG 思维导图渲染器                                             */
/* ================================================================== */

function CustomMindmapRenderer({
  rootTitle,
  children: treeChildren,
  className,
  style,
}: {
  rootTitle: string;
  children: MindmapNode[];
  className?: string;
  style?: React.CSSProperties;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  // ★ 关键改动：初始只展开 root（只显示一级子节点）
  // 一级子节点自身不展开（不在 set 中），所以它们的 children 不会渲染
  const [expandedSet, setExpandedSet] = useState<Set<string>>(() => {
    const s = new Set<string>();
    s.add('root');
    return s;
  });
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const isAnimatingRef = useRef(false);
  // 用于追踪上次展开的节点ID，以便计算新布局后聚焦
  const pendingFocusRef = useRef<string | null>(null);

  // 当 treeChildren 变化时重置展开状态 — 同样只展开 root
  useEffect(() => {
    const s = new Set<string>();
    s.add('root');
    setExpandedSet(s);
    setTransform({ x: 0, y: 0, scale: 1 });
  }, [treeChildren]);

  const toggleNode = useCallback((id: string) => {
    setExpandedSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        // 收起时不需要聚焦
      } else {
        next.add(id);
        // 展开时标记需要聚焦
        pendingFocusRef.current = id;
      }
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
      width: measureText(rootTitle, FONT_SIZE_ROOT) + NODE_PAD_X * 2 + (treeChildren.length > 0 ? 32 : 0),
      height: NODE_H + 4,
      children: buildLayoutTree(treeChildren, 1, expandedSet, 'root'),
      expanded: true,
      hasChildren: treeChildren.length > 0,
    };

    assignPositions(rootNode, 0, 0);
    const { nodes, edges } = flattenLayout(rootNode);
    const bb = boundingBox(nodes);
    return { nodes, edges, bb, rootNode };
  }, [rootTitle, treeChildren, expandedSet]);

  const PADDING = 80;
  const svgWidth = layout.bb.maxX - layout.bb.minX + PADDING * 2;
  const svgHeight = layout.bb.maxY - layout.bb.minY + PADDING * 2;
  const offsetX = -layout.bb.minX + PADDING;
  const offsetY = -layout.bb.minY + PADDING;

  // ★ 展开后自动平移聚焦 — 只平移不缩放，保持用户当前视角大小
  useEffect(() => {
    const focusId = pendingFocusRef.current;
    if (!focusId || !containerRef.current) return;
    pendingFocusRef.current = null;

    const targetNode = findLayoutNode(layout.rootNode, focusId);
    if (!targetNode) return;

    const rect = containerRef.current.getBoundingClientRect();

    // 策略：将被点击节点放在视口左侧 1/3 处，纵向居中
    // 这样右侧 2/3 的空间自然展示展开的子节点
    const nodeCenterX = (targetNode.x + targetNode.width / 2 + offsetX);
    const nodeCenterY = (targetNode.y + targetNode.height / 2 + offsetY);

    // 保持当前缩放不变
    const currentScale = transform.scale;

    // 目标：让被点击节点在容器的左侧 30% 处、纵向居中
    const targetScreenX = rect.width * 0.30;
    const targetScreenY = rect.height * 0.50;

    const newX = targetScreenX - nodeCenterX * currentScale;
    const newY = targetScreenY - nodeCenterY * currentScale;

    isAnimatingRef.current = true;
    setTransform((t) => ({ ...t, x: newX, y: newY }));
    setTimeout(() => { isAnimatingRef.current = false; }, 500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, offsetX, offsetY]);

  // 鼠标拖拽平移
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, originX: transform.x, originY: transform.y };
  }, [transform.x, transform.y]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragRef.current) return;
    const { startX, startY, originX, originY } = dragRef.current;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    setTransform((t) => ({ ...t, x: originX + dx, y: originY + dy }));
  }, []);

  const handleMouseUp = useCallback(() => { dragRef.current = null; }, []);

  // 滚轮缩放
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.92 : 1.08;
    setTransform((t) => {
      const newScale = Math.min(2.5, Math.max(0.25, t.scale * delta));
      return { ...t, scale: newScale };
    });
  }, []);

  // 自适应居中
  const fitToView = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const scaleX = rect.width / svgWidth;
    const scaleY = rect.height / svgHeight;
    const scale = Math.min(scaleX, scaleY, 1) * 0.9;
    const x = (rect.width - svgWidth * scale) / 2;
    const y = (rect.height - svgHeight * scale) / 2;
    isAnimatingRef.current = true;
    setTransform({ x, y, scale });
    setTimeout(() => { isAnimatingRef.current = false; }, 500);
  }, [svgWidth, svgHeight]);

  // 初次渲染时自适应
  const initialFitDone = useRef(false);
  useEffect(() => {
    if (initialFitDone.current) return;
    initialFitDone.current = true;
    const timer = requestAnimationFrame(() => fitToView());
    return () => cancelAnimationFrame(timer);
  }, [fitToView]);

  // resize 监听
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (!isAnimatingRef.current) fitToView();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitToView]);

  // 全部展开 / 全部收起
  const expandAll = useCallback(() => {
    const s = new Set<string>();
    s.add('root');
    const addAll = (nodes: MindmapNode[], parentId: string) => {
      nodes.forEach((n, i) => {
        const id = `${parentId}-${i}`;
        if (Array.isArray(n.children) && n.children.length > 0) {
          s.add(id);
          addAll(n.children, id);
        }
      });
    };
    addAll(treeChildren, 'root');
    setExpandedSet(s);
    // 展开全部后，下一帧自适应
    requestAnimationFrame(() => fitToView());
  }, [treeChildren, fitToView]);

  const collapseAll = useCallback(() => {
    const s = new Set<string>();
    s.add('root');
    setExpandedSet(s);
    requestAnimationFrame(() => fitToView());
  }, [fitToView]);

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden ${className || ''}`}
      style={{ background: PALETTE.bg, cursor: dragRef.current ? 'grabbing' : 'grab', ...style }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
    >
      {/* 微网格装饰 */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.025]"
        style={{
          backgroundImage: `linear-gradient(${PALETTE.accent} 1px, transparent 1px), linear-gradient(90deg, ${PALETTE.accent} 1px, transparent 1px)`,
          backgroundSize: '48px 48px',
        }}
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
          transition: dragRef.current ? 'none' : 'transform 0.45s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
      >
        <defs>
          {/* 箭头标记 */}
          <filter id="node-shadow" x="-10%" y="-10%" width="120%" height="120%">
            <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor="#000" floodOpacity="0.25" />
          </filter>
        </defs>

        <g transform={`translate(${offsetX}, ${offsetY})`}>
          {/* 连线 — 贝塞尔曲线，颜色按子节点 depth */}
          {layout.edges.map((edge, i) => {
            const hue = getHueByDepth(edge.to.depth);
            const x1 = edge.from.x + edge.from.width;
            const y1 = edge.from.y + edge.from.height / 2;
            const x2 = edge.to.x;
            const y2 = edge.to.y + edge.to.height / 2;
            const cpOffset = Math.min(LEVEL_GAP_X * 0.55, Math.abs(x2 - x1) * 0.45);
            const d = `M ${x1} ${y1} C ${x1 + cpOffset} ${y1}, ${x2 - cpOffset} ${y2}, ${x2} ${y2}`;
            return (
              <path
                key={`edge-${i}`}
                d={d}
                fill="none"
                stroke={hue.line}
                strokeWidth={edge.from.depth === 0 ? 2.5 : 1.8}
                strokeLinecap="round"
                opacity={0.8}
              />
            );
          })}

          {/* 节点 */}
          {layout.nodes.map((node) => {
            const isRoot = node.depth === 0;
            const hue = getHueByDepth(node.depth);
            const fontSize = getFontSize(node.depth);
            const fontWeight = isRoot ? 700 : node.depth === 1 ? 600 : 500;
            const textColor = isRoot ? '#ffffff' : PALETTE.textPrimary;
            const rx = isRoot ? 14 : 10;
            const nodeContainsMath = hasMathSyntax(node.title);
            const expandBtnOffset = node.hasChildren ? 32 : 0;
            const textAreaX = node.x + NODE_PAD_X;
            const textAreaY = node.y + 2;
            const textAreaWidth = Math.max(8, node.width - NODE_PAD_X * 2 - expandBtnOffset);
            const textAreaHeight = Math.max(8, node.height - 4);

            return (
              <g key={node.id}>
                {/* 节点卡片背景 */}
                <rect
                  x={node.x}
                  y={node.y}
                  width={node.width}
                  height={node.height}
                  rx={rx}
                  ry={rx}
                  fill={isRoot ? hue.node : hue.nodeBg}
                  stroke={isRoot ? 'none' : `${hue.node}40`}
                  strokeWidth={1}
                  filter={isRoot ? 'url(#node-shadow)' : undefined}
                />

                {/* 根节点光晕 */}
                {isRoot && (
                  <rect
                    x={node.x - 2}
                    y={node.y - 2}
                    width={node.width + 4}
                    height={node.height + 4}
                    rx={rx + 2}
                    ry={rx + 2}
                    fill="none"
                    stroke={`${hue.node}30`}
                    strokeWidth={2}
                  />
                )}

                {/* 文字（含公式时启用 KaTeX 渲染） */}
                {nodeContainsMath ? (
                  <foreignObject
                    x={textAreaX}
                    y={textAreaY}
                    width={textAreaWidth}
                    height={textAreaHeight}
                    style={{ pointerEvents: 'none' }}
                  >
                    <MathLabel
                      content={node.title}
                      align={isRoot ? 'center' : 'left'}
                      color={textColor}
                      fontSize={fontSize}
                      fontWeight={fontWeight}
                    />
                  </foreignObject>
                ) : (
                  <text
                    x={node.x + (isRoot ? (node.width - (node.hasChildren ? 32 : 0)) / 2 : NODE_PAD_X)}
                    y={node.y + node.height / 2}
                    fontSize={fontSize}
                    fontWeight={fontWeight}
                    fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif"
                    fill={textColor}
                    dominantBaseline="central"
                    textAnchor={isRoot ? 'middle' : 'start'}
                    style={{ userSelect: 'none' }}
                  >
                    {node.title}
                  </text>
                )}

                {/* ★ 展开/收起按钮 — 对标 NotebookLM: 圆角方块 + > 箭头 */}
                {node.hasChildren && (
                  <g
                    style={{ cursor: 'pointer' }}
                    onClick={(e) => { e.stopPropagation(); toggleNode(node.id); }}
                  >
                    <rect
                      x={node.x + node.width - 28}
                      y={node.y + node.height / 2 - 11}
                      width={22}
                      height={22}
                      rx={6}
                      ry={6}
                      fill={node.expanded ? `${hue.expandBtn}25` : `${hue.expandBtn}12`}
                      stroke={`${hue.expandBtn}50`}
                      strokeWidth={1}
                    />
                    {/* > 或 v 箭头 */}
                    <path
                      d={node.expanded
                        ? `M ${node.x + node.width - 21} ${node.y + node.height / 2 - 3} l 4 4 l 4 -4`
                        : `M ${node.x + node.width - 20} ${node.y + node.height / 2 - 4} l 4 4 l -4 4`
                      }
                      fill="none"
                      stroke={hue.expandBtn}
                      strokeWidth={1.8}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity={0.85}
                    />
                  </g>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {/* 右下角控制面板 */}
      <div className="absolute bottom-3 right-3 z-10 flex flex-col items-center gap-1 rounded-xl p-1.5" style={{ background: `${PALETTE.bgSurface}ee`, border: `1px solid ${PALETTE.border}`, backdropFilter: 'blur(12px)' }}>
        {/* 缩放 */}
        <div className="flex items-center gap-1">
          {[
            { label: '+', action: () => setTransform((t) => ({ ...t, scale: Math.min(2.5, t.scale * 1.25) })), title: '放大' },
            { label: '\u2212', action: () => setTransform((t) => ({ ...t, scale: Math.max(0.25, t.scale * 0.8) })), title: '缩小' },
            { label: '⊡', action: fitToView, title: '适应窗口' },
          ].map((btn, i) => (
            <button
              key={i}
              type="button"
              onClick={btn.action}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-sm font-medium transition-colors hover:brightness-125"
              style={{ background: PALETTE.bgSurface, border: `1px solid ${PALETTE.border}`, color: PALETTE.textSecondary }}
              title={btn.title}
            >
              {btn.label}
            </button>
          ))}
        </div>
        {/* 全部展开/收起 */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={expandAll}
            className="flex h-7 items-center justify-center rounded-lg px-2 text-[11px] font-medium transition-colors hover:brightness-125"
            style={{ background: PALETTE.bgSurface, border: `1px solid ${PALETTE.border}`, color: PALETTE.textSecondary }}
            title="全部展开"
          >
            展开
          </button>
          <button
            type="button"
            onClick={collapseAll}
            className="flex h-7 items-center justify-center rounded-lg px-2 text-[11px] font-medium transition-colors hover:brightness-125"
            style={{ background: PALETTE.bgSurface, border: `1px solid ${PALETTE.border}`, color: PALETTE.textSecondary }}
            title="全部收起"
          >
            收起
          </button>
        </div>
      </div>

      {/* 底部提示 */}
      <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2">
        <p className="rounded-full px-3 py-1 text-[11px] backdrop-blur-md" style={{ background: `${PALETTE.bgSurface}cc`, border: `1px solid ${PALETTE.border}`, color: PALETTE.textMuted }}>
          滚轮缩放 · 拖拽平移 · 点击节点 ▸ 展开下一层
        </p>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  大纲模式 — 深色主题递归树                                           */
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
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = Array.isArray(node.children) && node.children.length > 0;
  const hue = DEPTH_HUES[depth % DEPTH_HUES.length];

  const matchCard = cards.find((c) => c.title === node.title && c.citations?.[0]);
  const citation = matchCard?.citations?.[0];

  const fontSizes = ['14px', '13px', '13px', '12px', '12px'];
  const fontWeights = ['600', '500', '500', '400', '400'];
  const fontSize = fontSizes[Math.min(depth, fontSizes.length - 1)];
  const fontWeight = fontWeights[Math.min(depth, fontWeights.length - 1)];
  const nodeContainsMath = hasMathSyntax(node.title);

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
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition-all duration-200" style={{ background: expanded ? `${hue.node}20` : 'transparent', color: hue.node }}>
            <svg className="h-3 w-3 transition-transform duration-200" style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </span>
        ) : (
          <span className="mt-2 flex h-2 w-2 shrink-0"><span className="block h-1.5 w-1.5 rounded-full" style={{ background: hue.node, opacity: 0.6 }} /></span>
        )}
        <span className="flex-1 leading-relaxed" style={{ color: depth === 0 ? PALETTE.textPrimary : PALETTE.textSecondary, fontSize, fontWeight }}>
          {nodeContainsMath ? (
            <MathLabel
              content={node.title}
              align="left"
              color={depth === 0 ? PALETTE.textPrimary : PALETTE.textSecondary}
              fontSize={fontSize}
              fontWeight={fontWeight}
            />
          ) : (
            node.title
          )}
        </span>
        {citation ? (
          <span className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
            <EvidenceChip citation={citation} transcript={transcript} onSeek={onSeek} />
          </span>
        ) : null}
      </div>
      {hasChildren && expanded ? (
        <div className="animate-fade-in" style={{ borderLeft: `2px solid ${hue.node}25`, marginLeft: 10, paddingLeft: 8 }}>
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

export function MindmapWindow({ result, transcript, onSeek }: MindmapWindowProps) {
  const { root, children, markdown } = useMemo(() => normalizePayload(result), [result]);
  const [viewMode, setViewMode] = useState<ViewMode>('mindmap');
  const [copyFeedback, setCopyFeedback] = useState(false);

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

  return (
    <section className="flex h-full flex-col gap-0 animate-fade-in" data-testid="mindmap-window">
      {/* 顶部工具栏 */}
      <header className="flex items-center justify-between px-4 py-2.5" style={{ background: PALETTE.bgToolbar, borderBottom: `1px solid ${PALETTE.border}`, borderRadius: '12px 12px 0 0' }}>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-0.5 rounded-lg p-0.5" style={{ background: PALETTE.bgSurface }}>
            {(['mindmap', 'outline'] as const).map((mode) => {
              const isActive = viewMode === mode;
              const label = mode === 'mindmap' ? '导图' : '大纲';
              const icon = mode === 'mindmap' ? (
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 3.75H6A2.25 2.25 0 003.75 6v1.5M16.5 3.75H18A2.25 2.25 0 0120.25 6v1.5m0 9V18A2.25 2.25 0 0118 20.25h-1.5m-9 0H6A2.25 2.25 0 013.75 18v-1.5" /></svg>
              ) : (
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" /></svg>
              );
              return (
                <button key={mode} type="button" onClick={() => setViewMode(mode)} className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-200" style={{ background: isActive ? PALETTE.accent : 'transparent', color: isActive ? '#fff' : PALETTE.textSecondary, boxShadow: isActive ? `0 2px 8px ${PALETTE.accent}40` : 'none' }}>
                  {icon}{label}
                </button>
              );
            })}
          </div>
          <div className="hidden items-center gap-2 text-xs sm:flex" style={{ color: PALETTE.textMuted }}>
            <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: DEPTH_HUES[0].node }} />{children.length} 个分支</span>
            <span style={{ color: PALETTE.border }}>·</span>
            <span>{totalNodes} 个节点</span>
            <span style={{ color: PALETTE.border }}>·</span>
            <span>{treeDepthValue} 层</span>
          </div>
        </div>
        <button type="button" onClick={handleCopyOutline} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all duration-200" style={{ border: `1px solid ${PALETTE.border}`, background: 'transparent', color: copyFeedback ? '#26de81' : PALETTE.textSecondary }} title="复制文本大纲到剪贴板">
          {copyFeedback ? (
            <><svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>已复制</>
          ) : (
            <><svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" /></svg>复制</>
          )}
        </button>
      </header>

      {/* 内容区 */}
      {viewMode === 'mindmap' ? (
        <CustomMindmapRenderer rootTitle={root} className="min-h-0 flex-1" style={{ borderRadius: '0 0 12px 12px', border: `1px solid ${PALETTE.border}`, borderTop: 'none' }}>
          {children}
        </CustomMindmapRenderer>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-4 md:p-5" style={{ background: PALETTE.bg, borderRadius: '0 0 12px 12px', border: `1px solid ${PALETTE.border}`, borderTop: 'none' }}>
          <div className="mb-4 flex items-center gap-3 pb-3" style={{ borderBottom: `1px solid ${PALETTE.border}` }}>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: `${PALETTE.accent}18` }}>
              <svg className="h-4 w-4" style={{ color: PALETTE.accent }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 3.75H6A2.25 2.25 0 003.75 6v1.5M16.5 3.75H18A2.25 2.25 0 0120.25 6v1.5m0 9V18A2.25 2.25 0 0118 20.25h-1.5m-9 0H6A2.25 2.25 0 013.75 18v-1.5" /></svg>
            </span>
            <h2 className="text-lg font-semibold" style={{ color: PALETTE.textPrimary }}>
              {hasMathSyntax(root) ? (
                <MathLabel content={root} align="left" color={PALETTE.textPrimary} fontSize={18} fontWeight={600} />
              ) : (
                root
              )}
            </h2>
          </div>
          <div className="space-y-0.5">
            {children.map((child, index) => (
              <OutlineNode key={`${child.title}-${index}`} node={child} depth={0} transcript={transcript} cards={result?.cards || []} onSeek={onSeek} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
