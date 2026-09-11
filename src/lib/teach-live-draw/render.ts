/**
 * render —— 场景图 → SVG 标记。自动铺满画布、标签避让、直线裁剪、角标、坐标轴、动画。
 *
 * 关键约定：
 * - 所有可当运动路径的形状（线段 / 直线 / 圆 / 曲线 / 多边形）都渲染成 <path>，trace 用 <mpath> 引用。
 * - 每个元素带 id（`${idPrefix}${localId}`）与 data-name（localId），老师的 point at="fig#AB" 靠 data-name 命中。
 * - `into` 追加：传入首块算好的 transform，只输出 fromChunk 之后的 drawable；越界时 viewBox 外扩。
 * - 辅助元素（坐标轴 / 网格）标 data-draw="fade"，前端描画时整体淡入而不是一根根描。
 */

import * as G from './geometry';
import type { Pt } from './geometry';
import { PALETTE, type Drawable, type NoteRegion, type ParamSpec, type Scene, type Style } from './scene';
import { resolveTextOverlaps } from './layout-critic';

export interface Transform {
  /** 统一缩放（半径、角标尺寸用它 = min(sx, sy)） */
  s: number;
  /** x / y 各自的缩放：几何图两者相等（保形）；带坐标系的函数图允许不等（y = x² 从来不是等比画的） */
  sx: number;
  sy: number;
  ox: number;
  oy: number;
  w: number;
  h: number;
  /** 有坐标系时的可视范围（像素矩形），无限直线裁到这里而不是画布边 */
  clip?: { x0: number; y0: number; x1: number; y1: number };
  /** 实际采用的坐标范围（老师给的范围比内容大太多时会收紧到内容附近；时间轴各帧共用同一个） */
  view?: Bounds;
}

export interface RenderResult {
  markup: string;
  viewBox: string;
  transform: Transform;
  params: ParamSpec[];
  /** 每个 drawable 的 localId → 渲染出的 DOM id（前端 into 追加时定位用） */
  names: string[];
}

const PAD = 56;
const FONT = 22;

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f1 = (n: number): string => (Math.round(n * 10) / 10).toString();

function color(name: string | undefined, fallback: string): string {
  if (!name) return PALETTE[fallback] ?? fallback;
  return PALETTE[name] ?? name;
}

function strokeAttrs(st: Style, defaultColor: string, defaultWidth = 3): string {
  const c = color(st.color, defaultColor);
  const w = st.width ?? (st.faint ? 1.5 : defaultWidth);
  const dash = st.dashed || st.faint ? ` stroke-dasharray="${st.faint ? '6 6' : '10 8'}"` : '';
  const op = st.opacity ?? (st.faint ? 0.55 : 1);
  return `stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${dash}${op !== 1 ? ` stroke-opacity="${op}"` : ''}`;
}

function fillAttrs(st: Style, baseColor: string, defaultOn: boolean, defaultOpacity = 0.15): string {
  if (st.fill === false) return 'fill="none"';
  if (st.fill === undefined && !defaultOn) return 'fill="none"';
  const c = typeof st.fill === 'string' ? color(st.fill, baseColor) : color(st.color, baseColor);
  return `fill="${c}" fill-opacity="${st.fillOpacity ?? defaultOpacity}"`;
}

// ---------- 坐标 ----------

interface Bounds {
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
}

function computeBounds(scene: Scene): Bounds {
  if (scene.view) return { ...scene.view };
  return contentBounds(scene);
}

/**
 * 老师写 axes({ x: [-4, 4], y: [-4, 4] }) 却只在 [0, 1]² 画了一个单位正方形——图就成了大画框里的一粒芝麻（2026-09-11 实测）。
 * 内容在两个方向都不到范围的 45% 时，收紧到内容附近（留 35% 余量、至少 0.6 个单位、保留原点让坐标轴还在），
 * 但绝不超出老师给的范围；axes({ lock: true }) 可关掉。
 */
export function tightenView(view: Bounds, content: Bounds): Bounds {
  const vw = view.xmax - view.xmin;
  const vh = view.ymax - view.ymin;
  if (!(vw > 0) || !(vh > 0)) return view;
  if (![content.xmin, content.xmax, content.ymin, content.ymax].every(Number.isFinite)) return view;
  const c = { ...content };
  // 原点在范围内就一起保留：坐标轴的交点是读图的锚
  if (view.xmin <= 0 && view.xmax >= 0) { c.xmin = Math.min(c.xmin, 0); c.xmax = Math.max(c.xmax, 0); }
  if (view.ymin <= 0 && view.ymax >= 0) { c.ymin = Math.min(c.ymin, 0); c.ymax = Math.max(c.ymax, 0); }
  const cw = c.xmax - c.xmin;
  const ch = c.ymax - c.ymin;
  if (cw >= 0.45 * vw || ch >= 0.45 * vh) return view;
  const px = Math.max(0.6, 0.35 * cw);
  const py = Math.max(0.6, 0.35 * ch);
  return {
    xmin: Math.max(view.xmin, c.xmin - px),
    xmax: Math.min(view.xmax, c.xmax + px),
    ymin: Math.max(view.ymin, c.ymin - py),
    ymax: Math.min(view.ymax, c.ymax + py),
  };
}

