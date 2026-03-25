/**
 * Mindmap layout engine — computes x/y positions for each node in a tree.
 *
 * Pure functions, no React dependency.
 */
import type { MindmapNode } from '@/lib/ai-native/plugins/mindmap.plugin';

// ── Types ──────────────────────────────────────────────────────────

export interface LayoutNode {
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

// ── Layout constants ───────────────────────────────────────────────

export const NODE_H = 40;
export const NODE_PAD_X = 20;
export const LEVEL_GAP_X = 70;
export const SIBLING_GAP_Y = 12;
export const FONT_SIZE_ROOT = 15;
export const FONT_SIZE_L1 = 14;
export const FONT_SIZE_OTHER = 13;

// ── Theme / palette ────────────────────────────────────────────────

export const PALETTE = {
  bg: '#1b1d2a',
  bgSurface: '#242638',
  bgToolbar: '#1e2030',
  border: '#2e3148',
  textPrimary: '#eaedf3',
  textSecondary: '#a0a3bd',
  textMuted: '#6c6f8a',
  accent: '#7c6ef0',
};

export const DEPTH_HUES = [
  { node: '#7c6ef0', nodeBg: 'rgba(124,110,240,0.14)', line: 'rgba(124,110,240,0.50)', expandBtn: '#7c6ef0' },
  { node: '#59a5f5', nodeBg: 'rgba(89,165,245,0.14)',  line: 'rgba(89,165,245,0.50)',  expandBtn: '#59a5f5' },
  { node: '#4ecdc4', nodeBg: 'rgba(78,205,196,0.14)',  line: 'rgba(78,205,196,0.50)',  expandBtn: '#4ecdc4' },
  { node: '#f7b731', nodeBg: 'rgba(247,183,49,0.14)',  line: 'rgba(247,183,49,0.50)',  expandBtn: '#f7b731' },
  { node: '#fc5c65', nodeBg: 'rgba(252,92,101,0.14)',  line: 'rgba(252,92,101,0.50)',  expandBtn: '#fc5c65' },
  { node: '#a55eea', nodeBg: 'rgba(165,94,234,0.14)',  line: 'rgba(165,94,234,0.50)',  expandBtn: '#a55eea' },
  { node: '#26de81', nodeBg: 'rgba(38,222,129,0.14)',  line: 'rgba(38,222,129,0.50)',  expandBtn: '#26de81' },
  { node: '#fd9644', nodeBg: 'rgba(253,150,68,0.14)',  line: 'rgba(253,150,68,0.50)',  expandBtn: '#fd9644' },
];

// ── Pure helpers ───────────────────────────────────────────────────

/** 根据 depth 获取色调 */
export function getHueByDepth(depth: number) {
  if (depth === 0) {
    return { node: PALETTE.accent, nodeBg: 'rgba(124,110,240,0.22)', line: 'rgba(124,110,240,0.55)', expandBtn: PALETTE.accent };
  }
  return DEPTH_HUES[(depth - 1) % DEPTH_HUES.length];
}

/** 估算文字渲染宽度 */
export function measureText(text: string, fontSize: number): number {
  let w = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    w += code > 0x7f ? fontSize * 1.05 : fontSize * 0.58;
  }
  return Math.ceil(w);
}

export function getFontSize(depth: number): number {
  if (depth === 0) return FONT_SIZE_ROOT;
  if (depth === 1) return FONT_SIZE_L1;
  return FONT_SIZE_OTHER;
}

/** 递归构建 LayoutNode 树 */
export function buildLayoutTree(
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
export function subtreeHeight(node: LayoutNode): number {
  if (node.children.length === 0) return node.height;
  const sum = node.children.reduce((s, c) => s + subtreeHeight(c), 0) + SIBLING_GAP_Y * (node.children.length - 1);
  return Math.max(node.height, sum);
}

/** 递归赋坐标 */
export function assignPositions(node: LayoutNode, x: number, yCenter: number) {
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
export function flattenLayout(node: LayoutNode): { nodes: LayoutNode[]; edges: Array<{ from: LayoutNode; to: LayoutNode }> } {
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
export function boundingBox(nodes: LayoutNode[]): { minX: number; minY: number; maxX: number; maxY: number } {
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
export function findLayoutNode(node: LayoutNode, id: string): LayoutNode | null {
  if (node.id === id) return node;
  for (const child of node.children) {
    const found = findLayoutNode(child, id);
    if (found) return found;
  }
  return null;
}
