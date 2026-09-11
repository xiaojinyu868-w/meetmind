/**
 * scene —— <draw> 脚本可见的 API 与场景图。
 *
 * 脚本里每个全局函数都在这里定义：几何对象与构造（geometry.ts）、分析（analysis.ts）、
 * 标注、动画、参数。调用即登记 drawable，渲染交给 render.ts（自动铺满、标签避让）。
 * 纯数据、零 DOM：在 Worker 里执行，输出 SVG 标记字符串。
 */

import * as G from './geometry';
import type { Circ, Ln, Pt } from './geometry';
import * as A from './analysis';
import type { Fn1 } from './analysis';

export const PALETTE: Record<string, string> = {
  ink: '#20312A',
  ink2: '#53645C',
  ink3: '#819087',
  pine: '#2F6B55',
  amber: '#C8873A',
  blue: '#3B6FB6',
  rose: '#C24B5A',
  violet: '#7A5EA7',
  paper: '#F6F8F6',
};
export const CURVE_COLORS = ['pine', 'amber', 'blue', 'rose', 'violet'];

export interface Style {
  color?: string;
  width?: number;
  dashed?: boolean;
  /** true = 用 color 淡填充；字符串 = 指定填充色 */
  fill?: boolean | string;
  fillOpacity?: number;
  opacity?: number;
  /** 辅助线：细、淡 */
  faint?: boolean;
  /** 只登记不画（构造用） */
  hidden?: boolean;
  id?: string;
  label?: string;
  /** 标签偏好方向：auto（避让）/ above / below / left / right / center */
  labelPos?: 'auto' | 'above' | 'below' | 'left' | 'right' | 'center';
  font?: number;
  /** 强制角标画弧（即使是直角） */
  arc?: boolean;
  /** 点：半径 px */
  r?: number;
}

export interface NamedPt extends Pt {
  name?: string;
}

type Base = { id: string; name?: string; chunk: number; style: Style; label?: string };
export type Drawable =
  | (Base & { kind: 'point'; p: Pt })
  | (Base & { kind: 'line'; l: Ln })
  | (Base & { kind: 'circle'; c: Circ })
  | (Base & { kind: 'arc'; c: Circ; from: number; to: number })
  | (Base & { kind: 'polygon'; pts: Pt[] })
  | (Base & { kind: 'angle'; a: Pt; b: Pt; c: Pt; right: boolean })
  | (Base & { kind: 'label'; anchor: Pt; text: string; pos: NonNullable<Style['labelPos']> })
  | (Base & { kind: 'arrow'; from: Pt; to: Pt })
  | (Base & { kind: 'curve'; pts: Pt[] })
  | (Base & { kind: 'area'; pts: Pt[] })
  | (Base & { kind: 'axes'; grid: boolean; ticks: boolean; xLabel: string; yLabel: string })
  | (Base & { kind: 'trace'; along: string; dur: number; loop: boolean })
  | (Base & { kind: 'animate'; target: string; attr: string; values: string; dur: number; loop: boolean });

export interface ParamSpec {
  name: string;
  min: number;
  max: number;
  step: number;
  value: number;
}

export interface View {
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
}

export class Scene {
  drawables: Drawable[] = [];
  params: ParamSpec[] = [];
  view: View | null = null;
  size = { w: 800, h: 450 };
  chunk = 0;
  private counters: Record<string, number> = {};
  private ids = new Set<string>();

  constructor(private readonly paramValues: Record<string, number> = {}) {}

  nextId(prefix: string, wanted?: string): string {
    if (wanted && !this.ids.has(wanted)) {
      this.ids.add(wanted);
      return wanted;
    }
    for (;;) {
      this.counters[prefix] = (this.counters[prefix] ?? 0) + 1;
      const id = `${prefix}${this.counters[prefix]}`;
      if (!this.ids.has(id)) {
        this.ids.add(id);
        return id;
      }
    }
  }

  add<T extends Drawable>(d: T): T {
    this.drawables.push(d);
    return d;
  }

  paramValue(spec: ParamSpec): number {
    const v = this.paramValues[spec.name];
    return typeof v === 'number' && Number.isFinite(v) ? v : spec.value;
  }
}

