'use client';

/**
 * BoardLaser — 激光笔瞬态指示（teach-engine laser 动作的真渲染，P3）。
 *
 * 指向某板书元素的光点 + 扩散光圈，2.4s 淡出，不留永久板书（对照 vendor
 * dsl：laser 是 fire-and-forget 特效，引擎侧 EFFECT_AUTO_CLEAR_MS 自动清除）。
 * 瞬态语义在数据层保证：useTeachSession 只在 live 事件置位，事件日志回放
 * 永不重演（这里无需再判断）。
 *
 * 测量：wN 目标走 annotation-measure 的字墨级包围盒；结构化块目标按
 * BoardFlow 外层的 data-element-id 锚点量宿主盒（坐标系换算与标注层同源
 * toVirtualRect）。目标还没渲染/已翻页 → 不画（降级不炸板）。
 */

import { useEffect, useState } from 'react';
import { measureWriteGlyphRect } from '../apps/windows/blackboard/annotation-measure';
import { toVirtualRect } from '../apps/windows/blackboard/board-layout';
import { BOARD_HEIGHT, BOARD_WIDTH } from '../apps/windows/blackboard/board-lecture';
import type { Rect } from '../apps/windows/blackboard/board-model';

export interface LaserPointer {
  target: string;
  color?: string;
  at: number;
}

function measureLaserRect(container: HTMLDivElement, target: string): Rect | null {
  const board = container.querySelector<HTMLDivElement>('[data-board-inner]');
  if (!board) return null;
  if (/^w[1-9]\d*$/.test(target)) return measureWriteGlyphRect(board, target);
  const host = board.querySelector(`[data-element-id="${target.replace(/"/g, '')}"]`);
  if (!host) return null;
  const boardBox = board.getBoundingClientRect();
  const rect = toVirtualRect(host.getBoundingClientRect(), {
    x: boardBox.x,
    y: boardBox.y,
    width: boardBox.width,
    clientLeft: board.clientLeft,
    clientTop: board.clientTop,
  });
  return rect.width > 0 && rect.height > 0 ? rect : null;
}

export function BoardLaser({
  laser,
  containerRef,
}: {
  laser: LaserPointer | null;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [rect, setRect] = useState<Rect | null>(null);

  useEffect(() => {
    setRect(null);
    if (!laser) return undefined;
    let alive = true;
    const measure = () => {
      const container = containerRef.current;
      if (!container || !alive) return;
      const measured = measureLaserRect(container, laser.target);
      if (measured && alive) setRect(measured);
    };
    const frame = requestAnimationFrame(measure);
    // laser 不过语音闸门：目标 write 可能还在逐字生长，300ms 后复测一次取更满的包围盒
    const retry = setTimeout(measure, 300);
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      clearTimeout(retry);
    };
  }, [laser, containerRef]);

  if (!laser || !rect) return null;
  const cx = ((rect.x + rect.width / 2) / BOARD_WIDTH) * 100;
  const cy = ((rect.y + rect.height / 2) / BOARD_HEIGHT) * 100;
  const color = laser.color ?? '#e5484d';

  return (
    <div
      key={laser.at}
      aria-hidden="true"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 10 }}
    >
      <div
        className="mm-laser-dot"
        style={{
          position: 'absolute',
          left: `${cx}%`,
          top: `${cy}%`,
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${color} 0%, ${color} 35%, transparent 72%)`,
          boxShadow: `0 0 14px 5px ${color}66`,
          transform: 'translate(-50%, -50%)',
          animation: 'mm-laser-fade 2.4s ease-out forwards',
        }}
      />
      <div
        className="mm-laser-ring"
        style={{
          position: 'absolute',
          left: `${cx}%`,
          top: `${cy}%`,
          width: 34,
          height: 34,
          borderRadius: '50%',
          border: `2px solid ${color}`,
          transform: 'translate(-50%, -50%)',
          animation: 'mm-laser-ring 0.9s ease-out 2, mm-laser-fade 2.4s ease-out forwards',
        }}
      />
      <style>{`
        @keyframes mm-laser-fade {
          0% { opacity: 1; }
          70% { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes mm-laser-ring {
          from { transform: translate(-50%, -50%) scale(0.45); opacity: 0.9; }
          to { transform: translate(-50%, -50%) scale(1.25); opacity: 0.15; }
        }
      `}</style>
    </div>
  );
}
