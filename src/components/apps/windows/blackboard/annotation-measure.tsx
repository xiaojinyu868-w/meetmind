'use client';

/**
 * annotation-measure — 标注 bounds 实测（v9：字墨级 + fonts.ready 复测）。
 *
 * circle/underline/mark/arrow 的目标区域用真实渲染结果取包围盒：
 * - 字元 span 的 rect（v32 起全部 token 都是字体字；v31 及更早的
 *   hanzi-writer 笔顺字 path 级测量分支保留，对字体字自动落空）
 * - 坐标换算：toVirtualRect 统一处理 border（clientLeft）与 transform 缩放
 * - 测量时机：挂载一次 + document.fonts.ready 后复测一次（swap 字体到位
 *   会改变字墨位置，一次性测量会留下旧坐标）
 * - 预估算（resolveTargetRect）仅作元素找不到时的 fallback
 */

import { useEffect, useState } from 'react';
import { parseWriteRef } from '@/lib/ai-native/plugins/board-script';
import { resolveTargetRect, toVirtualRect } from './board-layout';
import type { BoardPageLayout } from './board-layout';
import type { Rect } from './board-model';

/** 字墨级包围盒：笔顺字量内部 path（真实笔画像素），字体字量 span 盒子。 */
function leafInkRect(leaf: Element): { x: number; y: number; width: number; height: number } {
  if (leaf.hasAttribute('aria-label')) {
    const paths = leaf.querySelectorAll('path');
    if (paths.length > 0) {
      let x1 = Number.POSITIVE_INFINITY;
      let y1 = Number.POSITIVE_INFINITY;
      let x2 = Number.NEGATIVE_INFINITY;
      let y2 = Number.NEGATIVE_INFINITY;
      paths.forEach((path) => {
        const box = path.getBoundingClientRect();
        if (box.width === 0 && box.height === 0) return;
        x1 = Math.min(x1, box.x);
        y1 = Math.min(y1, box.y);
        x2 = Math.max(x2, box.x + box.width);
        y2 = Math.max(y2, box.y + box.height);
      });
      if (Number.isFinite(x1) && x2 > x1 && y2 > y1) {
        return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
      }
    }
  }
  return leaf.getBoundingClientRect();
}

/**
 * 实测目标 write 的字墨包围盒（960×540 虚拟坐标）。
 * 元素找不到（还没渲染 / 已翻页）返回 null，调用方退回预估算。
 */
