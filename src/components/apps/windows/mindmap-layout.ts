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
//
// v7：思维导图不是七彩气球，是老师在卷子上画的层级标注。
// 双签名色家族 + 暖纸感深底（不是冷蓝紫），让节点像"知识在被理解"的过程。
//

export const PALETTE = {
  bg: '#1A1612',           // v7：暗夜书房深棕墨黑（不再是冷蓝紫）
  bgSurface: '#241F1A',
  bgToolbar: '#1F1B16',
  border: '#2A241D',
  textPrimary: '#F2EDE3',
  textSecondary: '#B8B0A2',
  textMuted: '#82796D',
  accent: '#6B9080',       // v7：浅松绿（暗色态 pine 主签名）
};

/**
 * v7 双签名色家族化层级调色板
 *
 * 设计原则：
 *  - 主分支（奇数 depth）= pine 系（沉淀 / 主线）
 *  - 副分支（偶数 depth）= vermilion 系（标注 / 此刻）
 *  - 越深越浅：让眼睛能识别"主干 vs 细枝"
 *  - 颜色家族化（不再彩虹）：知识结构本就是单一主题的细分，色彩应顺应这个语义
 */
export const DEPTH_HUES = [
  { node: '#2D4F3E', nodeBg: 'rgba(45,79,62,0.14)',  line: 'rgba(45,79,62,0.55)',  expandBtn: '#2D4F3E' },  // depth 1: pine 主分支
  { node: '#B5483C', nodeBg: 'rgba(181,72,60,0.14)', line: 'rgba(181,72,60,0.55)', expandBtn: '#B5483C' },  // depth 2: vermilion 标注
  { node: '#6B9080', nodeBg: 'rgba(107,144,128,0.14)', line: 'rgba(107,144,128,0.50)', expandBtn: '#6B9080' }, // depth 3: pine-light
  { node: '#D17969', nodeBg: 'rgba(209,121,105,0.14)', line: 'rgba(209,121,105,0.50)', expandBtn: '#D17969' }, // depth 4: vermilion-light
  { node: '#1A3327', nodeBg: 'rgba(26,51,39,0.14)',    line: 'rgba(26,51,39,0.50)',    expandBtn: '#1A3327' }, // depth 5: pine-deep
  { node: '#8E3328', nodeBg: 'rgba(142,51,40,0.14)',   line: 'rgba(142,51,40,0.50)',   expandBtn: '#8E3328' }, // depth 6: vermilion-deep
  { node: '#5C5A55', nodeBg: 'rgba(92,90,85,0.14)',    line: 'rgba(92,90,85,0.50)',    expandBtn: '#5C5A55' }, // depth 7: ink-secondary（细枝）
  { node: '#8E8B82', nodeBg: 'rgba(142,139,130,0.14)', line: 'rgba(142,139,130,0.40)', expandBtn: '#8E8B82' }, // depth 8: ink-muted（最末端）
];

// ── Pure helpers ───────────────────────────────────────────────────

/** 根据 depth 获取色调 */
export function getHueByDepth(depth: number) {
  if (depth === 0) {
    // 根节点：pine 主签名色实底
    return {
      node: '#2D4F3E',
      nodeBg: 'rgba(45,79,62,0.22)',
      line: 'rgba(45,79,62,0.55)',
      expandBtn: '#2D4F3E',
    };
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
