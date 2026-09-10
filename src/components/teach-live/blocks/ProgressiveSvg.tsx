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

interface ProgressiveSvgProps {
  attrs: LiveAttrs;
  segments: LiveSegment[];
  /** false = 历史回放，直接终态 */
  animate: boolean;
  className?: string;
  /** 每次挂上新元素后回调（滚动跟随用） */
  onGrow?: () => void;
}

function parseViewBox(attrs: LiveAttrs): { viewBox: string; ratio: number } {
  const raw = (attrs.viewbox ?? attrs.viewBox ?? '0 0 800 450').trim();
  const parts = raw.split(/[\s,]+/).map(Number);
  if (parts.length === 4 && parts.every((n) => Number.isFinite(n)) && parts[2] > 0 && parts[3] > 0) {
    return { viewBox: parts.join(' '), ratio: parts[2] / parts[3] };
  }
  return { viewBox: '0 0 800 450', ratio: 800 / 450 };
}

export const ProgressiveSvg = React.memo(function ProgressiveSvg({ attrs, segments, animate, className, onGrow }: ProgressiveSvgProps) {
  const svgRef = React.useRef<SVGSVGElement | null>(null);
  const penRef = React.useRef<PenController | null>(null);
  /** segmentId → 已挂上的顶层元素数 */
  const mountedRef = React.useRef<Map<string, number>>(new Map());
  const { viewBox, ratio } = React.useMemo(() => parseViewBox(attrs), [attrs]);

  React.useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    if (animate && !penRef.current) penRef.current = createPen(svg);
    let grew = false;
    let batch: Element[] = [];
    for (const segment of segments) {
      if (!segment.revealed) continue;
      const { complete } = splitTopLevelSvgChildren(segment.text);
      const already = mountedRef.current.get(segment.id) ?? 0;
      if (complete.length <= already) continue;
      const fresh = complete.slice(already);
      const mounted = mountSvgChildren(svg, fresh.join(''));
      mountedRef.current.set(segment.id, complete.length);
      if (mounted.length) {
        grew = true;
        batch = batch.concat(mounted);
      }
    }
    if (batch.length) {
      if (animate) animateDrawIn(batch, { pen: penRef.current });
      // 笔尖始终在最上层
      const pen = svg.querySelector(':scope > g.live-pen');
      if (pen) svg.appendChild(pen);
    }
    if (grew) onGrow?.();
  }, [segments, animate, onGrow]);

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
