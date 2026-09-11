/**
 * analysis —— <draw> 运行时的分析内核：函数采样、数值微积分、求根、极值、参数 / 极坐标曲线。
 * 纯数学，零 DOM。表达式字符串走 lib/utils/safe-math 的手写求值器（无 eval）。
 */

import { compileExpression } from '@/lib/utils/safe-math';
import type { Pt } from './geometry';

export type Fn1 = (x: number) => number;

/** 字符串表达式（"x^2 - 2x"）或 JS 函数 → 一元函数 */
export function toFn(f: string | Fn1): Fn1 {
  if (typeof f === 'function') return f;
  return compileExpression(f);
}

/** 均匀采样；非有限值留 NaN 由渲染层断开 */
export function sample(f: Fn1, a: number, b: number, n = 320): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const x = a + ((b - a) * i) / n;
    let y: number;
    try {
      y = f(x);
    } catch {
      y = NaN;
    }
    out.push({ x, y: Number.isFinite(y) ? y : NaN });
  }
  return out;
}

/** 五点中心差分导数 */
export function derivative(f: Fn1, x: number, h = 1e-4): number {
  return (-f(x + 2 * h) + 8 * f(x + h) - 8 * f(x - h) + f(x - 2 * h)) / (12 * h);
}

export function secondDerivative(f: Fn1, x: number, h = 1e-3): number {
  return (f(x + h) - 2 * f(x) + f(x - h)) / (h * h);
}

/** 复合辛普森积分 */
export function integral(f: Fn1, a: number, b: number, n = 400): number {
  if (n % 2) n += 1;
  const h = (b - a) / n;
  let s = f(a) + f(b);
  for (let i = 1; i < n; i++) s += f(a + i * h) * (i % 2 ? 4 : 2);
  return (s * h) / 3;
}

/** 区间内的所有实根（先扫描变号，再二分收敛） */
export function roots(f: Fn1, a: number, b: number, scan = 400): number[] {
  const out: number[] = [];
  let prevX = a;
  let prevY = f(a);
  for (let i = 1; i <= scan; i++) {
    const x = a + ((b - a) * i) / scan;
    const y = f(x);
    if (Number.isFinite(prevY) && Number.isFinite(y)) {
      if (prevY === 0) out.push(prevX);
      else if (prevY * y < 0 && Math.abs(y - prevY) < Math.abs(b - a) * 1e3) {
        let lo = prevX;
        let hi = x;
        let flo = prevY;
        for (let k = 0; k < 60; k++) {
          const mid = (lo + hi) / 2;
          const fm = f(mid);
          if (flo * fm <= 0) hi = mid;
          else {
            lo = mid;
            flo = fm;
          }
        }
        out.push((lo + hi) / 2);
      }
    }
    prevX = x;
    prevY = y;
  }
  // 去重（相邻根）
  return out.filter((r, i) => i === 0 || Math.abs(r - out[i - 1]) > (b - a) / scan);
}

export interface Extremum {
  x: number;
  y: number;
  kind: 'min' | 'max';
}

/** 区间内的局部极值（导数变号处） */
export function extrema(f: Fn1, a: number, b: number): Extremum[] {
  const df: Fn1 = (x) => derivative(f, x);
  return roots(df, a, b).map((x) => ({ x, y: f(x), kind: secondDerivative(f, x) > 0 ? 'min' : 'max' }));
}

/** 切线：y = f(x0) + f'(x0)(x - x0)，返回两端点（在 [a,b] 上） */
export function tangentSegment(f: Fn1, x0: number, a: number, b: number): [Pt, Pt] {
  const k = derivative(f, x0);
  const y0 = f(x0);
  return [
    { x: a, y: y0 + k * (a - x0) },
    { x: b, y: y0 + k * (b - x0) },
  ];
}

/** 法线两端点 */
export function normalSegment(f: Fn1, x0: number, halfLen: number): [Pt, Pt] {
  const k = derivative(f, x0);
  const y0 = f(x0);
  if (Math.abs(k) < 1e-12) return [{ x: x0, y: y0 - halfLen }, { x: x0, y: y0 + halfLen }];
  const kn = -1 / k;
  const dx = halfLen / Math.sqrt(1 + kn * kn);
  return [
    { x: x0 - dx, y: y0 - kn * dx },
    { x: x0 + dx, y: y0 + kn * dx },
  ];
}

/** 参数曲线采样 */
export function sampleParametric(g: (t: number) => [number, number] | Pt, t0: number, t1: number, n = 400): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = t0 + ((t1 - t0) * i) / n;
    try {
      const v = g(t);
      const p = Array.isArray(v) ? { x: v[0], y: v[1] } : v;
      out.push({ x: Number.isFinite(p.x) ? p.x : NaN, y: Number.isFinite(p.y) ? p.y : NaN });
    } catch {
      out.push({ x: NaN, y: NaN });
    }
  }
  return out;
}

/** 极坐标曲线 r(θ)（θ 为度）采样 */
export function samplePolar(r: (thetaDeg: number) => number, a: number, b: number, n = 400): Pt[] {
  return sampleParametric(
    (t) => {
      const rr = r(t);
      const rad = (t * Math.PI) / 180;
      return [rr * Math.cos(rad), rr * Math.sin(rad)];
    },
    a,
    b,
    n,
  );
}

/** 两函数交点的 x（区间内） */
export function intersections(f: Fn1, g: Fn1, a: number, b: number): Pt[] {
  return roots((x) => f(x) - g(x), a, b).map((x) => ({ x, y: f(x) }));
}
