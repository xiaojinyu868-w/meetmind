/**
 * layout-critic —— 渲染后的「代码版 Critic」：文字框重叠就把后画的挪开。
 *
 * Code2Video / TheoremExplainAgent 都发现 AI 生成教学动画的头号顽疾是元素重叠（Element Layout ≈ 0.6），
 * 人对哪怕一瞬间的遮挡都极敏感。他们用 VLM 看图再改，一轮几十秒；我们的图是自己算出来的，
 * 文字框可以直接估（中文 1 em / 西文 0.56 em 宽，1.2 em 高），重叠在 Worker 里毫秒级解掉，不进关键路径。
 *
 * 只动 <text>（数据本身不能动：点线圆的位置是数学）；网格刻度（data-draw="fade"）与 defs 里的不碰。
 * 策略：按文档顺序两两比较，重叠时挪**后画的**那个——沿重叠更小的那个轴推开、加 4px 呼吸；最多 6 轮。
 */

import { parseMarkup, serializeNodes, type MarkupNode } from './timeline';

interface TextBox {
  node: MarkupNode;
  /** 能不能挪：网格刻度、坐标轴名、defs 里的不动，但它们是障碍 */
  movable: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 中心坐标 */
  cx: number;
  cy: number;
}

const CJK = /[\u3000-\u9fff\uff00-\uffef]/;

export function estimateTextWidth(text: string, fontSize: number): number {
  let w = 0;
  for (const ch of text) w += CJK.test(ch) ? fontSize : fontSize * 0.56;
  return w;
}

function collect(nodes: MarkupNode[], out: TextBox[], fixed: boolean): void {
  for (const n of nodes) {
    const tag = n.tag;
    if (tag === 'defs' || tag === 'marker') continue;
    const fixedHere = fixed || n.attrs['data-draw'] === 'fade' || n.attrs.id === 'axes' || n.attrs['data-name'] === 'axes';
    if (tag === 'text' && n.attrs.x !== undefined && n.attrs.y !== undefined && n.text.trim()) {
      const fs = Number(n.attrs['font-size'] ?? 16);
      const w = estimateTextWidth(n.text, fs);
      const h = fs * 1.2;
      const x = Number(n.attrs.x);
      const y = Number(n.attrs.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const anchor = n.attrs['text-anchor'] ?? 'start';
      const baseline = n.attrs['dominant-baseline'] ?? 'alphabetic';
      const cx = anchor === 'middle' ? x : anchor === 'end' ? x - w / 2 : x + w / 2;
      const cy = baseline === 'central' || baseline === 'middle' ? y : baseline === 'hanging' ? y + h / 2 : y - fs * 0.35;
      out.push({ node: n, movable: !fixedHere, x, y, w, h, cx, cy });
    }
    if (n.children.length) collect(n.children, out, fixedHere);
  }
}

function overlap(a: TextBox, b: TextBox): { dx: number; dy: number } | null {
  const ox = (a.w + b.w) / 2 - Math.abs(a.cx - b.cx);
  const oy = (a.h + b.h) / 2 - Math.abs(a.cy - b.cy);
  if (ox <= 0 || oy <= 0) return null;
  return { dx: ox, dy: oy };
}

export interface CriticReport {
  moved: number;
  remaining: number;
}

/** 解文字重叠；返回新标记（无重叠时原样返回，零成本） */
export function resolveTextOverlaps(markup: string): string {
  return resolveTextOverlapsDetailed(markup).markup;
}

export function resolveTextOverlapsDetailed(markup: string): { markup: string; report: CriticReport } {
  if (!markup.includes('<text')) return { markup, report: { moved: 0, remaining: 0 } };
  const tree = parseMarkup(markup);
  const boxes: TextBox[] = [];
  collect(tree, boxes, false);
  if (boxes.length < 2) return { markup, report: { moved: 0, remaining: 0 } };

  let moved = 0;
  const GAP = 4;
  for (let round = 0; round < 6; round++) {
    let touched = false;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const first = boxes[i];
        const second = boxes[j];
        const o = overlap(first, second);
        if (!o) continue;
        // 优先挪后画的；它不能挪就挪先画的；都不能挪（两个刻度）就算了
        const b = second.movable ? second : first.movable ? first : null;
        if (!b) continue;
        const a = b === second ? first : second;
        // 沿重叠更小的轴推开
        if (o.dy <= o.dx) {
          const dir = b.cy >= a.cy ? 1 : -1;
          const shift = (o.dy + GAP) * dir;
          b.y += shift;
          b.cy += shift;
        } else {
          const dir = b.cx >= a.cx ? 1 : -1;
          const shift = (o.dx + GAP) * dir;
          b.x += shift;
          b.cx += shift;
        }
        b.node.attrs.x = fmt(b.x);
        b.node.attrs.y = fmt(b.y);
        moved++;
        touched = true;
      }
    }
    if (!touched) break;
  }
  let remaining = 0;
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (overlap(boxes[i], boxes[j])) remaining++;
  if (moved === 0) return { markup, report: { moved: 0, remaining } };
  return { markup: serializeNodes(tree), report: { moved, remaining } };
}

function fmt(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}
