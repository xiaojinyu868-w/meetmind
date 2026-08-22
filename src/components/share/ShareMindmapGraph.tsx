'use client';

/**
 * ShareMindmapGraph — 分享页用的静态思维导图（只读，全展开）。
 *
 * 复用 MindmapWindow 的布局引擎与视觉语言（米白纸 + 文字坐在墨线上 +
 * 根节点墨绿胶囊 + 主干分色贝塞尔连线），但不带缩放/平移/折叠交互：
 * 分享页的第一眼就是整张图本身。
 */

import * as React from 'react';
import { markdownToTree, type MindmapNode } from '@/lib/ai-native/plugins/mindmap-tree';
import {
  assignPositions,
  boundingBox,
  branchIndexOf,
  buildLayoutTree,
  flattenLayout,
  FONT_SIZE_ROOT,
  getBranchHue,
  getFontSize,
  LEVEL_GAP_X,
  measureText,
  NODE_PAD_X,
  PALETTE,
  type LayoutNode,
} from '@/components/apps/windows/mindmap-layout';

interface ShareMindmapPayload {
  root?: string;
  children?: Array<{ title?: string; label?: string; children?: unknown }>;
  branches?: Array<{ title?: string; label?: string; children?: unknown }>;
  markdown?: string;
}

function toMindmapNodes(raw: unknown): MindmapNode[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const value = item as { title?: unknown; label?: unknown; children?: unknown };
    const title = (typeof value.title === 'string' ? value.title : typeof value.label === 'string' ? value.label : '').trim();
    if (!title) return [];
    const children = toMindmapNodes(value.children);
    return [{ title, ...(children.length > 0 ? { children } : {}) }];
  });
}

function fullExpandedSet(treeChildren: MindmapNode[]): Set<string> {
  const set = new Set<string>(['root']);
  const walk = (nodes: MindmapNode[], parentId: string) => {
    nodes.forEach((node, index) => {
      const id = `${parentId}-${index}`;
      if (Array.isArray(node.children) && node.children.length > 0) {
        set.add(id);
        walk(node.children, id);
      }
    });
  };
  walk(treeChildren, 'root');
  return set;
}

const FONT_FAMILY = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif";

export function ShareMindmapGraph({ payload }: { payload: ShareMindmapPayload }) {
  const layout = React.useMemo(() => {
    let rootTitle = (payload.root ?? '').trim();
    let treeChildren = toMindmapNodes(payload.children ?? payload.branches);
    if (treeChildren.length === 0 && payload.markdown?.trim()) {
      const parsed = markdownToTree(payload.markdown);
      if (!rootTitle) rootTitle = parsed.root;
      treeChildren = parsed.children;
    }
    if (treeChildren.length === 0) return null;
    if (!rootTitle) rootTitle = '思维导图';

    const expanded = fullExpandedSet(treeChildren);
    const rootNode: LayoutNode = {
      id: 'root',
      title: rootTitle,
      fullTitle: rootTitle,
      depth: 0,
      x: 0,
      y: 0,
      width: measureText(rootTitle, FONT_SIZE_ROOT) + NODE_PAD_X * 2,
      height: 40,
      children: buildLayoutTree(treeChildren, 1, expanded, 'root'),
      expanded: true,
      hasChildren: treeChildren.length > 0,
    };
    assignPositions(rootNode, 0, 0);
    const { nodes, edges } = flattenLayout(rootNode);
    return { nodes, edges, bb: boundingBox(nodes) };
  }, [payload]);

  if (!layout) return null;

  const PADDING = 40;
  const svgWidth = layout.bb.maxX - layout.bb.minX + PADDING * 2;
  const svgHeight = layout.bb.maxY - layout.bb.minY + PADDING * 2;
  const offsetX = -layout.bb.minX + PADDING;
  const offsetY = -layout.bb.minY + PADDING;

  const underlineY = (node: LayoutNode) => node.y + node.height - 7;
  const textBaselineY = (node: LayoutNode) => node.y + node.height - 12;
  const nodeTextWidth = (node: LayoutNode) => measureText(node.title, getFontSize(node.depth));

  return (
    <div
      className="max-h-[560px] overflow-auto rounded-xl"
      style={{ background: PALETTE.bg, border: `1px solid ${PALETTE.border}` }}
    >
      <svg
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        style={{ width: '100%', height: 'auto', display: 'block' }}
        role="img"
        aria-label="思维导图"
      >
        <g transform={`translate(${offsetX}, ${offsetY})`}>
          {/* 连线：颜色随子节点所属主干 */}
          {layout.edges.map((edge, index) => {
            const hue = getBranchHue(branchIndexOf(edge.to.id));
            const fromRoot = edge.from.depth === 0;
            const x1 = fromRoot ? edge.from.x + edge.from.width : edge.from.x + nodeTextWidth(edge.from) + 6;
            const y1 = fromRoot ? edge.from.y + edge.from.height / 2 : underlineY(edge.from);
            const x2 = edge.to.x;
            const y2 = underlineY(edge.to);
            const cpOffset = Math.max(18, Math.min(LEVEL_GAP_X * 0.6, Math.abs(x2 - x1) * 0.5));
            const d = `M ${x1} ${y1} C ${x1 + cpOffset} ${y1}, ${x2 - cpOffset} ${y2}, ${x2} ${y2}`;
            return (
              <path
                key={`edge-${index}`}
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
            const hue = getBranchHue(branchIndexOf(node.id));
            const fontSize = getFontSize(node.depth);
            const fontWeight = isRoot ? 700 : node.depth === 1 ? 650 : 500;
            const tw = nodeTextWidth(node);

            if (isRoot) {
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
                    fontFamily={FONT_FAMILY}
                    dominantBaseline="central"
                    textAnchor="middle"
                    style={{ fill: '#FFFFFF', userSelect: 'none' }}
                  >
                    {node.title}
                  </text>
                </g>
              );
            }

            return (
              <g key={node.id}>
                <title>{node.fullTitle}</title>
                <text
                  x={node.x}
                  y={textBaselineY(node)}
                  fontSize={fontSize}
                  fontWeight={fontWeight}
                  fontFamily={FONT_FAMILY}
                  fill={hue.text}
                  dominantBaseline="alphabetic"
                  textAnchor="start"
                  style={{ userSelect: 'none' }}
                >
                  {node.title}
                </text>
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
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

export default ShareMindmapGraph;
