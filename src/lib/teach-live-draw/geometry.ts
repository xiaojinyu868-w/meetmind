/**
 * geometry —— <draw> 运行时的几何内核（纯数学，零 DOM，可在 Worker 里跑）。
 *
 * 一切构造都是**计算**：切线是过切点垂直半径的直线，外点切线解直角三角形，交点解方程。
 * 老师（模型）只说"过 P 作圆 O 的切线"，垂直与相切由这里保证。
 * 坐标系是数学坐标（y 向上），渲染时再换到像素。
 */

export interface Pt {
  x: number;
  y: number;
}

/** 直线 / 射线 / 线段共用一个表示：两点 + 类型 */
export interface Ln {
  a: Pt;
  b: Pt;
  type: 'line' | 'ray' | 'segment';
}

export interface Circ {
  c: Pt;
  r: number;
}

export const EPS = 1e-9;

export const pt = (x: number, y: number): Pt => ({ x, y });
export const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Pt, b: Pt): number => a.x * b.x + a.y * b.y;
export const cross = (a: Pt, b: Pt): number => a.x * b.y - a.y * b.x;
export const len = (a: Pt): number => Math.hypot(a.x, a.y);
export const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);
export const norm = (a: Pt): Pt => {
  const l = len(a);
  return l < EPS ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
};
/** 逆时针旋转 90° 的法向 */
export const perp = (a: Pt): Pt => ({ x: -a.y, y: a.x });
export const deg2rad = (d: number): number => (d * Math.PI) / 180;
export const rad2deg = (r: number): number => (r * 180) / Math.PI;

export const midpoint = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** 线段 AB 上的定比分点：t=0 → A，t=1 → B */
export const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** 从 O 出发、极角 deg（度）、长 r 的点 */
export const polar = (o: Pt, r: number, deg: number): Pt => ({
  x: o.x + r * Math.cos(deg2rad(deg)),
  y: o.y + r * Math.sin(deg2rad(deg)),
});

export const onCircle = (c: Circ, deg: number): Pt => polar(c.c, c.r, deg);

/** 向量 (B-A) 的极角，度，(-180, 180] */
export const heading = (a: Pt, b: Pt): number => rad2deg(Math.atan2(b.y - a.y, b.x - a.x));

/** ∠ABC 的大小（度，0–180） */
export function angleOf(a: Pt, b: Pt, c: Pt): number {
  const u = sub(a, b);
  const v = sub(c, b);
  const cos = dot(u, v) / (len(u) * len(v) || EPS);
  return rad2deg(Math.acos(Math.max(-1, Math.min(1, cos))));
}

export const rotate = (p: Pt, o: Pt, deg: number): Pt => {
  const r = deg2rad(deg);
  const d = sub(p, o);
  return { x: o.x + d.x * Math.cos(r) - d.y * Math.sin(r), y: o.y + d.x * Math.sin(r) + d.y * Math.cos(r) };
};

export const translate = (p: Pt, dx: number, dy: number): Pt => ({ x: p.x + dx, y: p.y + dy });

export const line = (a: Pt, b: Pt, type: Ln['type'] = 'line'): Ln => ({ a, b, type });

/** 过 P、方向角 deg 的直线 */
export const lineThrough = (p: Pt, deg: number): Ln => ({ a: p, b: polar(p, 1, deg), type: 'line' });

/** P 在直线 l 上的垂足 */
export function foot(p: Pt, l: Ln): Pt {
  const d = sub(l.b, l.a);
  const t = dot(sub(p, l.a), d) / (dot(d, d) || EPS);
  return add(l.a, mul(d, t));
}

/** 过 P 且垂直于 l 的直线 */
export const perpendicular = (l: Ln, p: Pt): Ln => ({ a: p, b: add(p, perp(sub(l.b, l.a))), type: 'line' });

/** 过 P 且平行于 l 的直线 */
export const parallel = (l: Ln, p: Pt): Ln => ({ a: p, b: add(p, sub(l.b, l.a)), type: 'line' });

/** 线段 AB 的垂直平分线 */
export const perpBisector = (a: Pt, b: Pt): Ln => perpendicular(line(a, b), midpoint(a, b));

/** ∠ABC 的平分线（从 B 出发的射线） */
export function bisector(a: Pt, b: Pt, c: Pt): Ln {
  const u = norm(sub(a, b));
  const v = norm(sub(c, b));
  const dir = add(u, v);
  const d = len(dir) < EPS ? perp(u) : dir;
  return { a: b, b: add(b, d), type: 'ray' };
}

export function reflect(p: Pt, l: Ln): Pt {
  const f = foot(p, l);
  return { x: 2 * f.x - p.x, y: 2 * f.y - p.y };
}

/** 两直线交点（平行返回 null）；按 type 检查参数范围（射线 / 线段） */
export function intersectLines(l1: Ln, l2: Ln): Pt | null {
  const d1 = sub(l1.b, l1.a);
  const d2 = sub(l2.b, l2.a);
  const den = cross(d1, d2);
  if (Math.abs(den) < EPS) return null;
  const w = sub(l2.a, l1.a);
  const t = cross(w, d2) / den;
  const s = cross(w, d1) / den;
  if (!inRange(t, l1.type) || !inRange(s, l2.type)) return null;
  return add(l1.a, mul(d1, t));
}