function contentBounds(scene: Scene, margin = true): Bounds {
  let b: Bounds = { xmin: Infinity, xmax: -Infinity, ymin: Infinity, ymax: -Infinity };
  const take = (p: Pt) => {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    b = { xmin: Math.min(b.xmin, p.x), xmax: Math.max(b.xmax, p.x), ymin: Math.min(b.ymin, p.y), ymax: Math.max(b.ymax, p.y) };
  };
  for (const d of scene.drawables) {
    switch (d.kind) {
      case 'point':
        take(d.p);
        break;
      case 'line':
        take(d.l.a);
        if (d.l.type === 'segment') take(d.l.b);
        else take(G.lerp(d.l.a, d.l.b, d.l.type === 'ray' ? 1 : 0.5));
        break;
      case 'circle':
        take({ x: d.c.c.x - d.c.r, y: d.c.c.y - d.c.r });
        take({ x: d.c.c.x + d.c.r, y: d.c.c.y + d.c.r });
        break;
      case 'arc':
        take(d.c.c);
        take(G.polar(d.c.c, d.c.r, d.from));
        take(G.polar(d.c.c, d.c.r, d.to));
        break;
      case 'polygon':
      case 'area':
      case 'curve':
        for (const p of d.pts) take(p);
        break;
      case 'label':
        take(d.anchor);
        break;
      case 'arrow':
        take(d.from);
        take(d.to);
        break;
      default:
        break;
    }
  }
  if (!Number.isFinite(b.xmin)) b = { xmin: -5, xmax: 5, ymin: -3, ymax: 3 };
  if (b.xmax - b.xmin < 1e-9) {
    b.xmin -= 1;
    b.xmax += 1;
  }
  if (b.ymax - b.ymin < 1e-9) {
    b.ymin -= 1;
    b.ymax += 1;
  }
  if (!margin) return b;
  // 自由几何图：四周留 8% 数学余量给标签
  const mx = (b.xmax - b.xmin) * 0.08;
  const my = (b.ymax - b.ymin) * 0.08;
  return { xmin: b.xmin - mx, xmax: b.xmax + mx, ymin: b.ymin - my, ymax: b.ymax + my };
}

export function fitTransform(scene: Scene): Transform {
  const hasContent = scene.drawables.some((d) => d.kind !== 'axes' && d.kind !== 'note');
  const b = scene.view && !scene.viewLocked && hasContent ? tightenView(scene.view, contentBounds(scene, false)) : computeBounds(scene);
  const bw = b.xmax - b.xmin;
  const bh = b.ymax - b.ymin;
  const { w } = scene.size;
  let { h } = scene.size;
  const cx = (b.xmin + b.xmax) / 2;
  const cy = (b.ymin + b.ymax) / 2;
  if (scene.view) {
    // 带坐标系：函数图允许 x / y 各自铺满（y = x² 从来不是等比画的，刻度会说明比例）；
    // 但只要图里有圆 / 弧 / 角标，就必须保形——圆画成椭圆是错的（2026-09-11 实测）；axes({ equal: true }) 也可强制
    const rawSx = (w - 2 * PAD) / bw;
    const rawSy = (h - 2 * PAD) / bh;
    const needsEqual = scene.equalAxes || scene.drawables.some((d) => d.kind === 'circle' || d.kind === 'arc' || d.kind === 'angle');
    const sx = needsEqual ? Math.min(rawSx, rawSy) : rawSx;
    const sy = needsEqual ? sx : rawSy;
    const t: Transform = { s: Math.min(sx, sy), sx, sy, ox: w / 2 - sx * cx, oy: h / 2 + sy * cy, w, h, view: b };
    t.clip = { x0: PAD - 12, y0: PAD - 12, x1: w - PAD + 12, y1: h - PAD + 12 };
    return t;
  }
  // 高图自动放高（上限 620）
  if (bh / bw > 0.7 && h === 450) h = Math.min(620, Math.round(w * (bh / bw) * 0.8) + PAD);
  const s = Math.min((w - 2 * PAD) / bw, (h - 2 * PAD) / bh);
  return { s, sx: s, sy: s, ox: w / 2 - s * cx, oy: h / 2 + s * cy, w, h };
}

