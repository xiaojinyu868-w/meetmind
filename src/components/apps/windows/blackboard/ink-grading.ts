'use client';

/**
 * ink-grading（客户端）—— 板演笔迹栅格化与网格坐标换算。
 *
 * 与服务端 ink-grading-service 共用网格契约（6 列 × 4 行，行 A-D 列 1-6）：
 * 笔迹 polyline 画到黑板底色上 + 叠加标注网格 → dataURL 送 VLM；
 * VLM 返回 cell（如 "B2"）→ cellCenter 换回 960×540 板面虚拟坐标落勾叉。
 */

import type { InkStroke } from './StudentInkLayer';
import { INK_BLUE } from './StudentInkLayer';

export const GRID_COLS = 6;
export const GRID_ROWS = 4;

const BOARD_W = 960;
const BOARD_H = 540;
const BOARD_BG = '#1f2a2e';
/** 栅格化放大倍数：VLM 看大图更准 */
const RASTER_SCALE = 2;

/** cell（行字母+列数字，如 "B2"）→ 格子中心的板面虚拟坐标；非法返回 null。 */
export function cellCenter(
  cell: string,
  cols: number = GRID_COLS,
  rows: number = GRID_ROWS,
): { x: number; y: number } | null {
  const match = /^([A-Z])(\d{1,2})$/.exec(cell.trim().toUpperCase());
  if (!match) return null;
  const row = match[1].charCodeAt(0) - 65;
  const col = Number(match[2]) - 1;
  if (row < 0 || row >= rows || col < 0 || col >= cols) return null;
  return {
    x: ((col + 0.5) / cols) * BOARD_W,
    y: ((row + 0.5) / rows) * BOARD_H,
  };
}

function parsePoints(points: string): Array<[number, number]> {
  return points
    .split(' ')
    .map((pair) => {
      const [x, y] = pair.split(',').map(Number);
      return [x, y] as [number, number];
    })
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
}

/**
 * 把学生笔迹栅格化成送 VLM 的图：黑板底色 + 标注网格（行字母在左、列数字在上）
 * + 粉笔蓝笔迹。返回 PNG dataURL。
 */
export function rasterizeInkForGrading(
  strokes: InkStroke[],
  cols: number = GRID_COLS,
  rows: number = GRID_ROWS,
): string {
  const canvas = document.createElement('canvas');
  canvas.width = BOARD_W * RASTER_SCALE;
  canvas.height = BOARD_H * RASTER_SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.scale(RASTER_SCALE, RASTER_SCALE);

  // 板面底色
  ctx.fillStyle = BOARD_BG;
  ctx.fillRect(0, 0, BOARD_W, BOARD_H);

  // 网格线 + 标注（行字母左缘、列数字顶缘）
  ctx.strokeStyle = 'rgba(245,242,232,0.28)';
  ctx.lineWidth = 1;
  ctx.fillStyle = 'rgba(245,242,232,0.75)';
  ctx.font = '600 15px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let col = 1; col < cols; col += 1) {
    const x = (col / cols) * BOARD_W;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, BOARD_H);
    ctx.stroke();
  }
  for (let row = 1; row < rows; row += 1) {
    const y = (row / rows) * BOARD_H;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(BOARD_W, y);
    ctx.stroke();
  }
  for (let col = 0; col < cols; col += 1) {
    ctx.fillText(String(col + 1), ((col + 0.5) / cols) * BOARD_W, 13);
  }
  for (let row = 0; row < rows; row += 1) {
    ctx.fillText(String.fromCharCode(65 + row), 12, ((row + 0.5) / rows) * BOARD_H);
  }

  // 学生笔迹（加粗一档，VLM 更容易看清）
  ctx.strokeStyle = INK_BLUE;
  ctx.lineWidth = 4.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const stroke of strokes) {
    const points = parsePoints(stroke.points);
    if (points.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (const [x, y] of points.slice(1)) ctx.lineTo(x, y);
    ctx.stroke();
  }

  return canvas.toDataURL('image/png');
}
