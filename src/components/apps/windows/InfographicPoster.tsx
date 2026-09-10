'use client';

/**
 * InfographicPoster — 海报查看器（2026-09-10）。
 *
 * 此前只有 fit / 100% 两档、不能拖：现在滚轮 / 双指以光标为锚缩放（复用 mindmap-gestures 的纯函数），
 * 放大后可拖动，拖不丢（clampPan 至少留 96px 在视口里），− % + 与「看全图」控件，双击在全图 / 原始之间切，
 * 键盘 + − 0。海报本身 260ms 淡入；transform 在非拖动时 300ms 过渡。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { APPS_COPY } from '@/lib/ui/copy-apps';
import { applyPinch, clampPan, zoomAround, type Point, type ViewTransform } from './mindmap-gestures';
import { prefersReducedMotion } from './app-motion';
import { isTypingTarget } from './app-keys';

interface InfographicPosterProps {
  src: string;
  alt: string;
  /** 'fit' = 看全图；'full' = 原始像素 */
  mode: 'fit' | 'full';
  onModeChange: (mode: 'fit' | 'full') => void;
  /** 缩放百分比变化（给头部的 % 读数） */
  onScaleChange?: (percent: number) => void;
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 4;

export function InfographicPoster({ src, alt, mode, onModeChange, onScaleChange }: InfographicPosterProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [view, setView] = useState<ViewTransform>({ x: 0, y: 0, scale: 1 });
  const [moving, setMoving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);
  const pointersRef = useRef(new Map<number, Point>());
  const pinchRef = useRef<[Point, Point] | null>(null);
  const content = useMemo(() => natural ?? { width: 1, height: 1 }, [natural]);

  const viewport = () => {
    const rect = containerRef.current?.getBoundingClientRect();
    return { width: rect?.width ?? 0, height: rect?.height ?? 0 };
  };
  const clamp = useCallback((t: ViewTransform) => {
    const vp = viewport();
    const w = content.width * t.scale;
    const h = content.height * t.scale;
    // 比视口小时居中，大时按边界夹
    const x = w <= vp.width ? (vp.width - w) / 2 : clampPan(t, content, vp).x;
    const y = h <= vp.height ? (vp.height - h) / 2 : clampPan(t, content, vp).y;
    return { ...t, x, y };
  }, [content]);

  /** 看全图：整张海报装进视口（留 24px 边） */
  const fit = useCallback(() => {
    if (!natural) return;
    const vp = viewport();
    if (!vp.width || !vp.height) return;
    const scale = Math.min((vp.width - 24) / natural.width, (vp.height - 24) / natural.height, MAX_SCALE);
    setMoving(false);
    setView(clamp({ x: 0, y: 0, scale: Math.max(MIN_SCALE, scale) }));
  }, [clamp, natural]);
  /** 原始像素：1:1，锚在视口中心 */
  const full = useCallback(() => {
    setMoving(false);
    setView((t) => clamp(zoomAround(t, 1 / t.scale, { x: viewport().width / 2, y: viewport().height / 2 })));
  }, [clamp]);

  useEffect(() => { if (mode === 'fit') fit(); else full(); }, [mode, fit, full, natural]);
  useEffect(() => { onScaleChange?.(Math.round(view.scale * 100)); }, [view.scale, onScaleChange]);
  // 容器变尺寸（全屏 ⇄ 中栏）：看全图模式跟着重算
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => { if (mode === 'fit') fit(); else setView((t) => clamp(t)); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [clamp, fit, mode]);

  // 滚轮缩放（非被动监听才能 preventDefault）
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      setView((t) => {
        const next = zoomAround(t, factor, { x: e.clientX - rect.left, y: e.clientY - rect.top });
        next.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next.scale));
        return clamp(next);
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [clamp]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target as HTMLElement | null) || e.metaKey || e.ctrlKey) return;
      if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomBy(1.25); }
      else if (e.key === '-') { e.preventDefault(); zoomBy(0.8); }
      else if (e.key === '0') { e.preventDefault(); onModeChange('fit'); fit(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit, onModeChange]);

  const zoomBy = (factor: number) => {
    const vp = viewport();
    setMoving(false);
    setView((t) => {
      const next = zoomAround(t, factor, { x: vp.width / 2, y: vp.height / 2 });
      next.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next.scale));
      return clamp(next);
    });
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      pinchRef.current = [a, b];
      dragRef.current = null;
      setMoving(true);
      return;
    }
    dragRef.current = { startX: e.clientX, startY: e.clientY, originX: view.x, originY: view.y, moved: false };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (pointersRef.current.has(e.pointerId)) pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinchRef.current && pointersRef.current.size >= 2) {
      const [a, b] = [...pointersRef.current.values()];
      const rect = e.currentTarget.getBoundingClientRect();
      const local = (p: Point) => ({ x: p.x - rect.left, y: p.y - rect.top });
      const from = pinchRef.current;
      setView((t) => {
        const next = applyPinch(t, [local(from[0]), local(from[1])], [local(a), local(b)]);
        next.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next.scale));
        return clamp(next);
      });
      pinchRef.current = [a, b];
      return;
    }
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) > 3) {
      drag.moved = true;
      setMoving(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    if (!drag.moved) return;
    setView((t) => clamp({ ...t, x: drag.originX + dx, y: drag.originY + dy }));
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(e.pointerId);
    if (pinchRef.current) { if (pointersRef.current.size < 2) { pinchRef.current = null; setMoving(false); } return; }
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    dragRef.current = null;
    setMoving(false);
  };

  const canPan = natural ? natural.width * view.scale > viewport().width || natural.height * view.scale > viewport().height : false;
  const reduced = prefersReducedMotion();

  return (
    <div
      ref={containerRef}
      className="relative h-full min-h-[320px] w-full overflow-hidden rounded-[12px]"
      style={{ touchAction: 'none', cursor: moving ? 'grabbing' : canPan ? 'grab' : 'zoom-in' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => onModeChange(mode === 'fit' ? 'full' : 'fit')}
      data-testid="infographic-poster"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- 生成图来自签名 URL，尺寸不定，不走 next/image */}
      <img
        src={src}
        alt={alt}
        draggable={false}
        onLoad={(e) => { setNatural({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight }); setLoaded(true); }}
        className="absolute left-0 top-0 max-w-none select-none rounded-[10px] shadow-card"
        style={{
          width: natural?.width,
          height: natural?.height,
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          transformOrigin: '0 0',
          transition: moving || reduced ? 'none' : 'transform 300ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 260ms ease',
          opacity: loaded ? 1 : 0,
        }}
      />
      {/* 右下角：− % + · 看全图 */}
      <div
        className="absolute bottom-3 right-3 z-10 flex items-center gap-2 rounded-full bg-white/90 px-2 py-1 text-[12px] text-ink-secondary shadow-soft backdrop-blur"
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <button type="button" onClick={() => zoomBy(0.8)} className="mm-press mm-focus flex h-7 w-7 items-center justify-center rounded-full text-[15px] leading-none hover:text-ink" aria-label={APPS_COPY.infographic.zoomOut}>−</button>
        <span className="min-w-[4ch] text-center font-mono tabular-nums text-ink-muted">{Math.round(view.scale * 100)}%</span>
        <button type="button" onClick={() => zoomBy(1.25)} className="mm-press mm-focus flex h-7 w-7 items-center justify-center rounded-full text-[15px] leading-none hover:text-ink" aria-label={APPS_COPY.infographic.zoomIn}>+</button>
        {mode !== 'fit' || canPan ? (
          <button type="button" onClick={() => { onModeChange('fit'); fit(); }} className="mm-focus mm-app-enter rounded px-1 py-1 transition hover:text-ink">{APPS_COPY.infographic.fit}</button>
        ) : null}
      </div>
    </div>
  );
}