const toPx = (t: Transform, p: Pt): Pt => ({ x: t.ox + t.sx * p.x, y: t.oy - t.sy * p.y });

/** 无限直线 / 射线裁到画布矩形 */
function clipLine(t: Transform, a: Pt, b: Pt, type: 'line' | 'ray'): [Pt, Pt] | null {
  const A = toPx(t, a);
  const B = toPx(t, b);
  const d = G.sub(B, A);
  if (G.len(d) < 1e-9) return null;
  let tmin = type === 'ray' ? 0 : -Infinity;
  let tmax = Infinity;
  const rect = t.clip ?? { x0: -20, y0: -20, x1: t.w + 20, y1: t.h + 20 };
  const axes: Array<[number, number, number, number]> = [
    [A.x, d.x, rect.x0, rect.x1],
    [A.y, d.y, rect.y0, rect.y1],
  ];
  for (const [p, q, lo, hi] of axes) {
    if (Math.abs(q) < 1e-12) {
      if (p < lo || p > hi) return null;
      continue;
    }
    let t0 = (lo - p) / q;
    let t1 = (hi - p) / q;
    if (t0 > t1) [t0, t1] = [t1, t0];
    tmin = Math.max(tmin, t0);
    tmax = Math.min(tmax, t1);
  }
  if (tmin > tmax) return null;
  return [G.add(A, G.mul(d, tmin)), G.add(A, G.mul(d, tmax))];
}

// ---------- 标签避让 ----------

