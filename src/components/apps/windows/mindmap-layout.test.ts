import { describe, it, expect } from 'vitest';
import {
  getHueByDepth,
  measureText,
  compactVisualLabel,
  getFontSize,
  buildLayoutTree,
  subtreeHeight,
  assignPositions,
  flattenLayout,
  boundingBox,
  findLayoutNode,
  PALETTE,
  DEPTH_HUES,
  NODE_H,
  FONT_SIZE_ROOT,
  FONT_SIZE_L1,
  FONT_SIZE_OTHER,
} from './mindmap-layout';

// ── getHueByDepth ──────────────────────────────────────────────────

describe('getHueByDepth', () => {
  it('depth 0 返回 accent 颜色', () => {
    const hue = getHueByDepth(0);
    expect(hue.node).toBe(PALETTE.accent);
  });

  it('depth 1 返回 DEPTH_HUES[0]', () => {
    const hue = getHueByDepth(1);
    expect(hue.node).toBe(DEPTH_HUES[0].node);
  });

  it('超出 DEPTH_HUES 长度时循环', () => {
    const hue = getHueByDepth(DEPTH_HUES.length + 1);
    expect(hue.node).toBe(DEPTH_HUES[0].node);
  });
});

// ── measureText ────────────────────────────────────────────────────

describe('measureText', () => {
  it('纯 ASCII 文本', () => {
    const width = measureText('Hello', 14);
    // 5 chars × 14 × 0.58 = 40.6 → 41
    expect(width).toBe(41);
  });

  it('纯中文文本', () => {
    const width = measureText('你好', 14);
    // 2 chars × 14 × 1.05 = 29.4 → 30
    expect(width).toBe(30);
  });

  it('空字符串返回 0', () => {
    expect(measureText('', 14)).toBe(0);
  });

  it('中英混合文本', () => {
    const width = measureText('AI学习', 14);
    // A: 14 × 0.58 = 8.12
    // I: 14 × 0.58 = 8.12
    // 学: 14 × 1.05 = 14.7
    // 习: 14 × 1.05 = 14.7
    // total = 45.64 → 46
    expect(width).toBe(46);
  });
});

describe('compactVisualLabel', () => {
  it('保留本来就能放下的标签', () => {
    expect(compactVisualLabel('核心概念', 14, 120)).toBe('核心概念');
  });

  it('长标签也保留完整内容，不用省略号制造信息缺口', () => {
    const label = '这是一段会把整张思维导图横向撑得很宽的完整解释';
    expect(compactVisualLabel(label, 14, 120)).toBe(label);
  });
});

// ── getFontSize ────────────────────────────────────────────────────

describe('getFontSize', () => {
  it('depth 0 → FONT_SIZE_ROOT', () => expect(getFontSize(0)).toBe(FONT_SIZE_ROOT));
  it('depth 1 → FONT_SIZE_L1', () => expect(getFontSize(1)).toBe(FONT_SIZE_L1));
  it('depth 2+ → FONT_SIZE_OTHER', () => {
    expect(getFontSize(2)).toBe(FONT_SIZE_OTHER);
    expect(getFontSize(5)).toBe(FONT_SIZE_OTHER);
  });
});

// ── buildLayoutTree + subtreeHeight + assignPositions ───────────────

