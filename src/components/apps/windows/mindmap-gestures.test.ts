import { describe, expect, it } from 'vitest';
import {
  applyPinch,
  clampPan,
  inertiaStep,
  mindmapKeyTarget,
  parentIdOf,
  pathIdsOf,
  shouldStartInertia,
  zoomAround,
} from './mindmap-gestures';

describe('mindmap-gestures', () => {
  it('以光标为锚缩放：锚点下的内容不动', () => {
    const t = { x: 100, y: 50, scale: 1 };
    const anchor = { x: 300, y: 200 };
    const contentUnderAnchor = { x: (anchor.x - t.x) / t.scale, y: (anchor.y - t.y) / t.scale };
    const next = zoomAround(t, 2, anchor);
    expect(next.scale).toBe(2);
    expect(next.x + contentUnderAnchor.x * next.scale).toBeCloseTo(anchor.x);
    expect(next.y + contentUnderAnchor.y * next.scale).toBeCloseTo(anchor.y);
    expect(zoomAround(t, 100, anchor).scale).toBe(2.6);
    expect(zoomAround(t, 0.01, anchor).scale).toBe(0.3);
  });

  it('平移边界：内容大时至少留 96px 在视口里；内容小时不限制在视口内的位置', () => {
    const viewport = { width: 800, height: 600 };
    const big = { width: 2000, height: 1500 };
    const far = clampPan({ x: -5000, y: -5000, scale: 1 }, big, viewport);
    expect(far.x).toBe(96 - 2000);
    expect(far.y).toBe(96 - 1500);
    const other = clampPan({ x: 5000, y: 5000, scale: 1 }, big, viewport);
    expect(other.x).toBe(800 - 96);
    expect(other.y).toBe(600 - 96);
    const small = { width: 300, height: 200 };
    expect(clampPan({ x: 250, y: 200, scale: 1 }, small, viewport)).toEqual({ x: 250, y: 200, scale: 1 });
  });

  it('惯性逐帧衰减到停', () => {
    expect(shouldStartInertia({ x: 0.05, y: 0.05 })).toBe(false);
    expect(shouldStartInertia({ x: 0.5, y: 0 })).toBe(true);
    let velocity = { x: 1, y: 0 };
    let frames = 0;
    let travelled = 0;
    for (;;) {
      const step = inertiaStep(velocity, 16);
      if (!step) break;
      travelled += step.delta.x;
      velocity = step.velocity;
      frames += 1;
    }
    expect(frames).toBeGreaterThan(20);
    expect(frames).toBeLessThan(120);
    expect(travelled).toBeGreaterThan(100);
  });

  it('双指：距离拉大两倍 → scale ×2，跟着中点走', () => {
    const t = { x: 0, y: 0, scale: 1 };
    const next = applyPinch(t, [{ x: 100, y: 100 }, { x: 200, y: 100 }], [{ x: 60, y: 100 }, { x: 260, y: 100 }]);
    expect(next.scale).toBeCloseTo(2);
    // 中点 (150,100) 下的内容仍在 (160,100)（中点右移 10）
    expect(next.x + 150 * next.scale).toBeCloseTo(160);
  });

  it('节点 id 的父子关系与根到节点路径', () => {
    expect(parentIdOf('root')).toBeNull();
    expect(parentIdOf('root-0')).toBe('root');
    expect(parentIdOf('root-0-2')).toBe('root-0');
    expect([...pathIdsOf('root-1-0')]).toEqual(['root-1-0', 'root-1', 'root']);
  });

  it('方向键：右侧子树 → 进子节点、← 回父；左侧子树镜像；↑↓ 在兄弟间移动', () => {
    const nodes = [
      { id: 'root', y: 0 },
      { id: 'root-0', y: -100, side: 'right' as const },
      { id: 'root-0-0', y: -120, side: 'right' as const },
      { id: 'root-0-1', y: -80, side: 'right' as const },
      { id: 'root-1', y: 100, side: 'right' as const },
      { id: 'root-2', y: 0, side: 'left' as const },
      { id: 'root-2-0', y: 0, side: 'left' as const },
    ];
    expect(mindmapKeyTarget(nodes, 'root', 'ArrowRight')).toBe('root-0');
    expect(mindmapKeyTarget(nodes, 'root', 'ArrowLeft')).toBe('root-2');
    expect(mindmapKeyTarget(nodes, 'root-0', 'ArrowRight')).toBe('root-0-0');
    expect(mindmapKeyTarget(nodes, 'root-0-0', 'ArrowDown')).toBe('root-0-1');
    expect(mindmapKeyTarget(nodes, 'root-0-1', 'ArrowUp')).toBe('root-0-0');
    expect(mindmapKeyTarget(nodes, 'root-0-1', 'ArrowDown')).toBeNull();
    expect(mindmapKeyTarget(nodes, 'root-0-0', 'ArrowLeft')).toBe('root-0');
    expect(mindmapKeyTarget(nodes, 'root-0', 'ArrowDown')).toBe('root-1');
    // 左侧：← 往外进子节点，→ 回父
    expect(mindmapKeyTarget(nodes, 'root-2', 'ArrowLeft')).toBe('root-2-0');
    expect(mindmapKeyTarget(nodes, 'root-2-0', 'ArrowRight')).toBe('root-2');
    expect(mindmapKeyTarget(nodes, 'root-2', 'ArrowRight')).toBe('root');
    expect(mindmapKeyTarget(nodes, 'missing', 'ArrowRight')).toBe('root');
  });
});