interface Box {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

function textWidth(text: string, fs: number): number {
  let w = 0;
  for (const ch of text) w += /[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? fs * 0.98 : /[A-Z]/.test(ch) ? fs * 0.66 : fs * 0.54;
  return w;
}

function boxesOverlap(a: Box, b: Box, gap = 4): boolean {
  return Math.abs(a.cx - b.cx) * 2 < a.w + b.w + gap && Math.abs(a.cy - b.cy) * 2 < a.h + b.h + gap;
}

class LabelPlacer {
  boxes: Box[] = [];
  points: Pt[] = [];
  segments: Array<[Pt, Pt]> = [];

  constructor(private readonly t: Transform) {}

  place(anchor: Pt, pref: Pt | null, text: string, fs: number, mode: NonNullable<Style['labelPos']>): Box {
    const w = textWidth(text, fs);
    const h = fs * 1.15;
    if (mode === 'center') {
      const box = { cx: anchor.x, cy: anchor.y, w, h };
      this.boxes.push(box);
      return box;
    }
    const fixed: Record<string, Pt> = { above: { x: 0, y: -1 }, below: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
    const base = mode !== 'auto' ? fixed[mode] : pref && G.len(pref) > 1e-6 ? G.norm(pref) : { x: 0.7, y: -0.7 };
    const angles = mode === 'auto' ? [0, 35, -35, 70, -70, 105, -105, 140, -140, 180] : [0];
    let best: { box: Box; score: number } | null = null;
    for (const deg of angles) {
      const dir = rotateDir(base, deg);
      const gap = 14;
      const off = gap + Math.abs(dir.x) * (w / 2) + Math.abs(dir.y) * (h / 2);
      let cx = anchor.x + dir.x * off;
      let cy = anchor.y + dir.y * off;
      cx = Math.min(this.t.w - w / 2 - 4, Math.max(w / 2 + 4, cx));
      cy = Math.min(this.t.h - h / 2 - 4, Math.max(h / 2 + 4, cy));
      const box = { cx, cy, w, h };
      let score = 0;
      for (const b of this.boxes) if (boxesOverlap(box, b)) score += 10;
      for (const p of this.points) if (Math.abs(p.x - cx) * 2 < w + 12 && Math.abs(p.y - cy) * 2 < h + 12) score += 6;
      for (const [a, b] of this.segments) if (G.distToSegment({ x: cx, y: cy }, a, b) < h * 0.55) score += 3;
      score += angles.indexOf(deg) * 0.01;
      if (!best || score < best.score) best = { box, score };
      if (score === 0) break;
    }
    this.boxes.push(best!.box);
    return best!.box;
  }
}

function rotateDir(d: Pt, deg: number): Pt {
  const r = (deg * Math.PI) / 180;
  return { x: d.x * Math.cos(r) - d.y * Math.sin(r), y: d.x * Math.sin(r) + d.y * Math.cos(r) };
}

function niceStep(range: number, target = 8): number {
  const rough = range / target;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  return [1, 2, 2.5, 5, 10].map((c) => c * pow).find((c) => c >= rough) ?? 10 * pow;
}

function fmt(n: number): string {
  const r = Math.round(n * 1000) / 1000;
  return String(r);
}

// ---------- 渲染 ----------

export function render(
  scene: Scene,
  options: { idPrefix?: string; transform?: Transform; fromChunk?: number } = {},
): RenderResult {
  const prefix = options.idPrefix ?? '';
  const t = options.transform ?? fitTransform(scene);
  const fromChunk = options.fromChunk ?? 0;
  const placer = new LabelPlacer(t);
  const view = t.view ?? scene.view ?? computeBounds(scene);
  const sceneCenter = toPx(t, G.centroid(collectPoints(scene)));

  // 先登记障碍（所有 chunk 的点与线段），标签避让要知道整张图；顺手记下像素范围（into 追加可能越界，viewBox 要外扩）
  const extents: Pt[] = [];
  for (const d of scene.drawables) {
    if (d.kind === 'point') extents.push(toPx(t, d.p));
    else if (d.kind === 'line' && d.l.type === 'segment') extents.push(toPx(t, d.l.a), toPx(t, d.l.b));
    else if (d.kind === 'polygon' || d.kind === 'area') extents.push(...d.pts.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)).map((p) => toPx(t, p)));
    else if (d.kind === 'circle') extents.push(toPx(t, { x: d.c.c.x - d.c.r, y: d.c.c.y - d.c.r }), toPx(t, { x: d.c.c.x + d.c.r, y: d.c.c.y + d.c.r }));
    else if (d.kind === 'arrow') extents.push(toPx(t, d.from), toPx(t, d.to));
  }
  for (const d of scene.drawables) {
    if (d.kind === 'point') placer.points.push(toPx(t, d.p));
    if (d.kind === 'line' && d.l.type === 'segment') placer.segments.push([toPx(t, d.l.a), toPx(t, d.l.b)]);
    if (d.kind === 'polygon') d.pts.forEach((p, i) => placer.segments.push([toPx(t, p), toPx(t, d.pts[(i + 1) % d.pts.length])]));
    if (d.kind === 'arrow') placer.segments.push([toPx(t, d.from), toPx(t, d.to)]);
  }

  // animate 按目标聚合
  const animsByTarget = new Map<string, string[]>();
  for (const d of scene.drawables) {
    if (d.kind === 'animate') {
      const list = animsByTarget.get(d.target) ?? [];
      list.push(`<animate attributeName="${esc(d.attr)}" values="${esc(d.values)}" dur="${d.dur}s" repeatCount="${d.loop ? 'indefinite' : '1'}" fill="freeze"/>`);
      animsByTarget.set(d.target, list);
    }
  }

  const out: string[] = [];
  const names: string[] = [];
  const arrowColorsDefined = new Set<string>();
  /** 每个批注区域已经叠到的高度（像素） */
  const noteCursors: Partial<Record<NoteRegion, number>> = {};
  let minX = 0;
  let minY = 0;
  let maxX = t.w;
  let maxY = t.h;
  const extend = (p: Pt) => {
    minX = Math.min(minX, p.x - 30);
    minY = Math.min(minY, p.y - 30);
    maxX = Math.max(maxX, p.x + 30);
    maxY = Math.max(maxY, p.y + 30);
  };

  const idAttr = (d: Drawable) => `id="${esc(prefix + d.id)}" data-name="${esc(d.id)}"${d.name ? ` data-label="${esc(d.name)}"` : ''}`;
  const children = (d: Drawable) => (animsByTarget.get(d.id) ?? []).join('');
  const emit = (d: Drawable, s: string) => {
    names.push(d.id);
    // 兜底：任何算出 NaN 的元素不上板（上板就是浏览器报错 + 一条看不见的线）
    if (/NaN/.test(s)) return;
    if (d.chunk >= fromChunk) out.push(s);
  };
  const labelFor = (d: Drawable, anchor: Pt, pref: Pt | null, text: string | undefined, mode: NonNullable<Style['labelPos']> = 'auto') => {
    if (!text) return;
    const fs = d.style.font ?? FONT;
    const box = placer.place(anchor, pref, text, fs, d.style.labelPos ?? mode);
    const c = color(d.style.color, d.kind === 'point' ? 'ink' : d.kind === 'label' ? 'ink' : d.style.color ? d.style.color : 'ink');
    if (d.chunk >= fromChunk) {
      out.push(
        `<text data-for="${esc(d.id)}" x="${f1(box.cx)}" y="${f1(box.cy)}" font-size="${fs}" fill="${c}" text-anchor="middle" dominant-baseline="central" paint-order="stroke" stroke="#F6F8F6" stroke-width="4" stroke-linejoin="round"${d.style.faint ? ' fill-opacity="0.7"' : ''}>${esc(text)}</text>`,
      );
    }
  };

  const pathOf = (pts: Pt[], close: boolean): string => {
    let d = '';
    let pen = false;
    for (const p of pts) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
        pen = false;
        continue;
      }
      const P = toPx(t, p);
      d += `${pen ? 'L' : 'M'}${f1(P.x)} ${f1(P.y)} `;
      pen = true;
    }
    return d.trim() + (close ? ' Z' : '');
  };

  for (const d of orderForPaint(scene.drawables)) {
    switch (d.kind) {
      case 'axes': {
        const g: string[] = [];
        const xStep = niceStep(view.xmax - view.xmin);
        const yStep = niceStep(view.ymax - view.ymin, 6);
        const x0 = Math.ceil(view.xmin / xStep) * xStep;
        const y0 = Math.ceil(view.ymin / yStep) * yStep;
        const axisY = view.ymin <= 0 && view.ymax >= 0 ? toPx(t, { x: 0, y: 0 }).y : toPx(t, { x: 0, y: view.ymin }).y;
        const axisX = view.xmin <= 0 && view.xmax >= 0 ? toPx(t, { x: 0, y: 0 }).x : toPx(t, { x: view.xmin, y: 0 }).x;
        const L = toPx(t, { x: view.xmin, y: view.ymin });
        const R = toPx(t, { x: view.xmax, y: view.ymax });
        if (d.grid) {
          for (let x = x0; x <= view.xmax + 1e-9; x += xStep) {
            const X = toPx(t, { x, y: 0 }).x;
            g.push(`<line x1="${f1(X)}" y1="${f1(R.y)}" x2="${f1(X)}" y2="${f1(L.y)}" stroke="#20312A" stroke-opacity="0.08"/>`);
          }
          for (let y = y0; y <= view.ymax + 1e-9; y += yStep) {
            const Y = toPx(t, { x: 0, y }).y;
            g.push(`<line x1="${f1(L.x)}" y1="${f1(Y)}" x2="${f1(R.x)}" y2="${f1(Y)}" stroke="#20312A" stroke-opacity="0.08"/>`);
          }
        }
        g.push(`<line x1="${f1(L.x - 8)}" y1="${f1(axisY)}" x2="${f1(R.x + 14)}" y2="${f1(axisY)}" stroke="#20312A" stroke-width="2" stroke-linecap="round"/>`);
        g.push(`<polygon points="${f1(R.x + 14)},${f1(axisY)} ${f1(R.x + 2)},${f1(axisY - 5)} ${f1(R.x + 2)},${f1(axisY + 5)}" fill="#20312A"/>`);
        g.push(`<line x1="${f1(axisX)}" y1="${f1(L.y + 8)}" x2="${f1(axisX)}" y2="${f1(R.y - 14)}" stroke="#20312A" stroke-width="2" stroke-linecap="round"/>`);
        g.push(`<polygon points="${f1(axisX)},${f1(R.y - 14)} ${f1(axisX - 5)},${f1(R.y - 2)} ${f1(axisX + 5)},${f1(R.y - 2)}" fill="#20312A"/>`);
        g.push(`<text x="${f1(R.x + 18)}" y="${f1(axisY + 6)}" font-size="18" fill="#20312A" font-style="italic">${esc(d.xLabel)}</text>`);
        g.push(`<text x="${f1(axisX + 10)}" y="${f1(R.y - 8)}" font-size="18" fill="#20312A" font-style="italic">${esc(d.yLabel)}</text>`);
        if (d.ticks) {
          for (let x = x0; x <= view.xmax + 1e-9; x += xStep) {
            if (Math.abs(x) < 1e-9) continue;
            const X = toPx(t, { x, y: 0 }).x;
            g.push(`<text x="${f1(X)}" y="${f1(axisY + 22)}" font-size="14" fill="#53645C" text-anchor="middle">${fmt(x)}</text>`);
          }
          for (let y = y0; y <= view.ymax + 1e-9; y += yStep) {
            if (Math.abs(y) < 1e-9) continue;
            const Y = toPx(t, { x: 0, y }).y;
            g.push(`<text x="${f1(axisX - 10)}" y="${f1(Y + 5)}" font-size="14" fill="#53645C" text-anchor="end">${fmt(y)}</text>`);
          }
        }
        emit(d, `<g ${idAttr(d)} data-draw="fade">${g.join('')}</g>`);
        break;
      }
      case 'area': {
        emit(d, `<path ${idAttr(d)} d="${pathOf(d.pts, true)}" ${fillAttrs({ ...d.style, fill: d.style.fill ?? true }, 'pine', true, d.style.fillOpacity ?? 0.18)} stroke="none">${children(d)}</path>`);
        if (d.label) labelFor(d, toPx(t, G.centroid(d.pts)), null, d.label, 'center');
        break;
      }
      case 'polygon': {
        if (d.style.hidden) break;
        emit(d, `<path ${idAttr(d)} d="${pathOf(d.pts, true)}" ${fillAttrs(d.style, 'pine', true)} ${strokeAttrs(d.style, 'ink')}>${children(d)}</path>`);
        if (d.label) labelFor(d, toPx(t, G.centroid(d.pts)), null, d.label, 'center');
        break;
      }
      case 'circle': {
        if (d.style.hidden) break;
        const C = toPx(t, d.c.c);
        const rx = d.c.r * t.sx;
        const ry = d.c.r * t.sy;
        emit(
          d,
          `<path ${idAttr(d)} d="M${f1(C.x + rx)} ${f1(C.y)} A${f1(rx)} ${f1(ry)} 0 1 0 ${f1(C.x - rx)} ${f1(C.y)} A${f1(rx)} ${f1(ry)} 0 1 0 ${f1(C.x + rx)} ${f1(C.y)} Z" ${fillAttrs(d.style, 'pine', false)} ${strokeAttrs(d.style, 'ink')}>${children(d)}</path>`,
        );
        if (d.label) labelFor(d, { x: C.x + rx * 0.72, y: C.y - ry * 0.72 }, { x: 0.7, y: -0.7 }, d.label);
        break;
      }
      case 'arc': {
        const C = toPx(t, d.c.c);
        const r = d.c.r * t.s;
        void C;
        const P1 = toPx(t, G.polar(d.c.c, d.c.r, d.from));
        const P2 = toPx(t, G.polar(d.c.c, d.c.r, d.to));
        const sweepDeg = ((d.to - d.from) % 360 + 360) % 360;
        const large = sweepDeg > 180 ? 1 : 0;
        emit(d, `<path ${idAttr(d)} d="M${f1(P1.x)} ${f1(P1.y)} A${f1(r)} ${f1(r)} 0 ${large} 0 ${f1(P2.x)} ${f1(P2.y)}" fill="none" ${strokeAttrs(d.style, 'amber')}>${children(d)}</path>`);
        if (d.label) labelFor(d, toPx(t, G.polar(d.c.c, d.c.r, (d.from + d.to) / 2)), G.sub(toPx(t, G.polar(d.c.c, d.c.r, (d.from + d.to) / 2)), C), d.label);
        break;
      }
      case 'line': {
        if (d.style.hidden) break;
        let A: Pt;
        let B: Pt;
        if (d.l.type === 'segment') {
          A = toPx(t, d.l.a);
          B = toPx(t, d.l.b);
        } else {
          const clipped = clipLine(t, d.l.a, d.l.b, d.l.type);
          if (!clipped) break;
          [A, B] = clipped;
        }
        emit(d, `<path ${idAttr(d)} d="M${f1(A.x)} ${f1(A.y)} L${f1(B.x)} ${f1(B.y)}" fill="none" ${strokeAttrs(d.style, 'ink')}>${children(d)}</path>`);
        if (d.label) {
          const mid = G.midpoint(A, B);
          const dir = G.sub(B, A);
          let n = G.norm(G.perp(dir));
          // 朝远离图心的一侧
          if (G.dot(n, G.sub(mid, sceneCenter)) < 0) n = G.mul(n, -1);
          labelFor(d, mid, n, d.label);
        }
        break;
      }
      case 'curve': {
        const filtered = d.pts.map((p) => {
          if (!Number.isFinite(p.y) || !Number.isFinite(p.x)) return { x: NaN, y: NaN };
          const span = view.ymax - view.ymin;
          if (p.y > view.ymax + span * 1.5 || p.y < view.ymin - span * 1.5) return { x: NaN, y: NaN };
          return p;
        });
        emit(d, `<path ${idAttr(d)} d="${pathOf(filtered, false)}" fill="none" ${strokeAttrs(d.style, 'pine')}>${children(d)}</path>`);
        if (d.label) {
          const last = [...filtered].reverse().find((p) => Number.isFinite(p.y) && p.y <= view.ymax && p.y >= view.ymin);
          if (last) labelFor(d, toPx(t, last), { x: 0.6, y: -0.8 }, d.label);
        }
        break;
      }
      case 'angle': {
        const B = toPx(t, d.b);
        const u = G.norm(G.sub(toPx(t, d.a), B));
        const v = G.norm(G.sub(toPx(t, d.c), B));
        const c = color(d.style.color, 'amber');
        if (d.right) {
          const k = 15;
          const p1 = G.add(B, G.mul(u, k));
          const p2 = G.add(G.add(B, G.mul(u, k)), G.mul(v, k));
          const p3 = G.add(B, G.mul(v, k));
          emit(d, `<path ${idAttr(d)} d="M${f1(p1.x)} ${f1(p1.y)} L${f1(p2.x)} ${f1(p2.y)} L${f1(p3.x)} ${f1(p3.y)}" fill="none" stroke="${color(d.style.color, 'ink2')}" stroke-width="2">${children(d)}</path>`);
        } else {
          const deg = G.angleOf(d.a, d.b, d.c);
          const r = deg < 25 ? 36 : 28;
          const p1 = G.add(B, G.mul(u, r));
          const p2 = G.add(B, G.mul(v, r));
          // 像素坐标 y 向下：叉积符号决定 sweep
          const sweep = G.cross(u, v) > 0 ? 1 : 0;
          emit(d, `<path ${idAttr(d)} d="M${f1(p1.x)} ${f1(p1.y)} A${r} ${r} 0 0 ${sweep} ${f1(p2.x)} ${f1(p2.y)}" fill="none" stroke="${c}" stroke-width="2.5" stroke-linecap="round">${children(d)}</path>`);
        }
        if (d.label) {
          const bis = G.norm(G.add(u, v));
          labelFor(d, G.add(B, G.mul(bis, d.right ? 34 : 46)), bis, d.label, 'center');
        }
        break;
      }
      case 'point': {
        if (d.style.hidden) break;
        const P = toPx(t, d.p);
        const c = color(d.style.color, 'pine');
        const r = d.style.r ?? 4.5;
        emit(d, `<g ${idAttr(d)}><circle cx="${f1(P.x)}" cy="${f1(P.y)}" r="${r}" fill="${c}" stroke="#F6F8F6" stroke-width="2">${children(d)}</circle></g>`);
        if (d.label) labelFor(d, P, G.sub(P, sceneCenter), d.label);
        break;
      }
      case 'arrow': {
        const A = toPx(t, d.from);
        const B = toPx(t, d.to);
        const c = color(d.style.color, 'blue');
        const markerId = `${prefix}arrow-${c.replace('#', '')}`;
        if (!arrowColorsDefined.has(c) && d.chunk >= fromChunk) {
          arrowColorsDefined.add(c);
          out.push(`<defs><marker id="${markerId}" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0.5 L10 5 L0 9.5 z" fill="${c}"/></marker></defs>`);
        }
        // 箭头线缩短一点，别被箭头盖住
        const dir = G.norm(G.sub(B, A));
        const end = G.sub(B, G.mul(dir, 6));
        emit(d, `<path ${idAttr(d)} d="M${f1(A.x)} ${f1(A.y)} L${f1(end.x)} ${f1(end.y)}" fill="none" ${strokeAttrs(d.style, 'blue', 2.5)} marker-end="url(#${markerId})">${children(d)}</path>`);
        if (d.label) {
          // 向量的名字写在箭头尖附近（沿方向再往前一点），不是线中间——几支从原点出发的向量标签才不会挤在一起
          const tip = G.add(B, G.mul(dir, 10));
          let n = G.norm(G.perp(dir));
          if (G.dot(n, G.sub(B, sceneCenter)) < 0) n = G.mul(n, -1);
          labelFor(d, tip, G.norm(G.add(dir, G.mul(n, 0.6))), d.label);
        }
        break;
      }
      case 'label': {
        const anchor = toPx(t, d.anchor);
        labelFor(d, anchor, d.pos === 'auto' ? G.sub(anchor, sceneCenter) : null, d.text, d.pos);
        names.push(d.id);
        break;
      }
      case 'note': {
        const fs = d.style.font ?? 18;
        const lines = wrapNote(d.text, fs, t.w * 0.3);
        const lineH = fs * 1.45;
        const pos = notePosition(d.region, t, noteCursors, lines.length * lineH);
        const c = color(d.style.color, 'ink2');
        const anchor = d.region.endsWith('right') ? 'end' : d.region.endsWith('left') ? 'start' : 'middle';
        const inner = lines
          .map((line, i) => `<text x="${f1(pos.x)}" y="${f1(pos.y + i * lineH)}" font-size="${fs}" fill="${c}" text-anchor="${anchor}" dominant-baseline="hanging">${esc(line)}</text>`)
          .join('');
        emit(d, `<g ${idAttr(d)} class="live-note-text">${inner}</g>`);
        // 批注占的地方登记给标签避让；viewBox 需要时外扩
        const width = Math.max(...lines.map((l) => textWidth(l, fs)));
        const left = anchor === 'end' ? pos.x - width : anchor === 'start' ? pos.x : pos.x - width / 2;
        placer.boxes.push({ cx: left + width / 2, cy: pos.y + (lines.length * lineH) / 2, w: width, h: lines.length * lineH });
        extend({ x: left, y: pos.y });
        extend({ x: left + width, y: pos.y + lines.length * lineH });
        break;
      }
      case 'trace': {
        const c = color(d.style.color, 'amber');
        emit(
          d,
          `<circle ${idAttr(d)} r="${d.style.r ?? 7}" fill="${c}" stroke="#F6F8F6" stroke-width="2"><animateMotion dur="${d.dur}s" repeatCount="${d.loop ? 'indefinite' : '1'}" fill="freeze" rotate="auto"><mpath href="#${esc(prefix + d.along)}"/></animateMotion></circle>`,
        );
        break;
      }
      case 'animate':
        break;
      default:
        break;
    }
  }

  // 元素或标签可能落在画布外（into 追加 / 长标签）：viewBox 外扩
  for (const p of extents) extend(p);
  for (const b of placer.boxes) {
    extend({ x: b.cx - b.w / 2, y: b.cy - b.h / 2 });
    extend({ x: b.cx + b.w / 2, y: b.cy + b.h / 2 });
  }
  const viewBox = `${f1(minX)} ${f1(minY)} ${f1(maxX - minX)} ${f1(maxY - minY)}`;
  // 代码版 critic：渲染完再扫一遍文字框重叠，把后画的挪开（零延迟，不用 VLM）
  const markup = resolveTextOverlaps(out.join('\n'));
  return { markup, viewBox, transform: t, params: scene.params, names };
}

