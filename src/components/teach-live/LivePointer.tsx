'use client';

/**
 * LivePointer —— 激光笔：point at="fig#hyp" 演到时，一个琥珀色光点从上一处滑到目标，
 * 目标外面亮一圈柔光；3 秒多后淡出。目标可以是整块（data-block-id）或图里带 id 的元素。
 * 坐标相对 .live-board-inner（板的滚动内容），随滚动一起走；目标不在当前页就不画。
 */

import * as React from 'react';
import type { PointerTarget } from './useLiveLesson';

interface LivePointerProps {
  target: PointerTarget | null;
  /** .live-board-inner */
  containerRef: React.RefObject<HTMLElement>;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function locate(container: HTMLElement, target: PointerTarget): Rect | null {
  const block = container.querySelector<HTMLElement>(`[data-block-id="${target.blockId}"]`);
  if (!block) return null;
  let el: Element = block;
  if (target.innerId) {
    const inner = findInner(block, target.innerId);
    if (inner) el = inner;
  }
  const r = el.getBoundingClientRect();
  const c = container.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { x: r.left - c.left, y: r.top - c.top, w: r.width, h: r.height };
}

const SUBSCRIPTS: Record<string, string> = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9' };

/**
 * 老师说 at="fig#v"：图里元素的真实 id 带块前缀（lb_3-v），所以先按 id，再按 data-name / data-label 找；
 * e₁ 与 e1 视为同一个名字。
 */
function findInner(block: HTMLElement, rawId: string): Element | null {
  const norm = rawId.replace(/[₀-₉]/g, (d) => SUBSCRIPTS[d] ?? d);
  const candidates = norm === rawId ? [rawId] : [rawId, norm];
  for (const id of candidates) {
    const hit =
      block.querySelector(`#${cssEscape(id)}`) ??
      block.querySelector(`[id="${id}"]`) ??
      block.querySelector(`[data-name="${id}"]`) ??
      block.querySelector(`[data-label="${id}"]`) ??
      block.querySelector(`[id$="-${id}"]`);
    if (hit) return hit;
  }
  return null;
}

function cssEscape(id: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

export function LivePointer({ target, containerRef }: LivePointerProps) {
  const [rect, setRect] = React.useState<Rect | null>(null);
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    if (!target || !containerRef.current) {
      setVisible(false);
      return;
    }
    const container = containerRef.current;
    // 目标可能刚挂上、还在描画：多试几帧
    let tries = 0;
    let raf = 0;
    const attempt = () => {
      const r = locate(container, target);
      if (r) {
        setRect(r);
        setVisible(true);
        const block = container.querySelector<HTMLElement>(`[data-block-id="${target.blockId}"]`);
        block?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        return;
      }
      if (++tries < 30) raf = requestAnimationFrame(attempt);
    };
    attempt();
    const hide = setTimeout(() => setVisible(false), 3400);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(hide);
    };
  }, [target, containerRef]);

  if (!rect) return null;
  const pad = 10;
  const isBlock = !target?.innerId;
  return (
    <>
      <div
        className="live-pointer-target"
        style={{
          left: rect.x - pad,
          top: rect.y - pad,
          width: rect.w + pad * 2,
          height: rect.h + pad * 2,
          opacity: visible ? 1 : 0,
          borderRadius: isBlock ? 16 : 12,
        }}
      />
      <div
        className="live-pointer"
        style={{
          transform: `translate(${rect.x + rect.w + 4}px, ${rect.y - 4}px)`,
          opacity: visible ? 1 : 0,
          transition: 'transform 520ms cubic-bezier(.2,.9,.2,1), opacity 320ms ease',
        }}
      />
    </>
  );
}