describe('buildLayoutTree', () => {
  const simpleNodes = [
    { title: '根节点', children: [
      { title: '子A', children: [] },
      { title: '子B', children: [] },
    ]},
  ];

  it('正确构建树结构', () => {
    const expanded = new Set(['root-0']); // 展开根节点
    const tree = buildLayoutTree(simpleNodes as any, 0, expanded, 'root');
    expect(tree).toHaveLength(1);
    expect(tree[0].title).toBe('根节点');
    expect(tree[0].fullTitle).toBe('根节点');
    expect(tree[0].depth).toBe(0);
    expect(tree[0].children).toHaveLength(2);
    expect(tree[0].children[0].title).toBe('子A');
    expect(tree[0].children[0].depth).toBe(1);
  });

  it('长节点在画布和数据中都保留完整标题', () => {
    const fullTitle = '应用建议：建立情绪映射，当听到 calm down 和 confused 时反向检索语境';
    const tree = buildLayoutTree([{ title: fullTitle, children: [] }] as any, 1, new Set(), 'root');
    expect(tree[0].title).toBe(fullTitle);
    expect(tree[0].fullTitle).toBe(fullTitle);
  });

  it('未展开时没有子节点', () => {
    const expanded = new Set<string>();
    const tree = buildLayoutTree(simpleNodes as any, 0, expanded, 'root');
    expect(tree[0].children).toHaveLength(0);
    expect(tree[0].hasChildren).toBe(true);
  });

  it('叶子节点的 subtreeHeight 等于 NODE_H', () => {
    const leaf = buildLayoutTree([{ title: '叶子', children: [] }] as any, 0, new Set(), 'r')[0];
    expect(subtreeHeight(leaf)).toBe(NODE_H);
  });
});

// ── assignPositions ────────────────────────────────────────────────

describe('assignPositions', () => {
  it('赋值坐标后 x/y 不为 0（根节点除外）', () => {
    const nodes = [{ title: 'Root', children: [{ title: 'A', children: [] }] }];
    const tree = buildLayoutTree(nodes as any, 0, new Set(['r-0']), 'r');
    const root = tree[0];
    assignPositions(root, 50, 200);
    expect(root.x).toBe(50);
    expect(root.children[0].x).toBeGreaterThan(50);
  });
});

// ── flattenLayout ──────────────────────────────────────────────────

describe('flattenLayout', () => {
  it('收集所有节点和边', () => {
    const nodes = [{ title: 'Root', children: [{ title: 'A', children: [] }, { title: 'B', children: [] }] }];
    const tree = buildLayoutTree(nodes as any, 0, new Set(['r-0']), 'r');
    const { nodes: flat, edges } = flattenLayout(tree[0]);
    expect(flat).toHaveLength(3); // Root + A + B
    expect(edges).toHaveLength(2); // Root→A, Root→B
  });
});

// ── boundingBox ────────────────────────────────────────────────────

describe('boundingBox', () => {
  it('计算正确的包围盒', () => {
    const nodes = [
      { x: 10, y: 20, width: 100, height: 40 },
      { x: 200, y: 50, width: 80, height: 40 },
    ] as any[];
    const box = boundingBox(nodes);
    expect(box.minX).toBe(10);
    expect(box.minY).toBe(20);
    expect(box.maxX).toBe(280); // 200 + 80
    expect(box.maxY).toBe(90);  // 50 + 40
  });
});

// ── findLayoutNode ─────────────────────────────────────────────────

describe('findLayoutNode', () => {
  it('找到根节点', () => {
    const nodes = [{ title: 'Root', children: [{ title: 'A', children: [] }] }];
    const tree = buildLayoutTree(nodes as any, 0, new Set(['r-0']), 'r');
    const found = findLayoutNode(tree[0], 'r-0');
    expect(found).not.toBeNull();
    expect(found!.title).toBe('Root');
  });

  it('找到子节点', () => {
    const nodes = [{ title: 'Root', children: [{ title: 'Child', children: [] }] }];
    const tree = buildLayoutTree(nodes as any, 0, new Set(['r-0']), 'r');
    const found = findLayoutNode(tree[0], 'r-0-0');
    expect(found).not.toBeNull();
    expect(found!.title).toBe('Child');
  });

  it('找不到返回 null', () => {
    const nodes = [{ title: 'Root', children: [] }];
    const tree = buildLayoutTree(nodes as any, 0, new Set(), 'r');
    expect(findLayoutNode(tree[0], 'nonexistent')).toBeNull();
  });
});
