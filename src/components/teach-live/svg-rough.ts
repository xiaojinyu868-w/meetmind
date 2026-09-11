'use client';

/**
 * svg-rough —— 把一批刚挂上的 SVG 元素换成 rough.js 的手绘笔迹（像马克笔在白板上画）。
 *
 * 规则：
 * - 只动几何形状（line / rect / circle / ellipse / polygon / polyline / path）；文字、defs、marker、
 *   带 SMIL 子元素（<animate*>）的形状、`data-draw="fade"`（网格 / 刻度）里的都保持工整。
 * - 半径 < 6 的小圆（点）也保持工整——太小的形状抖起来像噪点。
 * - 原元素的 id / data-* / class / 虚线 / 透明度 / marker / transform 原样搬到替换后的 <g> 或其 path 上，
 *   所以激光笔 point at="fig#hyp"、描画动画、into 追加都不受影响。
 * - roughness 压得很低（0.55）：要的是"有人手在画"，不是"画歪了"。seed 由 id 决定，同一张图每次一样。
 */

import rough from 'roughjs';
import type { Options } from 'roughjs/bin/core';

const SHAPE_TAGS = new Set(['line', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'path']);
const SKIP_TAGS = new Set(['defs', 'marker', 'clippath', 'mask', 'pattern', 'lineargradient', 'radialgradient', 'style', 'script', 'text', 'image', 'use', 'foreignobject']);

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) % 2147483647 || 7;
}

function num(el: Element, name: string, fallback = 0): number {
  const v = parseFloat(el.getAttribute(name) ?? '');
  return Number.isFinite(v) ? v : fallback;
}

function hasSmilChild(el: Element): boolean {
  return Array.from(el.children).some((c) => c.tagName.toLowerCase().startsWith('animate') || c.tagName.toLowerCase() === 'set');
}

function inFadeGroup(el: Element, root: Element): boolean {
  let cur: Element | null = el;
  while (cur && cur !== root) {
    if (cur.getAttribute('data-draw') === 'fade') return true;
    cur = cur.parentElement;
  }
  return false;
}

function parsePoints(raw: string | null): Array<[number, number]> {
  if (!raw) return [];
  const nums = raw.trim().split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n));
  const out: Array<[number, number]> = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i], nums[i + 1]]);
  return out;
}

function roughOptions(el: Element, seedKey: string): Options {
  const stroke = el.getAttribute('stroke') ?? (el.tagName.toLowerCase() === 'path' || el.tagName.toLowerCase() === 'line' ? '#20312A' : 'none');
  const fillAttr = el.getAttribute('fill');
  const tag = el.tagName.toLowerCase();
  const fill = fillAttr === null ? (tag === 'line' || tag === 'polyline' || tag === 'path' ? 'none' : '#20312A') : fillAttr;
  const width = num(el, 'stroke-width', 2);
  const dash = el.getAttribute('stroke-dasharray');
  const opts: Options = {
    roughness: 0.55,
    bowing: 0.7,
    seed: hashSeed(seedKey),
    stroke: stroke === 'none' ? 'none' : stroke,
    strokeWidth: width,
    disableMultiStroke: true,
    preserveVertices: true,
    curveFitting: 0.98,
  };
  if (fill && fill !== 'none' && fill !== 'transparent') {
    opts.fill = fill;
    opts.fillStyle = 'solid';
  }
  if (dash && dash !== 'none') {
    const parts = dash.split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n));
    if (parts.length) opts.strokeLineDash = parts;
  }
  return opts;
}

const COPY_ATTRS = ['id', 'class', 'transform', 'opacity', 'stroke-opacity', 'clip-path', 'style'];

function carryAttributes(from: Element, to: SVGGElement): void {
  for (const name of COPY_ATTRS) {
    const v = from.getAttribute(name);
    if (v !== null) to.setAttribute(name, v);
  }
  for (const attr of Array.from(from.attributes)) {
    if (attr.name.startsWith('data-')) to.setAttribute(attr.name, attr.value);
  }
  const fillOpacity = from.getAttribute('fill-opacity');
  const marker = from.getAttribute('marker-end');
  for (const path of Array.from(to.querySelectorAll('path'))) {
    const isFill = (path.getAttribute('fill') ?? 'none') !== 'none';
    if (isFill && fillOpacity) path.setAttribute('fill-opacity', fillOpacity);
    if (!isFill && marker) path.setAttribute('marker-end', marker);
    if (!isFill) {
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
    }
  }
}

/** 单个形状 → 手绘 <g>；不适用返回 null */
function roughenShape(rc: ReturnType<typeof rough.svg>, el: Element, seedKey: string): SVGGElement | null {
  const tag = el.tagName.toLowerCase();
  if (!SHAPE_TAGS.has(tag) || hasSmilChild(el)) return null;
  const opts = roughOptions(el, seedKey);
  let g: SVGGElement | null = null;
  try {
    switch (tag) {
      case 'line':
        g = rc.line(num(el, 'x1'), num(el, 'y1'), num(el, 'x2'), num(el, 'y2'), opts);
        break;
      case 'rect': {
        const rx = num(el, 'rx', 0);
        if (rx > 0) return null; // 圆角矩形保持工整
        g = rc.rectangle(num(el, 'x'), num(el, 'y'), num(el, 'width'), num(el, 'height'), opts);
        break;
      }
      case 'circle': {
        const r = num(el, 'r');
        if (r < 6) return null;
        g = rc.circle(num(el, 'cx'), num(el, 'cy'), r * 2, opts);
        break;
      }
      case 'ellipse':
        g = rc.ellipse(num(el, 'cx'), num(el, 'cy'), num(el, 'rx') * 2, num(el, 'ry') * 2, opts);
        break;
      case 'polygon': {
        const pts = parsePoints(el.getAttribute('points'));
        if (pts.length < 3) return null;
        g = rc.polygon(pts, opts);
        break;
      }
      case 'polyline': {
        const pts = parsePoints(el.getAttribute('points'));
        if (pts.length < 2) return null;
        g = rc.linearPath(pts, opts);
        break;
      }
      case 'path': {
        const d = el.getAttribute('d');
        if (!d || d.length > 6000) return null; // 超长路径（采样曲线）保持工整
        g = rc.path(d, opts);
        break;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
  if (!g) return null;
  carryAttributes(el, g);
  g.setAttribute('data-rough', '1');
  return g;
}

/**
 * 把 elements（刚挂进 svg 的顶层元素）就地替换成手绘版本，返回替换后的顶层元素数组（顺序不变）。
 * <g> 递归处理其子元素、自身保留。
 */
export function roughenElements(svg: SVGSVGElement, elements: Element[]): Element[] {
  const rc = rough.svg(svg);
  let counter = 0;
  const visit = (el: Element): Element => {
    const tag = el.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag) || inFadeGroup(el, svg)) return el;
    if (tag === 'g' || tag === 'a' || tag === 'switch') {
      for (const child of Array.from(el.children)) visit(child);
      return el;
    }
    const seedKey = el.getAttribute('id') ?? `${el.tagName}-${counter++}-${el.getAttribute('d')?.length ?? 0}`;
    const replacement = roughenShape(rc, el, seedKey);
    if (!replacement) return el;
    el.replaceWith(replacement);
    return replacement;
  };
  return elements.map(visit);
}
