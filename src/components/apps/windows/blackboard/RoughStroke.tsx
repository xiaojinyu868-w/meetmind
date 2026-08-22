'use client';

/**
 * RoughStroke — 圈点勾画的手绘笔画（roughjs + stroke-dashoffset 一笔画出）。
 *
 * 必须传固定 seed（目标区域字符串 hash），否则重渲染形状跳变。
 * rough 默认 disableMultiStroke=false 会产出多条 path，这里同时驱动所有
 * path 的 dashoffset，视觉上仍是一笔连贯画出。
 */

import { useEffect, useMemo, useRef } from 'react';
import rough from 'roughjs';
import type { Rect } from './board-model';

/** 朱砂：圈 / 下划线 / 箭头 / 打叉（v31 纸面保留，白纸上的强调色） */
export const CINNABAR = '#D98271';
/** 纸面绿：打勾（粉笔绿 #A8C8A0 在白纸上太淡，加深一档） */
export const MARK_GREEN = '#6FA468';

export type RoughKind = 'circle' | 'underline' | 'arrow' | 'check' | 'cross';

interface RoughStrokeProps {
  kind: RoughKind;
  rect: Rect;
  seed: number;
  /** 一笔画出的时长（300-500ms） */
  durationMs?: number;
  /** arrow 终点（仅 arrow 用，rect 为起终点的包围盒） */
  to?: { x: number; y: number };
  from?: { x: number; y: number };
}

interface StrokePath {
  d: string;
  stroke: string;
  strokeWidth: number;
}

function buildPaths(props: RoughStrokeProps): StrokePath[] {
  const { kind, rect, seed } = props;
  const generator = rough.generator({
    options: { seed, roughness: 1.7, bowing: 1.4 },
  });
  const color = kind === 'check' ? MARK_GREEN : CINNABAR;
  // v31 纸面线宽：白纸上细线发飘，3.3 → 3.6（朱砂圈要一眼可见）
  const options = { stroke: color, strokeWidth: 3.6, fill: 'none' };

  const drawable = (() => {
    switch (kind) {
      case 'circle': {
        // 手绘椭圆圈住区域，略微放大、故意不闭合的正中感
        return generator.ellipse(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2,
          rect.width * 1.12,
          rect.height * 1.35,
          options,
        );
      }
      case 'underline': {
        // 贴墨迹下沿 +2px：行盒余量 + 大手距曾让线划进下一行小字（2026-08-22 实测）
        const y = rect.y + rect.height + 2;
        return generator.linearPath(
          [
            [rect.x, y],
            [rect.x + rect.width * 0.5, y + 2.5],
            [rect.x + rect.width, y],
          ],
          options,
        );
      }
      case 'arrow': {
        // 箭头在 toPaths 之外单独补两笔，见下方 arrowHead
        const from = props.from ?? { x: rect.x, y: rect.y };
        const to = props.to ?? { x: rect.x + rect.width, y: rect.y + rect.height };
        return generator.linearPath(
          [
            [from.x, from.y],
            [(from.x + to.x) / 2, (from.y + to.y) / 2 - 6],
            [to.x, to.y],
          ],
          options,
        );
      }
      case 'check': {
        const { x, y, width: w, height: h } = rect;
        return generator.linearPath(
          [
            [x + w * 0.12, y + h * 0.52],
            [x + w * 0.4, y + h * 0.82],
            [x + w * 0.92, y + h * 0.14],
          ],
          { ...options, strokeWidth: 3.5 },
        );
      }
      case 'cross': {
        const { x, y, width: w, height: h } = rect;
        return generator.linearPath(
          [
            [x + w * 0.15, y + h * 0.15],
            [x + w * 0.5, y + h * 0.5],
            [x + w * 0.85, y + h * 0.85],
            [x + w * 0.5, y + h * 0.5],
            [x + w * 0.85, y + h * 0.15],
            [x + w * 0.5, y + h * 0.5],
            [x + w * 0.15, y + h * 0.85],
          ],
          { ...options, strokeWidth: 3.5 },
        );
      }
    }
  })();

  const paths: StrokePath[] = generator
    .toPaths(drawable)
    .filter((path) => path.d && path.stroke !== 'none')
    .map((path) => ({
      d: path.d,
      stroke: path.stroke ?? color,
      strokeWidth: path.strokeWidth ?? 3.3,
    }));

  // 箭头头部两笔
  if (kind === 'arrow' && props.from && props.to) {
    const angle = Math.atan2(props.to.y - props.from.y, props.to.x - props.from.x);
    const headLength = 13;
    for (const spread of [Math.PI * 0.82, -Math.PI * 0.82]) {
      const tip = props.to;
      const tail = {
        x: tip.x + headLength * Math.cos(angle + spread),
        y: tip.y + headLength * Math.sin(angle + spread),
      };
      const head = generator.line(tip.x, tip.y, tail.x, tail.y, options);
      for (const path of generator.toPaths(head)) {
        if (path.d && path.stroke !== 'none') {
          paths.push({ d: path.d, stroke: path.stroke ?? color, strokeWidth: path.strokeWidth ?? 3.3 });
        }
      }
    }
  }

  return paths;
}

export function RoughStroke(props: RoughStrokeProps) {
  const { durationMs = 420 } = props;
  const paths = useMemo(
    () => buildPaths(props),
    // seed 已含定位信息；props 变化低频，逐项依赖即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.kind, props.seed, props.rect.x, props.rect.y, props.rect.width, props.rect.height],
  );
  const groupRef = useRef<SVGGElement>(null);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    const elements = Array.from(group.querySelectorAll('path'));
    const frames: number[] = [];
    elements.forEach((element, index) => {
      const length = element.getTotalLength();
      element.style.strokeDasharray = `${length}`;
      element.style.strokeDashoffset = `${length}`;
      // 强制 reflow 后归零，多条 path 同时驱动、主笔略错开
      element.getBoundingClientRect();
      element.style.transition = `stroke-dashoffset ${durationMs}ms ease-in-out ${index * 60}ms`;
      frames.push(
        requestAnimationFrame(() => {
          element.style.strokeDashoffset = '0';
        }),
      );
    });
    return () => frames.forEach((frame) => cancelAnimationFrame(frame));
  }, [paths, durationMs]);

  const { rect } = props;
  const pad = 16;
  return (
    <svg
      className="pointer-events-none absolute"
      style={{
        left: 0,
        top: 0,
        width: '100%',
        height: '100%',
        overflow: 'visible',
      }}
      aria-hidden="true"
    >
      <g ref={groupRef} filter="url(#mm-chalk-rough)">
        {paths.map((path, index) => (
          <path
            key={index}
            d={path.d}
            fill="none"
            stroke={path.stroke}
            strokeWidth={path.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </g>
      {/* 占位：保证 svg 有布局尺寸 */}
      <rect x={rect.x - pad} y={rect.y - pad} width={1} height={1} fill="none" />
    </svg>
  );
}