/** 把用户写的 label / opts 参数规范化 */
function opts(x: string | Style | undefined): Style {
  if (x === undefined || x === null) return {};
  if (typeof x === 'string') return { label: x };
  return { ...x };
}

function safeName(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const clean = s.replace(/[^\p{L}\p{N}_-]/gu, '');
  return clean || undefined;
}

/** 参数不是点时给一句能修的错误，而不是让 NaN 流进 SVG（老师把 arrow(A, dx, dy) 写成 arrow(A, B) 之类） */
function expectPt(p: unknown, fn: string, arg: string): Pt {
  const ok = !!p && typeof p === 'object' && Number.isFinite((p as Pt).x) && Number.isFinite((p as Pt).y);
  if (!ok) {
    const got = p === undefined ? 'undefined' : p === null ? 'null' : typeof p === 'object' ? 'object' : typeof p;
    throw new TypeError(`${fn}() 的 ${arg} 需要一个点（{x, y}），收到 ${got}`);
  }
  return p as Pt;
}

/** 脚本的全局环境。返回 { name → value }，运行时用 new Function(...names) 注入。 */
export function createApi(scene: Scene): Record<string, unknown> {
  let curveColorIdx = 0;

  const named = (p: Pt, name?: string): NamedPt => Object.assign({ x: p.x, y: p.y }, name ? { name } : {});

  const point = (x: number | Pt, y?: number | string | Style, label?: string | Style, st?: Style): NamedPt => {
    let p: Pt;
    let o: Style;
    if (typeof x === 'object') {
      p = { x: x.x, y: x.y };
      o = { ...opts(y as string | Style | undefined), ...opts(label) };
    } else {
      p = { x, y: Number(y) };
      o = { ...opts(label), ...(st ?? {}) };
    }
    const name = safeName(o.label);
    const id = scene.nextId('P', o.id ?? name);
    scene.add({ kind: 'point', id, name, chunk: scene.chunk, style: o, label: o.label, p });
    const result = named(p, name);
    // 老师常写 point(2, 3, 'Q') 然后直接用 Q：把合法标识符的点名暴露成变量（运行时跑完会清掉新增全局）
    if (name && /^[A-Za-z_$][\w$]*$/.test(name)) {
      const g = globalThis as unknown as Record<string, unknown>;
      if (!(name in g)) {
        try {
          g[name] = result;
        } catch {
          // 只读全局：忽略
        }
      }
    }
    return result;
  };

  const lineLike = (type: Ln['type']) => (a: NamedPt, b: NamedPt, o?: string | Style): Ln & { id: string } => {
    const st = opts(o);
    expectPt(a, type, 'A');
    expectPt(b, type, 'B');
    const l: Ln = { a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y }, type };
    const autoName = a.name && b.name ? `${a.name}${b.name}` : undefined;
    const id = scene.nextId(type === 'segment' ? 's' : type === 'ray' ? 'ray' : 'l', st.id ?? autoName);
    scene.add({ kind: 'line', id, name: autoName, chunk: scene.chunk, style: st, label: st.label, l });
    return Object.assign(l, { id });
  };

  const circle = (o: NamedPt, rOrP: number | Pt, st?: string | Style): Circ & { id: string } => {
    const s = opts(st);
    expectPt(o, 'circle', '圆心');
    const r = typeof rOrP === 'number' ? rOrP : G.dist(o, expectPt(rOrP, 'circle', '半径或圆上一点'));
    if (!Number.isFinite(r) || r <= 0) throw new TypeError(`circle() 的半径需要是正数，收到 ${String(rOrP)}`);
    const c: Circ = { c: { x: o.x, y: o.y }, r };
    const id = scene.nextId('c', s.id ?? (o.name ? `circle${o.name}` : undefined));
    scene.add({ kind: 'circle', id, chunk: scene.chunk, style: s, label: s.label, c });
    return Object.assign(c, { id });
  };

  const arc = (o: Pt, r: number, from: number, to: number, st?: string | Style) => {
    const s = opts(st);
    const id = scene.nextId('arc', s.id);
    scene.add({ kind: 'arc', id, chunk: scene.chunk, style: s, label: s.label, c: { c: { x: o.x, y: o.y }, r }, from, to });
    return id;
  };

  const polygon = (...args: unknown[]) => {
    let pts: NamedPt[];
    let st: Style = {};
    if (Array.isArray(args[0])) {
      pts = args[0] as NamedPt[];
      st = opts(args[1] as string | Style | undefined);
    } else {
      const last = args[args.length - 1];
      const hasOpts = last !== null && (typeof last === 'string' || (typeof last === 'object' && !('x' in (last as object))));
      pts = (hasOpts ? args.slice(0, -1) : args) as NamedPt[];
      st = opts(hasOpts ? (last as string | Style) : undefined);
    }
    pts.forEach((p, i) => expectPt(p, 'polygon', `第 ${i + 1} 个点`));
    const autoName = pts.every((p) => p.name) ? pts.map((p) => p.name).join('') : undefined;
    const id = scene.nextId('poly', st.id ?? autoName);
    scene.add({ kind: 'polygon', id, name: autoName, chunk: scene.chunk, style: st, label: st.label, pts: pts.map((p) => ({ x: p.x, y: p.y })) });
    return { id, pts };
  };

  const angle = (a: NamedPt, b: NamedPt, c: NamedPt, o?: string | Style) => {
    const st = opts(o);
    // 退化（有两点重合 / 传错对象）就不画：画一个错的角标比不画更糟
    if (!a || !b || !c || G.dist(a, b) < G.EPS || G.dist(c, b) < G.EPS) return NaN;
    const deg = G.angleOf(a, b, c);
    const right = !st.arc && Math.abs(deg - 90) < 0.5;
    const id = scene.nextId('angle', st.id ?? (b.name ? `angle${b.name}` : undefined));
    scene.add({ kind: 'angle', id, chunk: scene.chunk, style: st, label: st.label, a, b, c, right });
    return deg;
  };

  const label = (target: unknown, text?: string | Style, o?: Style) => {
    const st = { ...opts(text), ...(o ?? {}) };
    const txt = typeof text === 'string' ? text : (st.label ?? '');
    let anchor: Pt;
    if (Array.isArray(target)) anchor = { x: Number(target[0]), y: Number(target[1]) };
    else if (target && typeof target === 'object' && 'x' in (target as object)) anchor = target as Pt;
    else if (target && typeof target === 'object' && 'a' in (target as object)) {
      const l = target as Ln;
      anchor = G.midpoint(l.a, l.b);
    } else if (target && typeof target === 'object' && 'c' in (target as object)) {
      const c = target as Circ;
      anchor = { x: c.c.x, y: c.c.y + c.r };
    } else anchor = { x: 0, y: 0 };
    const id = scene.nextId('label', st.id);
    scene.add({ kind: 'label', id, chunk: scene.chunk, style: st, anchor: { x: anchor.x, y: anchor.y }, text: String(txt), pos: st.labelPos ?? 'auto' });
    return id;
  };

  const text = (x: number, y: number, str: string, o?: Style) => label([x, y], str, { labelPos: 'center', ...(o ?? {}) });

  /** arrow(A, B, opts) 或 arrow(A, dx, dy, opts)——老师两种都会写，都认 */
  const arrow = (a: Pt, b: Pt | number, o?: string | Style | number, o2?: string | Style) => {
    expectPt(a, 'arrow', '起点');
    let to: Pt;
    let st: Style;
    if (typeof b === 'number') {
      const dy = typeof o === 'number' ? o : NaN;
      if (!Number.isFinite(b) || !Number.isFinite(dy)) throw new TypeError('arrow(A, dx, dy) 的 dx / dy 需要是数字');
      to = { x: a.x + b, y: a.y + dy };
      st = opts(o2);
    } else {
      expectPt(b, 'arrow', '终点');
      to = { x: b.x, y: b.y };
      st = opts(typeof o === 'number' ? undefined : o);
    }
    if (G.dist(a, to) < G.EPS) return scene.nextId('arrow', st.id); // 零长度箭头不画
    const id = scene.nextId('arrow', st.id);
    scene.add({ kind: 'arrow', id, chunk: scene.chunk, style: st, label: st.label, from: { x: a.x, y: a.y }, to });
    return id;
  };
  const vector = (a: Pt, dx: number, dy: number, o?: string | Style) => arrow(a, dx, dy, o);

  // ---------- 分析 ----------

  const fn = (f: string | Fn1): Fn1 => A.toFn(f);

  const curve = (f: string | Fn1 | Pt[], range?: [number, number] | string | Style, o?: string | Style) => {
    let pts: Pt[];
    let st: Style;
    if (Array.isArray(f)) {
      pts = f;
      st = opts(range as string | Style | undefined);
    } else {
      const fx = A.toFn(f);
      const [a, b] = Array.isArray(range) ? range : scene.view ? [scene.view.xmin, scene.view.xmax] : [-5, 5];
      pts = A.sample(fx, a, b);
      st = opts(o);
      if (!st.label && typeof f === 'string') st.label = st.label ?? undefined;
    }
    if (!st.color) st.color = CURVE_COLORS[curveColorIdx++ % CURVE_COLORS.length];
    const id = scene.nextId('curve', st.id ?? safeName(st.label));
    scene.add({ kind: 'curve', id, chunk: scene.chunk, style: st, label: st.label, pts });
    return { id, pts };
  };

  const parametric = (g: (t: number) => [number, number] | Pt, range: [number, number], o?: string | Style) =>
    curve(A.sampleParametric(g, range[0], range[1]), o);
  const polarCurve = (r: (deg: number) => number, range: [number, number] = [0, 360], o?: string | Style) =>
    curve(A.samplePolar(r, range[0], range[1]), o);

  const axes = (o: { x?: [number, number]; y?: [number, number]; grid?: boolean; ticks?: boolean; xLabel?: string; yLabel?: string } = {}) => {
    if (o.x || o.y) {
      const v = scene.view ?? { xmin: -5, xmax: 5, ymin: -5, ymax: 5 };
      scene.view = {
        xmin: o.x?.[0] ?? v.xmin,
        xmax: o.x?.[1] ?? v.xmax,
        ymin: o.y?.[0] ?? v.ymin,
        ymax: o.y?.[1] ?? v.ymax,
      };
    }
    const id = scene.nextId('axes');
    scene.add({ kind: 'axes', id, chunk: scene.chunk, style: {}, grid: o.grid ?? true, ticks: o.ticks ?? true, xLabel: o.xLabel ?? 'x', yLabel: o.yLabel ?? 'y' });
    return id;
  };

  const view = (xmin: number, xmax: number, ymin: number, ymax: number) => {
    scene.view = { xmin, xmax, ymin, ymax };
  };
  const size = (w: number, h: number) => {
    scene.size = { w: Math.max(200, w), h: Math.max(150, h) };
  };

  const tangentLine = (f: string | Fn1, x0: number, o?: string | Style) => {
    const fx = A.toFn(f);
    const v = scene.view;
    const [a, b] = v ? [v.xmin, v.xmax] : [x0 - 3, x0 + 3];
    const [p, q] = A.tangentSegment(fx, x0, a, b);
    const st = { color: 'amber', ...opts(o) };
    const l = lineLike('line')(named(p), named(q), st);
    point(x0, fx(x0), { color: st.color, r: 5 });
    return { line: l, slope: A.derivative(fx, x0), point: { x: x0, y: fx(x0) } };
  };

  const normalLine = (f: string | Fn1, x0: number, o?: string | Style) => {
    const fx = A.toFn(f);
    const v = scene.view;
    const half = v ? (v.xmax - v.xmin) / 2 : 3;
    const [p, q] = A.normalSegment(fx, x0, half);
    return lineLike('line')(named(p), named(q), { color: 'blue', dashed: true, ...opts(o) });
  };

  const area = (f: string | Fn1, a: number, b: number, o?: string | Style) => {
    const fx = A.toFn(f);
    const pts = A.sample(fx, a, b, 160).filter((p) => Number.isFinite(p.y));
    const poly = [{ x: a, y: 0 }, ...pts, { x: b, y: 0 }];
    const st = { color: 'pine', ...opts(o) };
    const id = scene.nextId('area', st.id);
    scene.add({ kind: 'area', id, chunk: scene.chunk, style: st, label: st.label, pts: poly });
    return { id, value: A.integral(fx, a, b) };
  };

  // ---------- 动画 / 参数 ----------

  const trace = (along: { id: string } | string, o: { dur?: number; loop?: boolean; color?: string; r?: number } = {}) => {
    const alongId = typeof along === 'string' ? along : along.id;
    const id = scene.nextId('trace');
    scene.add({ kind: 'trace', id, chunk: scene.chunk, style: { color: o.color ?? 'amber', r: o.r ?? 7 }, along: alongId, dur: o.dur ?? 4, loop: o.loop ?? true });
    return id;
  };

  const animate = (target: { id: string } | string, o: { attr: string; values: string | Array<string | number>; dur?: number; loop?: boolean }) => {
    const targetId = typeof target === 'string' ? target : target.id;
    const id = scene.nextId('anim');
    scene.add({
      kind: 'animate',
      id,
      chunk: scene.chunk,
      style: {},
      target: targetId,
      attr: o.attr,
      values: Array.isArray(o.values) ? o.values.join(';') : String(o.values),
      dur: o.dur ?? 3,
      loop: o.loop ?? true,
    });
    return id;
  };

  const param = (name: string, min: number, max: number, value?: number, step?: number): number => {
    const spec: ParamSpec = { name, min, max, step: step ?? (max - min) / 100, value: value ?? (min + max) / 2 };
    if (!scene.params.some((p) => p.name === name)) scene.params.push(spec);
    return scene.paramValue(spec);
  };

  const pointsOf = (shape: { pts: Pt[] }) => shape.pts;

  /** 把任何几何对象画出来：点 / 线 / 圆 / 点数组（多边形） */
  const draw = (obj: unknown, o?: string | Style): unknown => {
    if (Array.isArray(obj)) {
      if (obj.length && typeof obj[0] === 'object' && 'x' in (obj[0] as object)) return polygon(obj as NamedPt[], o);
      return obj.map((item) => draw(item, o));
    }
    if (!obj || typeof obj !== 'object') return obj;
    const rec = obj as Record<string, unknown>;
    if ('r' in rec && 'c' in rec) return circle(named(rec.c as Pt), rec.r as number, o);
    if ('a' in rec && 'b' in rec && 'type' in rec) {
      const l = obj as Ln;
      return lineLike(l.type)(named(l.a), named(l.b), o);
    }
    if ('x' in rec && 'y' in rec) return point(obj as Pt, o as string | Style | undefined);
    return obj;
  };

  /** 线构造：算出来就画（要只算不画传 { hidden: true }） */
  const drawnLine = (l: Ln, o: string | Style | undefined, autoName?: string): Ln & { id: string } => {
    const st = opts(o);
    if (st.hidden) return Object.assign({ ...l }, { id: scene.nextId('l', st.id ?? autoName) });
    return lineLike(l.type)(named(l.a), named(l.b), { ...st, id: st.id ?? autoName });
  };
  const drawnCircle = (c: Circ | null, o: string | Style | undefined): (Circ & { id: string }) | null => {
    if (!c) return null;
    const st = opts(o);
    if (st.hidden) return Object.assign({ ...c }, { id: scene.nextId('c', st.id) });
    return circle(named(c.c), c.r, st);
  };

  return {
    // 对象
    pt: (x: number, y: number, name?: string): NamedPt => named({ x, y }, safeName(name)),
    point,
    segment: lineLike('segment'),
    line: lineLike('line'),
    ray: lineLike('ray'),
    circle,
    arc,
    polygon,
    angle,
    rightAngle: (a: NamedPt, b: NamedPt, c: NamedPt, o?: string | Style) => angle(a, b, c, o),
    label,
    text,
    arrow,
    vector,
    pointsOf,
    // 构造（返回数学对象，不自动画；要画就交给 segment/line/circle/point）
    midpoint: (a: Pt, b: Pt) => named(G.midpoint(a, b)),
    lerp: (a: Pt, b: Pt, t: number) => named(G.lerp(a, b, t)),
    intersect: (u: Ln | Circ, v: Ln | Circ): NamedPt | NamedPt[] | null => {
      const isCirc = (o: Ln | Circ): o is Circ => 'r' in o;
      if (!isCirc(u) && !isCirc(v)) {
        const p = G.intersectLines(u, v);
        return p ? named(p) : null;
      }
      if (isCirc(u) && isCirc(v)) return G.intersectCircles(u, v).map((p) => named(p));
      const l = (isCirc(u) ? v : u) as Ln;
      const c = (isCirc(u) ? u : v) as Circ;
      return G.intersectLineCircle(l, c).map((p) => named(p));
    },
    draw,
    perpendicular: (l: Ln, p: Pt, o?: string | Style) => drawnLine(G.perpendicular(l, p), o),
    parallel: (l: Ln, p: Pt, o?: string | Style) => drawnLine(G.parallel(l, p), o),
    perpBisector: (a: Pt, b: Pt, o?: string | Style) => drawnLine(G.perpBisector(a, b), o),
    foot: (p: Pt, l: Ln, name?: string) => named(G.foot(p, l), safeName(name)),
    bisector: (a: Pt, b: Pt, c: Pt, o?: string | Style) => drawnLine(G.bisector(a, b, c), o),
    tangentAt: (c: Circ, p: NamedPt, o?: string | Style) => drawnLine(G.tangentAt(c, p), { color: 'amber', ...opts(o) }, p.name ? `tangent${p.name}` : undefined),
    tangentsFrom: (p: Pt, c: Circ) => G.tangentPoints(p, c).map((q) => named(q)),
    onCircle: (c: Circ, deg: number, name?: string) => named(G.onCircle(c, deg), safeName(name)),
    polar: (o: Pt, r: number, deg: number, name?: string) => named(G.polar(o, r, deg), safeName(name)),
    rotate: (p: Pt, o: Pt, deg: number, name?: string) => named(G.rotate(p, o, deg), safeName(name)),
    reflect: (p: Pt, l: Ln, name?: string) => named(G.reflect(p, l), safeName(name)),
    translate: (p: Pt, dx: number, dy: number, name?: string) => named(G.translate(p, dx, dy), safeName(name)),
    lineThrough: (p: Pt, deg: number, o?: string | Style) => drawnLine(G.lineThrough(p, deg), o),
    circumcircle: (a: Pt, b: Pt, c: Pt, o?: string | Style) => drawnCircle(G.circumcircle(a, b, c), { dashed: true, ...opts(o) }),
    incircle: (a: Pt, b: Pt, c: Pt, o?: string | Style) => drawnCircle(G.incircle(a, b, c), { dashed: true, ...opts(o) }),
    centroid: (pts: Pt[]) => named(G.centroid(pts)),
    squareOn: (a: Pt, b: Pt, awayFrom: Pt) => G.squareOn(a, b, awayFrom).map((p) => named(p)),
    regularPolygon: (o: Pt, r: number, n: number, startDeg?: number) => G.regularPolygon(o, r, n, startDeg).map((p) => named(p)),
    dist: G.dist,
    angleOf: G.angleOf,
    heading: G.heading,
    polygonArea: (pts: Pt[]) => Math.abs(G.polygonArea(pts)),
    // 分析
    fn,
    curve,
    parametric,
    polarCurve,
    axes,
    view,
    size,
    derivative: (f: string | Fn1, x: number) => A.derivative(A.toFn(f), x),
    integral: (f: string | Fn1, a: number, b: number) => A.integral(A.toFn(f), a, b),
    roots: (f: string | Fn1, a: number, b: number) => A.roots(A.toFn(f), a, b),
    extrema: (f: string | Fn1, a: number, b: number) => A.extrema(A.toFn(f), a, b),
    intersections: (f: string | Fn1, g: string | Fn1, a: number, b: number) => A.intersections(A.toFn(f), A.toFn(g), a, b).map((p) => named(p)),
    tangentLine,
    normalLine,
    area,
    // 动画 / 交互
    trace,
    animate,
    param,
    // 工具
    range: (n: number, m?: number) => (m === undefined ? Array.from({ length: n }, (_, i) => i) : Array.from({ length: m - n }, (_, i) => n + i)),
    deg: G.rad2deg,
    rad: G.deg2rad,
    PALETTE,
  };
}
