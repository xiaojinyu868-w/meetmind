'use client';

/**
 * BlockAnnotation — 块内标注（v33 坐标系归一）。
 *
 * 圈/下划线/勾叉画在目标 write 块**自己的坐标系**里（块 position:relative，
 * 标注 SVG 是块的绝对定位子元素），不再走"板面坐标系 + DOM 实测 + 纪元重测"
 * 的全局覆盖层。浏览器天然把内容和标注锁死：内容换行/换栏/收缩/生长，
 * 标注永远跟着走——跟随、遮挡、偏移这一族 bug 从根上消失。
 *
 * 块内墨迹贴合仍需要宽高，但只在**块自己的局部坐标系**里量
 * （getBoundingClientRect 差值 ÷ 当前缩放 = 布局空间局部坐标），
 * 块写完后内容不再变，量一次 + 字体就绪复测一次即可，无需纪元。
 * 箭头跨块，不在此列（仍走 BoardAnnotation/MeasuredTarget 覆盖层）。
 */

import { useEffect, useRef, useState } from 'react';
import type { BoardAction } from '@/lib/ai-native/plugins/board-script';
import type { Rect } from './board-model';
import { hashSeed } from './board-model';
import { RoughStroke } from './RoughStroke';

/** 块的局部坐标系里量墨迹包围盒（文本叶子 + KaTeX 子节点并集） */
function measureLocalInk(block: HTMLElement): Rect | null {
  const leaves = block.querySelectorAll('.mm-chalk-char, .mm-struct, [aria-label]');
  const inkNodes: Element[] =
    leaves.length > 0 ? Array.from(leaves) : Array.from(block.querySelectorAll('.katex-html > *'));
  if (inkNodes.length === 0) return null;
  const blockBox = block.getBoundingClientRect();
  // 当前缩放（flowScale/整板 scale 都含在内）：渲染坐标差 ÷ 缩放 = 布局空间局部坐标
  const scale = block.offsetWidth > 0 ? blockBox.width / block.offsetWidth : 1;
  if (scale <= 0) return null;
  let x1 = Number.POSITIVE_INFINITY;
  let y1 = Number.POSITIVE_INFINITY;
  let x2 = Number.NEGATIVE_INFINITY;
  let y2 = Number.NEGATIVE_INFINITY;
  inkNodes.forEach((node) => {
    const box = node.getBoundingClientRect();
    x1 = Math.min(x1, (box.x - blockBox.x) / scale);
    y1 = Math.min(y1, (box.y - blockBox.y) / scale);
    x2 = Math.max(x2, (box.x + box.width - blockBox.x) / scale);
    y2 = Math.max(y2, (box.y + box.height - blockBox.y) / scale);
  });
  if (!Number.isFinite(x1) || x2 <= x1 || y2 <= y1) return null;
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

interface BlockAnnotationProps {
  /** 仅 circle / underline / mark（单目标块内标注） */
  action: Extract<BoardAction, { type: 'circle' | 'underline' | 'mark' }>;
  paused?: boolean;
}

export function BlockAnnotation({ action, paused = false }: BlockAnnotationProps) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const [ink, setInk] = useState<Rect | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    const block = host?.parentElement;
    if (!host || !block) return undefined;
    let alive = true;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const measure = () => {
      if (!alive) return;
      const measured = measureLocalInk(block);
      if (measured) setInk(measured);
    };
    const frame = requestAnimationFrame(measure);
    // 字体 swap 到位后墨迹会动，fonts.ready 复测一次
    if (typeof document !== 'undefined' && document.fonts && document.fonts.status !== 'loaded') {
      document.fonts.ready.then(() => {
        retryTimer = setTimeout(measure, 120);
      });
    }
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      if (retryTimer) clearTimeout(retryTimer);
    };
    // 块写完后内容不再变，只在挂载时量；action 变（换目标块）才重量
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action]);

  if (!ink) return <span ref={hostRef} aria-hidden="true" />;

  const rect: Rect =
    action.type === 'circle'
      ? { x: ink.x - 8, y: ink.y - 6, width: ink.width + 16, height: ink.height + 12 }
      : action.type === 'underline'
        ? ink
        : // mark：勾/叉落墨迹右肩（块内局部坐标，越出块右缘靠 overflow:visible 展示）
          (() => {
            const size = Math.min(ink.height * 0.95, 46);
            return {
              x: ink.x + ink.width + 10,
              y: ink.y + ink.height / 2 - size / 2,
              width: size,
              height: size,
            };
          })();

  return (
    <span
      ref={hostRef}
      aria-hidden="true"
      className={paused ? 'mm-board-paused' : undefined}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
    >
      <RoughStroke
        kind={action.type === 'mark' ? action.mark : action.type}
        rect={rect}
        seed={hashSeed(`block:${action.type}:${Math.round(ink.x)}:${Math.round(ink.y)}`)}
        durationMs={action.type === 'circle' ? 480 : 360}
      />
    </span>
  );
}
