'use client';

/**
 * ProgressiveSvg —— 一张会自己长出来的图。
 *
 * 输入是 segments（正文可能还在增长、可能还没 reveal）；组件只做一件事：把每个
 * 已 reveal 的 segment 里**新闭合**的顶层元素挂上去并描画（svg-draw.ts）。
 * 不重渲染整张图（那会让动画重放、闪烁），所以 DOM 是增量的、由 ref 掌管。
 * 元素带 id 时保留原 id（point at="fig#hyp" 靠它定位），同时挂 data-live-id 避免与页面冲突时丢失。
 */

import * as React from 'react';
import type { LiveAttrs } from '@/types/teach-live';
import type { LiveSegment } from '../live-model';
import { animateDrawIn, createPen, mountSvgChildren, splitTopLevelSvgChildren, type PenController } from '../svg-draw';

/**
 * 每张图预注入的公共 defs：箭头 marker（五色）、发光 filter、柔和渐变。
 * 模型写 <svg> 时直接 marker-end="url(#mm-arrow-pine)"、filter="url(#mm-glow)"，不用自己定义；
 * 同 id 在多张图里重复定义没关系——形状一样，浏览器取文档里第一个。
 */
const DEFAULT_DEFS = (() => {
  const colors: Record<string, string> = { ink: '#20312A', pine: '#2F6B55', amber: '#C8873A', blue: '#3B6FB6', rose: '#C24B5A' };
  const markers = Object.entries(colors)
    .map(([name, hex]) => `<marker id="mm-arrow-${name}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0.5 L10 5 L0 9.5 Z" fill="${hex}"/></marker>`)
    .join('');
  const gradients = Object.entries(colors)
    .map(([name, hex]) => `<linearGradient id="mm-soft-${name}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hex}" stop-opacity="0.28"/><stop offset="1" stop-color="${hex}" stop-opacity="0.06"/></linearGradient>`)
    .join('');
  return `<defs data-mm-defaults="1">${markers}${gradients}<filter id="mm-glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter><filter id="mm-shadow" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#20312A" flood-opacity="0.18"/></filter></defs>`;
})();
import { roughenElements } from '../svg-rough';
import { LiveStyleContext } from '../live-style-context';

interface ProgressiveSvgProps {
  attrs: LiveAttrs;
  segments: LiveSegment[];
  /** false = 历史回放，直接终态 */
  animate: boolean;
  className?: string;
  /** 每次挂上新元素后回调（滚动跟随用） */
  onGrow?: () => void;
  /** 覆盖舞台级手绘开关（plot 传 false 保持工整） */
  rough?: boolean;
}

function parseViewBox(attrs: LiveAttrs): { viewBox: string; ratio: number } {
  const raw = (attrs.viewbox ?? attrs.viewBox ?? '0 0 800 450').trim();
  const parts = raw.split(/[\s,]+/).map(Number);
  if (parts.length === 4 && parts.every((n) => Number.isFinite(n)) && parts[2] > 0 && parts[3] > 0) {
    return { viewBox: parts.join(' '), ratio: parts[2] / parts[3] };
  }
  return { viewBox: '0 0 800 450', ratio: 800 / 450 };
}

export const ProgressiveSvg = React.memo(function ProgressiveSvg({ attrs, segments, animate, className, onGrow, rough }: ProgressiveSvgProps) {
  const svgRef = React.useRef<SVGSVGElement | null>(null);
  const style = React.useContext(LiveStyleContext);
  const useRough = rough ?? style.rough;
  const penRef = React.useRef<PenController | null>(null);
  /** segmentId → 已挂上的顶层元素数 */
  const mountedRef = React.useRef<Map<string, number>>(new Map());
  const { viewBox, ratio } = React.useMemo(() => parseViewBox(attrs), [attrs]);
  /** 手绘 / 工整切换：已经画在板上的也要换风格——清空重挂（不重放描画） */
  const roughAppliedRef = React.useRef(useRough);

  React.useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    if (!svg.querySelector(':scope > defs[data-mm-defaults]')) mountSvgChildren(svg, DEFAULT_DEFS);
    if (animate && !penRef.current) penRef.current = createPen(svg);
    let restyled = false;
    if (roughAppliedRef.current !== useRough) {
      roughAppliedRef.current = useRough;
      for (const child of Array.from(svg.children)) {
        if (!child.classList.contains('live-pen') && !(child.tagName.toLowerCase() === 'defs' && child.hasAttribute('data-mm-defaults'))) child.remove();
      }
      mountedRef.current.clear();
      restyled = true;
    }
    let grew = false;
    let batch: Element[] = [];
    for (const segment of segments) {
      if (!segment.revealed) continue;
      const { complete } = splitTopLevelSvgChildren(segment.text);
      const already = mountedRef.current.get(segment.id) ?? 0;
      if (complete.length <= already) continue;
      const fresh = complete.slice(already);
      let mounted = mountSvgChildren(svg, fresh.join(''));
      if (useRough) mounted = roughenElements(svg, mounted);
      mountedRef.current.set(segment.id, complete.length);
      if (mounted.length) {
        grew = true;
        if (!segment.instant) batch = batch.concat(mounted);
      }
    }
    if (batch.length) {
      // 换风格重挂：直接终态，不再一笔笔描
      if (animate && !restyled) animateDrawIn(batch, { pen: penRef.current });
      // 笔尖始终在最上层
      const pen = svg.querySelector(':scope > g.live-pen');
      if (pen) svg.appendChild(pen);
    }
    if (grew && !restyled) onGrow?.();
  }, [segments, animate, onGrow, useRough]);

  React.useEffect(() => {
    return () => {
      penRef.current?.dispose();
      penRef.current = null;
    };
  }, []);

  return (
    <svg
      ref={svgRef}
      viewBox={viewBox}
      className={className}
      role="img"
      aria-label={attrs.title ?? attrs.alt ?? '板书图'}
      style={{ aspectRatio: `${ratio}`, width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}
      preserveAspectRatio="xMidYMid meet"
    />
  );
});
