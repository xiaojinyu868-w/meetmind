/**
 * Mindmap layout engine — computes x/y positions for each node in a tree.
 *
 * Pure functions, no React dependency.
 */
import type { MindmapNode } from '@/lib/ai-native/plugins/mindmap.plugin';

// ── Types ──────────────────────────────────────────────────────────

export interface LayoutNode {
  id: string;
  /** 画布上显示的短标签。完整内容保留在 fullTitle，并可在大纲中阅读。 */
  title: string;
  fullTitle: string;
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
//
// 节点不再是填色方块，而是"文字坐在一条墨线上"（朱批红笔的手感）。
// 高度 = 文字行高 + 下划线留白；宽度在 buildLayoutTree 里按文字实测。
//

export const NODE_H = 38;
export const NODE_PAD_X = 18;
export const LEVEL_GAP_X = 58;
export const SIBLING_GAP_Y = 16;
export const FONT_SIZE_ROOT = 16;
export const FONT_SIZE_L1 = 15;
export const FONT_SIZE_OTHER = 14;
/** 有子节点时，节点右侧为折叠点位预留的空间 */
export const MARKER_RESERVE = 22;

// ── Theme / palette ────────────────────────────────────────────────
//
// v7：思维导图坐落在米白纸感的复习工作区里，不该是一块突兀的深色画布。
// 整张图就是"老师在卷子上画的层级标注"——纸是米白，线是双签名色墨水。
// 视觉为可读性让路：节点用文字 + 一道墨线，而不是七彩气球填色方块。
//

export const PALETTE = {
  bg: '#FCFAF6',           // v7：近白米纸（比 paper 再亮一点，承托墨线）
  bgSurface: '#FFFFFF',
  bgToolbar: '#FAF7F2',    // paper
  border: '#E8E2D5',       // v7 divider
  textPrimary: '#1C1B19',  // ink
  textSecondary: '#5C5A55',// ink-secondary
  textMuted: '#8E8B82',    // ink-muted
  accent: '#2D4F3E',       // v7：墨松绿主签名（pine）
};

// ── 按主干分配色（豆包式可读性的真正来源：一眼看出"我在哪条主干"）──────
//
// 每条一级主干 + 它的整棵子树共享一种色，而不是按 depth 彩虹切换。
// 全部取自 v7 双签名色家族（pine / vermilion）+ 克制的墨灰，绝不引入蓝紫。
// 顺序刻意 pine→vermilion 交替，让相邻主干天然区分。
//

export interface BranchHue {
  /** 连线 + 下划线墨色 */
  line: string;
  /** 文字色（在米白纸上保证对比度，比 line 更沉） */
  text: string;
  /** 折叠点位描边 */
  marker: string;
}

// 思维导图按主干配色：用多种可区分的颜色（豆包式），一眼分辨"我在哪条主干"。
// 这是为可读性服务的刻意选择——不是七彩气球，而是一组经过收敛的"墨水盒"色：
// 略低饱和、在米白纸上对比清晰，line 用于连线/下划线，text 取更沉的同色保证可读。
export const BRANCH_HUES: BranchHue[] = [
  { line: '#2F7D5B', text: '#1F5A3F', marker: '#2F7D5B' }, // 松绿
  { line: '#C2832E', text: '#8A5D1C', marker: '#C2832E' }, // 琥珀
  { line: '#3A78B5', text: '#2A5687', marker: '#3A78B5' }, // 墨蓝
  { line: '#C24E3F', text: '#8E3328', marker: '#C24E3F' }, // 朱红
  { line: '#7E5DA8', text: '#5A3F7D', marker: '#7E5DA8' }, // 紫
  { line: '#2E8C9E', text: '#1F6675', marker: '#2E8C9E' }, // 青
  { line: '#BC5A8C', text: '#8E3D66', marker: '#BC5A8C' }, // 品红
  { line: '#7E8A3C', text: '#5A6328', marker: '#7E8A3C' }, // 橄榄
];

/** 按一级主干序号取色（整棵子树同色），根节点用墨松绿主签名 */
export function getBranchHue(branchIndex: number): BranchHue {
  if (branchIndex < 0) {
    return { line: '#2D4F3E', text: '#1C1B19', marker: '#2D4F3E' };
  }
  return BRANCH_HUES[branchIndex % BRANCH_HUES.length];
}

/** 从节点 id（形如 root-2-0-1）解析它所属的一级主干序号；根节点返回 -1 */
export function branchIndexOf(id: string): number {
  const parts = id.split('-');
  if (parts.length < 2) return -1;
  const idx = Number(parts[1]);
  return Number.isFinite(idx) ? idx : -1;
}

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

/**
 * 思维导图是“定位地图”，不是把整段笔记横着铺进 SVG。
 * 这里只裁剪画布标签，数据与大纲仍保留完整标题；按估算像素而不是中英文字符数裁剪，
 * 避免英文节点特别宽、中文节点又被裁得过短。
 */
export function compactVisualLabel(text: string, fontSize: number, maxWidth = 260): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized || measureText(normalized, fontSize) <= maxWidth) return normalized;

  const suffix = '…';
  let result = '';
  for (const char of normalized) {
    if (measureText(`${result}${char}${suffix}`, fontSize) > maxWidth) break;
    result += char;
  }
  return `${result.trimEnd()}${suffix}`;
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
    const fullTitle = node.title.replace(/\s+/g, ' ').trim();
    const title = compactVisualLabel(fullTitle, fontSize, depth <= 1 ? 230 : 270);
    const textW = measureText(title, fontSize);
    const hasChildren = Array.isArray(node.children) && node.children.length > 0;
    // 文字坐在墨线上：宽度 = 文字宽 + 少量右侧留白（有子节点时给折叠点位让位）
    const width = textW + 6 + (hasChildren ? MARKER_RESERVE : 0);
    const height = NODE_H;
    const expanded = expandedSet.has(id);

    const childLayouts =
      hasChildren && expanded
        ? buildLayoutTree(node.children!, depth + 1, expandedSet, id)
        : [];

    return { id, title, fullTitle, depth, x: 0, y: 0, width, height, children: childLayouts, expanded, hasChildren };
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