export function measureWriteGlyphRect(board: HTMLDivElement, writeId: string): Rect | null {
  const host = board.querySelector(`[data-write-id="${writeId}"]`);
  if (!host) return null;
  // v30：.mm-struct（高亮等行内结构的外层）必须计入——否则圈只框住普通字符。
  // v31：KaTeX 公式块（BoardFormula 根节点本身带 mm-struct，querySelectorAll
  // 不包含宿主自身）内部没有任何叶子类——测不到叶子时退而量宿主盒，
  // 圈/下划线才能框住整个公式（2026-08-21 实拍"公式上的圈消失"根修）
  const leaves = host.querySelectorAll('.mm-chalk-char, .mm-struct, [aria-label]');

  const boardBox = board.getBoundingClientRect();
  const boardRef = {
    x: boardBox.x,
    y: boardBox.y,
    width: boardBox.width,
    clientLeft: board.clientLeft,
    clientTop: board.clientTop,
  };

  // 注意（2026-08-21 根修）：实测坐标**不要再除 flowScale**。DOM 实测本就是
  // transform 收缩后的真值，而标注层（mm-board-page 内）不随 flowContent 缩放——
  // 除一次会把标注吹到 1/flowScale 倍的右下虚空（v29 遗留 bug，收缩页实拍
  // "圈消失、下划线悬空"根因）。flowScale 的作用只是**触发重测**（MeasuredTarget
  // 的 effect dep），不参与坐标换算。

  if (leaves.length === 0) {
    // 公式块等无叶子宿主：量 KaTeX 墨迹（displayMode 下 .katex/.katex-html 都是
    // block 满栏宽——量它们圈会横跨整栏；墨迹收缩在 .katex-html 的直接子节点，
    // inline-block 居中排列），取子节点并集；没有子节点再退宿主盒
    const inkNodes = host.querySelectorAll('.katex-html > *');
    const boxes: { x: number; y: number; width: number; height: number }[] =
      inkNodes.length > 0
        ? Array.from(inkNodes).map((node) => node.getBoundingClientRect())
        : [host.getBoundingClientRect()];
    let x1 = Number.POSITIVE_INFINITY;
    let y1 = Number.POSITIVE_INFINITY;
    let x2 = Number.NEGATIVE_INFINITY;
    let y2 = Number.NEGATIVE_INFINITY;
    boxes.forEach((box) => {
      const virtual = toVirtualRect(box, boardRef);
      x1 = Math.min(x1, virtual.x);
      y1 = Math.min(y1, virtual.y);
      x2 = Math.max(x2, virtual.x + virtual.width);
      y2 = Math.max(y2, virtual.y + virtual.height);
    });
    if (!Number.isFinite(x1) || x2 <= x1 || y2 <= y1) return null;
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
  }

  let x1 = Number.POSITIVE_INFINITY;
  let y1 = Number.POSITIVE_INFINITY;
  let x2 = Number.NEGATIVE_INFINITY;
  let y2 = Number.NEGATIVE_INFINITY;
  leaves.forEach((leaf) => {
    const virtual = toVirtualRect(leafInkRect(leaf), boardRef);
    x1 = Math.min(x1, virtual.x);
    y1 = Math.min(y1, virtual.y);
    x2 = Math.max(x2, virtual.x + virtual.width);
    y2 = Math.max(y2, virtual.y + virtual.height);
  });
  if (!Number.isFinite(x1) || x2 <= x1 || y2 <= y1) return null;
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/** target（'w3' 或 ['w2','w4']）的实测包围盒（多个取并集）；任一目标测不到返回 null。 */
export function measureTargetRect(board: HTMLDivElement, target: string | string[]): Rect | null {
  const refs = (Array.isArray(target) ? target : [target])
    .map(parseWriteRef)
    .filter((ref): ref is number => ref !== null);
  if (refs.length === 0) return null;
  const rects = refs.map((ref) => measureWriteGlyphRect(board, `w${ref}`));
  if (rects.some((rect) => rect === null)) return null;
  const valid = rects as Rect[];
  const x1 = Math.min(...valid.map((rect) => rect.x));
  const y1 = Math.min(...valid.map((rect) => rect.y));
  const x2 = Math.max(...valid.map((rect) => rect.x + rect.width));
  const y2 = Math.max(...valid.map((rect) => rect.y + rect.height));
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/**
 * 标注 bounds 提供者：目标 write 写完后实测；**layout 变化（checkpoint extras
 * 上板触发整页重排）时必须重测**——否则文字搬走、圈留在旧坐标（v9 修的偏移
 * 根因）。字体未加载完（font-display:swap 还在兜底）时等 fonts.ready 复测。
 * debug=true 时把实测 rect 用细线框画出来（?debug=bounds 调试用）。
 */
export function MeasuredTarget({
  target,
  layout,
  flowScale = 1,
  epoch = 0,
  boardRef,
  debug = false,
  children,
}: {
  target: string | string[];
  /** v29 起可选：仅作 DOM 实测失败时的预估算 fallback */
  layout?: BoardPageLayout;
  /** v29 流式画布：内容收缩比例（变化时重测） */
  flowScale?: number;
  /** v32 标注跟随：内容纪元（BoardCanvas 在内容尺寸变化时 bump），变化即重测 */
  epoch?: number;
  boardRef: React.RefObject<HTMLDivElement | null>;
  debug?: boolean;
  children: (rect: Rect) => React.ReactNode;
}) {
  const [rect, setRect] = useState<Rect | null>(null);
  useEffect(() => {
    let alive = true;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const measure = () => {
      const board = boardRef.current;
      if (!board || !alive) return;
      const measured = measureTargetRect(board, target);
      if (measured) setRect(measured);
    };
    // 等一帧让重排后的 DOM 稳定再量
    const frame = requestAnimationFrame(measure);

    const board = boardRef.current;
    if (!board) {
      setRect(layout ? resolveTargetRect(target, layout) : null);
      return () => {
        alive = false;
        cancelAnimationFrame(frame);
      };
    }
    // 兜底字体量出来的 bounds 在字体到位后会偏，fonts.ready 后复测一次
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
    // layout 变化（extras 回流）/ flowScale 变化（溢出收缩）/ epoch（内容纪元，
    // v32 标注跟随）必须重测；target 同理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, target, flowScale, epoch]);
  if (!rect) return null;
  return (
    <>
      {debug ? (
        <div
          aria-hidden="true"
          className="mm-debug-bounds"
          style={{
            position: 'absolute',
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
            border: '1px solid rgba(158,197,232,0.9)',
            pointerEvents: 'none',
          }}
        />
      ) : null}
      {children(rect)}
    </>
  );
}