// ---------- 批注区域 ----------

const NOTE_PAD = 26;

function wrapNote(text: string, fs: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n/)) {
    let line = '';
    for (const ch of para) {
      if (textWidth(line + ch, fs) > maxWidth && line) {
        out.push(line);
        line = ch;
      } else line += ch;
    }
    out.push(line);
  }
  return out.filter((l, i, arr) => l !== '' || (i > 0 && arr[i - 1] !== ''));
}

function notePosition(region: NoteRegion, t: Transform, cursors: Partial<Record<NoteRegion, number>>, blockHeight: number): Pt {
  const col = region.endsWith('left') ? 0 : region.endsWith('right') ? 2 : 1;
  const row = region.startsWith('top') ? 0 : region.startsWith('bottom') ? 2 : 1;
  const x = col === 0 ? NOTE_PAD : col === 2 ? t.w - NOTE_PAD : t.w / 2;
  const used = cursors[region] ?? 0;
  let y: number;
  if (row === 0) y = NOTE_PAD + used;
  else if (row === 2) y = t.h - NOTE_PAD - blockHeight - used;
  else y = t.h / 2 - blockHeight / 2 + used;
  cursors[region] = used + blockHeight + 10;
  return { x, y };
}

/**
 * 上板顺序：同一段脚本里，坐标系与带填充的面（polygon / area）先上，其余按老师写的顺序。
 * 面后画会把先画的向量 / 边压在底下（单位正方形盖住 e₂，2026-09-11 实测）；而"先铺出形状、再在上面画向量与点"也正是人在黑板上的顺序。
 * 段与段之间不重排（into 追加只输出新元素）。
 */
const PAINT_LAYER: Partial<Record<Drawable['kind'], number>> = { axes: 0, area: 1, polygon: 1 };
function orderForPaint(drawables: Drawable[]): Drawable[] {
  return drawables
    .map((d, i) => ({ d, i }))
    .sort((a, b) => a.d.chunk - b.d.chunk || (PAINT_LAYER[a.d.kind] ?? 2) - (PAINT_LAYER[b.d.kind] ?? 2) || a.i - b.i)
    .map((x) => x.d);
}

function collectPoints(scene: Scene): Pt[] {
  const pts: Pt[] = [];
  for (const d of scene.drawables) {
    if (d.kind === 'point') pts.push(d.p);
    else if (d.kind === 'line') pts.push(d.l.a, d.l.b);
    else if (d.kind === 'polygon') pts.push(...d.pts);
    else if (d.kind === 'circle') pts.push(d.c.c);
    else if (d.kind === 'arrow') pts.push(d.from, d.to);
  }
  return pts.length ? pts : [{ x: 0, y: 0 }];
}