function inRange(t: number, type: Ln['type']): boolean {
  if (type === 'line') return true;
  if (type === 'ray') return t >= -EPS;
  return t >= -EPS && t <= 1 + EPS;
}

/** 直线与圆的交点（0 / 1 / 2 个，按沿直线方向排序） */
export function intersectLineCircle(l: Ln, c: Circ): Pt[] {
  const d = sub(l.b, l.a);
  const f = sub(l.a, c.c);
  const A = dot(d, d);
  const B = 2 * dot(f, d);
  const C = dot(f, f) - c.r * c.r;
  const disc = B * B - 4 * A * C;
  if (disc < -EPS) return [];
  const sq = Math.sqrt(Math.max(0, disc));
  const ts = disc < EPS ? [-B / (2 * A)] : [(-B - sq) / (2 * A), (-B + sq) / (2 * A)];
  return ts.filter((t) => inRange(t, l.type)).map((t) => add(l.a, mul(d, t)));
}

/** 两圆交点（0 / 1 / 2 个） */
export function intersectCircles(c1: Circ, c2: Circ): Pt[] {
  const d = dist(c1.c, c2.c);
  if (d < EPS || d > c1.r + c2.r + EPS || d < Math.abs(c1.r - c2.r) - EPS) return [];
  const a = (c1.r * c1.r - c2.r * c2.r + d * d) / (2 * d);
  const h2 = c1.r * c1.r - a * a;
  const h = Math.sqrt(Math.max(0, h2));
  const u = norm(sub(c2.c, c1.c));
  const m = add(c1.c, mul(u, a));
  if (h < EPS) return [m];
  const n = perp(u);
  return [add(m, mul(n, h)), sub(m, mul(n, h))];
}

/** 过圆上一点 P 的切线：垂直于半径 OP */
export function tangentAt(c: Circ, p: Pt): Ln {
  const radial = sub(p, c.c);
  return { a: p, b: add(p, perp(radial)), type: 'line' };
}

/** 从外点 P 向圆作切线，返回两个切点（P 在圆内返回 []，在圆上返回 [P]） */
export function tangentPoints(p: Pt, c: Circ): Pt[] {
  const d = dist(p, c.c);
  if (d < c.r - EPS) return [];
  if (Math.abs(d - c.r) < EPS) return [p];
  // 切点在以 OP 为直径的圆与原圆的交点上
  const m = midpoint(p, c.c);
  return intersectCircles(c, { c: m, r: d / 2 });
}

/** 三点确定的圆（共线返回 null） */
export function circumcircle(a: Pt, b: Pt, c: Pt): Circ | null {
  const o = intersectLines(perpBisector(a, b), perpBisector(b, c));
  if (!o) return null;
  return { c: o, r: dist(o, a) };
}

/** 三角形内切圆 */
export function incircle(a: Pt, b: Pt, c: Pt): Circ | null {
  const la = dist(b, c);
  const lb = dist(a, c);
  const lc = dist(a, b);
  const p = la + lb + lc;
  if (p < EPS) return null;
  const center = { x: (la * a.x + lb * b.x + lc * c.x) / p, y: (la * a.y + lb * b.y + lc * c.y) / p };
  const area = Math.abs(cross(sub(b, a), sub(c, a))) / 2;
  return { c: center, r: (2 * area) / p };
}

export function centroid(points: Pt[]): Pt {
  if (points.length === 0) return { x: 0, y: 0 };
  const s = points.reduce((acc, p) => add(acc, p), { x: 0, y: 0 });
  return mul(s, 1 / points.length);
}

/** 多边形有向面积（逆时针为正） */
export function polygonArea(points: Pt[]): number {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    s += cross(p, q);
  }
  return s / 2;
}

/** 在线段 AB 上、位于 outsideOf 反侧构造正方形（勾股定理的三个正方形就是它） */
export function squareOn(a: Pt, b: Pt, outsideOf: Pt): Pt[] {
  const d = sub(b, a);
  let n = perp(d);
  // 让正方形朝远离 outsideOf 的一侧
  const toCenter = sub(outsideOf, midpoint(a, b));
  if (dot(n, toCenter) > 0) n = mul(n, -1);
  return [a, b, add(b, n), add(a, n)];
}

/** 正 n 边形顶点（从 startDeg 开始逆时针） */
export function regularPolygon(center: Pt, r: number, n: number, startDeg = 90): Pt[] {
  return Array.from({ length: n }, (_, i) => polar(center, r, startDeg + (360 * i) / n));
}

/** 点到线段的距离（标签避让用） */
export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const d = sub(b, a);
  const l2 = dot(d, d);
  if (l2 < EPS) return dist(p, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), d) / l2));
  return dist(p, add(a, mul(d, t)));
}
