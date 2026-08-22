import { describe, expect, it } from 'vitest';
import { toVirtualRect, BOARD_VIRTUAL_WIDTH } from './board-layout';

describe('toVirtualRect（视口 rect → 板面虚拟坐标）', () => {
  it('无缩放无 border：恒等换算', () => {
    const rect = toVirtualRect(
      { x: 100, y: 50, width: 200, height: 30 },
      { x: 0, y: 0, width: 960, clientLeft: 0, clientTop: 0 },
    );
    expect(rect).toEqual({ x: 100, y: 50, width: 200, height: 30 });
  });

  it('border（clientLeft/clientTop）在缩放前计入原点', () => {
    // 9px 木框、无缩放：内容原点在 (9, 9)
    const rect = toVirtualRect(
      { x: 9 + 80, y: 9 + 67.5, width: 100, height: 20 },
      { x: 0, y: 0, width: 960, clientLeft: 9, clientTop: 9 },
    );
    expect(rect.x).toBeCloseTo(80, 5);
    expect(rect.y).toBeCloseTo(67.5, 5);
  });

  it('transform 缩放 0.5：boardBox 是变换后尺寸，border 也按缩放比缩小', () => {
    // 板面以 0.5 缩放渲染：boardBox.width=480，border 在屏幕上是 4.5px
    const scale = 0.5;
    const board = { x: 20, y: 10, width: 960 * scale, clientLeft: 9, clientTop: 9 };
    const rect = toVirtualRect(
      { x: 20 + (9 + 100) * scale, y: 10 + (9 + 60) * scale, width: 200 * scale, height: 40 * scale },
      board,
    );
    expect(rect.x).toBeCloseTo(100, 4);
    expect(rect.y).toBeCloseTo(60, 4);
    expect(rect.width).toBeCloseTo(200, 4);
    expect(rect.height).toBeCloseTo(40, 4);
  });

  it('板面平移到非零偏移也能正确换算', () => {
    const rect = toVirtualRect(
      { x: 320 + 9, y: 200 + 9, width: 50, height: 20 },
      { x: 320, y: 200, width: 960, clientLeft: 9, clientTop: 9 },
    );
    expect(rect.x).toBeCloseTo(0, 5);
    expect(rect.y).toBeCloseTo(0, 5);
    expect(BOARD_VIRTUAL_WIDTH).toBe(960);
  });
});
