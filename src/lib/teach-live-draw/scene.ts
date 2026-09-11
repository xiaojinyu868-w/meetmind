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
/** 向量默认轮换色（蓝优先：坐标基向量的惯例） */
export const ARROW_COLORS = ['blue', 'rose', 'pine', 'amber', 'violet'];

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
  /** 画布区域里的批注（像素空间，3×3 区域，同区域自动往下叠）——不用算坐标的"图旁边写一句" */
  | (Base & { kind: 'note'; region: NoteRegion; text: string })
  | (Base & { kind: 'arrow'; from: Pt; to: Pt })
  | (Base & { kind: 'curve'; pts: Pt[] })
  | (Base & { kind: 'area'; pts: Pt[] })
  | (Base & { kind: 'axes'; grid: boolean; ticks: boolean; xLabel: string; yLabel: string })
  | (Base & { kind: 'trace'; along: string; dur: number; loop: boolean })
  | (Base & { kind: 'animate'; target: string; attr: string; values: string; dur: number; loop: boolean });

export type NoteRegion = 'top-left' | 'top' | 'top-right' | 'left' | 'center' | 'right' | 'bottom-left' | 'bottom' | 'bottom-right';
export const NOTE_REGIONS: readonly NoteRegion[] = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'];

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

export interface TimelineSpec {
  /** 秒 */
  dur: number;
  loop: boolean | 'pingpong';
}

export class Scene {
  drawables: Drawable[] = [];
  params: ParamSpec[] = [];
  view: View | null = null;
  size = { w: 800, h: 450 };
  chunk = 0;
  /** 脚本调过 time()：整张图随 t 变化，运行时按帧采样编译成 SMIL */
  timeline: TimelineSpec | null = null;
  /** 当前采样时刻（秒）；静态图恒为 0 */
  now = 0;
  /** axes({ equal: true })：带坐标系也保形 */
  equalAxes = false;
  /** axes({ lock: true })：老师给的坐标范围就是画面，不自动贴内容收紧 */
  viewLocked = false;
  private counters: Record<string, number> = {};
  private ids = new Set<string>();

  constructor(
    private readonly paramValues: Record<string, number> = {},
    now = 0,
  ) {
    this.now = now;
  }

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
/** 老师写法五花八门：'label' / { color } / 'label', { color } 都认；后面的样式对象覆盖前面的 */
function opts(...args: Array<string | Style | number | undefined | null>): Style {
  const out: Style = {};
  for (const x of args) {
    if (x === undefined || x === null || typeof x === 'number') continue;
    if (typeof x === 'string') out.label = x;
    else Object.assign(out, x);
  }
  return out;
}

/** 点的宽容写法：{x, y} / [x, y] / 带 name 的点；都不是就返回 null */
function toPt(v: unknown): Pt | null {
  if (Array.isArray(v) && v.length >= 2 && Number.isFinite(Number(v[0])) && Number.isFinite(Number(v[1]))) return { x: Number(v[0]), y: Number(v[1]) };
  if (v && typeof v === 'object' && Number.isFinite((v as Pt).x) && Number.isFinite((v as Pt).y)) return v as Pt;
  return null;
}

const SUBSCRIPT_DIGITS: Record<string, string> = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9' };

/** 标签 → 可当 id 的名字：e₁ → e1（老师说 point at="fig#e1" 时能对上） */
function safeName(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const clean = s.replace(/[₀-₉]/g, (d) => SUBSCRIPT_DIGITS[d] ?? d).replace(/[^\p{L}\p{N}_-]/gu, '');
  return clean || undefined;
}

/** 参数不是点时给一句能修的错误，而不是让 NaN 流进 SVG（老师把 arrow(A, dx, dy) 写成 arrow(A, B) 之类） */
function expectPt(p: unknown, fn: string, arg: string): Pt {
  const pt = toPt(p);
  if (!pt) {
    const got = p === undefined ? 'undefined' : p === null ? 'null' : Array.isArray(p) ? `数组 ${JSON.stringify(p).slice(0, 40)}` : typeof p === 'object' ? 'object' : typeof p;
    throw new TypeError(`${fn}() 的 ${arg} 需要一个点（{x, y} 或 [x, y]），收到 ${got}`);
  }
  return pt;
}

/** 脚本的全局环境。返回 { name → value }，运行时用 new Function(...names) 注入。 */
export function createApi(scene: Scene): Record<string, unknown> {
  let curveColorIdx = 0;

  const named = (p: Pt | number[], name?: string): NamedPt => {
    const q = toPt(p) ?? { x: NaN, y: NaN };
    return Object.assign({ x: q.x, y: q.y }, name ? { name } : {});
  };

  const point = (x: number | Pt | number[], y?: number | string | Style, label?: string | Style, st?: Style): NamedPt => {
    let p: Pt;
    let o: Style;
    if (typeof x === 'object') {
      p = expectPt(x, 'point', '坐标');
      o = opts(y as string | Style | undefined, label, st);
    } else {
      if (!Number.isFinite(x) || !Number.isFinite(Number(y))) throw new TypeError(`point(x, y) 的坐标需要是数字，收到 (${String(x)}, ${String(y)})`);
      p = { x, y: Number(y) };
      o = opts(label, st);
    }
    const name = safeName(o.label);
    // { hidden: true }：只要这个点的坐标，不画
    if (o.hidden) return named(p, name);
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

  const lineLike = (type: Ln['type']) => (a: NamedPt | number[], b: NamedPt | number[], o?: string | Style, o2?: Style): Ln & { id: string } => {
    const st = opts(o, o2);
    const pa = expectPt(a, type, 'A');
    const pb = expectPt(b, type, 'B');
    const l: Ln = { a: { x: pa.x, y: pa.y }, b: { x: pb.x, y: pb.y }, type };
    const na = (a as NamedPt).name;
    const nb = (b as NamedPt).name;
    const autoName = na && nb ? `${na}${nb}` : undefined;
    const id = scene.nextId(type === 'segment' ? 's' : type === 'ray' ? 'ray' : 'l', st.id ?? autoName ?? safeName(st.label));
    scene.add({ kind: 'line', id, name: autoName, chunk: scene.chunk, style: st, label: st.label, l });
    return Object.assign(l, { id });
  };

  const circle = (o: NamedPt | number[], rOrP: number | Pt | number[], st?: string | Style, st2?: Style): Circ & { id: string } => {
    const s = opts(st, st2);
    const center = expectPt(o, 'circle', '圆心');
    const r = typeof rOrP === 'number' ? rOrP : G.dist(center, expectPt(rOrP, 'circle', '半径或圆上一点'));
    if (!Number.isFinite(r) || r <= 0) throw new TypeError(`circle() 的半径需要是正数，收到 ${String(rOrP)}`);
    const c: Circ = { c: { x: center.x, y: center.y }, r };
    const oname = (o as NamedPt).name;
    const id = scene.nextId('c', s.id ?? safeName(s.label) ?? (oname ? `circle${oname}` : undefined));
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
    let rawPts: unknown[];
    let styleArgs: unknown[];
    if (Array.isArray(args[0]) && (args[0].length === 0 || typeof args[0][0] === 'object')) {
      // polygon([A, B, C], 'label', { color })
      rawPts = args[0] as unknown[];
      styleArgs = args.slice(1);
    } else {
      // polygon(A, B, C, 'label', { color })：点用完就是样式
      const firstNonPt = args.findIndex((a) => !toPt(a));
      rawPts = firstNonPt < 0 ? args : args.slice(0, firstNonPt);
      styleArgs = firstNonPt < 0 ? [] : args.slice(firstNonPt);
    }
    const st = opts(...(styleArgs as Array<string | Style | undefined>));
    const pts = rawPts.map((p, i) => expectPt(p, 'polygon', `第 ${i + 1} 个点`));
    const names = rawPts.map((p) => (p as NamedPt).name);
    const autoName = names.every(Boolean) && names.length ? names.join('') : undefined;
    const id = scene.nextId('poly', st.id ?? autoName ?? safeName(st.label));
    scene.add({ kind: 'polygon', id, name: autoName, chunk: scene.chunk, style: st, label: st.label, pts: pts.map((p) => ({ x: p.x, y: p.y })) });
    return { id, pts: pts.map((p, i) => named(p, names[i])) };
  };

  const angle = (a0: NamedPt | number[], b0: NamedPt | number[], c0: NamedPt | number[], o?: string | Style, o2?: Style) => {
    const st = opts(o, o2);
    const a = toPt(a0);
    const b = toPt(b0);
    const c = toPt(c0);
    // 退化（有两点重合 / 传错对象）就不画：画一个错的角标比不画更糟
    if (!a || !b || !c || G.dist(a, b) < G.EPS || G.dist(c, b) < G.EPS) return NaN;
    const deg = G.angleOf(a, b, c);
    const right = !st.arc && Math.abs(deg - 90) < 0.5;
    const bname = (b0 as NamedPt).name;
    const id = scene.nextId('angle', st.id ?? (bname ? `angle${bname}` : undefined));
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

  /** note('文字', 'top-right')：写在画布某个区域，不用算坐标；同区域多条自动往下叠；\n 换行 */
  const note = (str: string, regionOrOpts?: NoteRegion | (Style & { at?: NoteRegion }), o?: Style) => {
    const at = typeof regionOrOpts === 'string' ? regionOrOpts : regionOrOpts?.at;
    const st = { ...(typeof regionOrOpts === 'object' ? regionOrOpts : {}), ...(o ?? {}) };
    const region: NoteRegion = at && (NOTE_REGIONS as readonly string[]).includes(at) ? at : 'top-right';
    const id = scene.nextId('note', st.id);
    scene.add({ kind: 'note', id, chunk: scene.chunk, style: st, region, text: String(str) });
    return id;
  };

  /** arrow(A, B, 'label', { color }) 或 arrow(A, dx, dy, 'label', { color })——老师两种都会写，都认；不给颜色就按色板轮换（几支向量不会撞色） */
  let arrowColorIdx = 0;
  const arrow = (a0: Pt | number[], b0: Pt | number[] | number, ...rest: Array<string | Style | number | undefined>) => {
    const a = expectPt(a0, 'arrow', '起点');
    let to: Pt;
    let styleArgs: Array<string | Style | number | undefined>;
    if (typeof b0 === 'number') {
      const dy = rest[0];
      if (!Number.isFinite(b0) || typeof dy !== 'number' || !Number.isFinite(dy)) throw new TypeError('arrow(A, dx, dy) 的 dx / dy 需要是数字');
      to = { x: a.x + b0, y: a.y + dy };
      styleArgs = rest.slice(1);
    } else {
      const b = expectPt(b0, 'arrow', '终点');
      to = { x: b.x, y: b.y };
      styleArgs = rest;
    }
    const st = opts(...styleArgs);
    if (!st.color) st.color = ARROW_COLORS[arrowColorIdx++ % ARROW_COLORS.length];
    if (G.dist(a, to) < G.EPS) return scene.nextId('arrow', st.id); // 零长度箭头不画
    const id = scene.nextId('arrow', st.id ?? safeName(st.label));
    scene.add({ kind: 'arrow', id, chunk: scene.chunk, style: st, label: st.label, from: { x: a.x, y: a.y }, to });
    return id;
  };
  const vector = (a: Pt | number[], dx: number, dy: number, ...rest: Array<string | Style | undefined>) => arrow(a, dx, dy, ...rest);

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

  const axes = (o: { x?: [number, number]; y?: [number, number]; grid?: boolean; ticks?: boolean; xLabel?: string; yLabel?: string; equal?: boolean; lock?: boolean } = {}) => {
    if (o.equal) scene.equalAxes = true;
    if (o.lock) scene.viewLocked = true;
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
      if (obj.length && toPt(obj[0])) return polygon(obj as NamedPt[], o);
      if (obj.length === 2 && typeof obj[0] === 'number') return point(obj as number[], o);
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

  // ---------- 三维（正交投影：先绕竖轴转 yaw，再抬 pitch；配合 time 就是会转的立体图） ----------

  type P3 = [number, number, number] | { x: number; y: number; z: number };
  const to3 = (p: P3): [number, number, number] => (Array.isArray(p) ? [Number(p[0]), Number(p[1]), Number(p[2])] : [p.x, p.y, p.z]);
  const view3d = (o: { yaw?: number; pitch?: number; scale?: number } = {}) => {
    const yaw = G.deg2rad(o.yaw ?? 35);
    const pitch = G.deg2rad(o.pitch ?? 22);
    const sc = o.scale ?? 1;
    const proj = (p: P3, name?: string): NamedPt => {
      const [x, y, z] = to3(p);
      // 绕 y 轴（竖轴）转 yaw
      const xr = x * Math.cos(yaw) + z * Math.sin(yaw);
      const zr = -x * Math.sin(yaw) + z * Math.cos(yaw);
      // 绕 x 轴抬 pitch：看见"上方"
      const yr = y * Math.cos(pitch) - zr * Math.sin(pitch);
      return named({ x: xr * sc, y: yr * sc }, safeName(name));
    };
    const AXIS_COLORS = ['blue', 'rose', 'pine'];
    return {
      proj,
      point3: (p: P3, label?: string | Style, st?: Style) => point(proj(p), label, st),
      segment3: (a: P3, b: P3, o2?: string | Style, o3?: Style) => lineLike('segment')(proj(a), proj(b), o2, o3),
      arrow3: (a: P3, b: P3, ...rest: Array<string | Style | undefined>) => arrow(proj(a), proj(b), ...rest),
      /** 三条坐标轴（x 蓝 y 玫红 z 松绿），长度 len */
      axes3d: (len = 3, labels: [string, string, string] = ['x', 'y', 'z']) =>
        ([[len, 0, 0], [0, len, 0], [0, 0, len]] as P3[]).map((tip, i) => arrow(proj([0, 0, 0]), proj(tip), labels[i], { color: AXIS_COLORS[i], width: 2.5 })),
      /** 长方体（线框），角点在 o，边长 w h d */
      box3: (o: P3, w: number, h: number, d: number, st?: string | Style) => {
        const [x, y, z] = to3(o);
        const c: [number, number, number][] = [
          [x, y, z], [x + w, y, z], [x + w, y + h, z], [x, y + h, z],
          [x, y, z + d], [x + w, y, z + d], [x + w, y + h, z + d], [x, y + h, z + d],
        ];
        const edges: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
        const style = { color: 'ink2', width: 2, ...opts(st) };
        return edges.map(([i, j]) => lineLike('segment')(proj(c[i]), proj(c[j]), style));
      },
    };
  };

  /** 构造函数的参数里，[x, y] 与 [[x, y], …] 都当成点：老师用 JS 数组表达点是最自然的写法 */
  const withPts = <F extends (...args: never[]) => unknown>(fn: F): F =>
    ((...args: unknown[]) =>
      (fn as unknown as (...a: unknown[]) => unknown)(
        ...args.map((a) => {
          if (Array.isArray(a) && a.length === 2 && typeof a[0] === 'number' && typeof a[1] === 'number') return toPt(a) ?? a;
          if (Array.isArray(a) && a.length && Array.isArray(a[0]) && typeof a[0][0] === 'number') return a.map((p) => toPt(p) ?? p);
          return a;
        }),
      )) as unknown as F;

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
    note,
    arrow,
    vector,
    pointsOf,
    // 三维
    view3d,
    // 时间（整张图随 t 变化；运行时采样编译成浏览器原生动画）
    time: (dur = 4, o: { loop?: boolean | 'pingpong' } = {}): number => {
      if (!scene.timeline) scene.timeline = { dur: Math.max(0.5, Math.min(30, Number(dur) || 4)), loop: o.loop ?? true };
      return scene.now;
    },
    progress: (): number => (scene.timeline ? scene.now / scene.timeline.dur : 0),
    smooth: (u: number): number => {
      const x = Math.max(0, Math.min(1, u));
      return x * x * (3 - 2 * x);
    },
    // 构造（返回数学对象，不自动画；要画就交给 segment/line/circle/point）
    midpoint: withPts((a: Pt, b: Pt) => named(G.midpoint(a, b))),
    lerp: withPts((a: Pt | number, b: Pt | number, t: number): NamedPt | number =>
      typeof a === 'number' && typeof b === 'number' ? a + (b - a) * t : named(G.lerp(a as Pt, b as Pt, t))),
    intersect: withPts((u: Ln | Circ, v: Ln | Circ): NamedPt | NamedPt[] | null => {
      const isCirc = (o: Ln | Circ): o is Circ => 'r' in o;
      if (!isCirc(u) && !isCirc(v)) {
        const p = G.intersectLines(u, v);
        return p ? named(p) : null;
      }
      if (isCirc(u) && isCirc(v)) return G.intersectCircles(u, v).map((p) => named(p));
      const l = (isCirc(u) ? v : u) as Ln;
      const c = (isCirc(u) ? u : v) as Circ;
      return G.intersectLineCircle(l, c).map((p) => named(p));
    }),
    draw,
    perpendicular: withPts((l: Ln, p: Pt, o?: string | Style) => drawnLine(G.perpendicular(l, p), o)),
    parallel: withPts((l: Ln, p: Pt, o?: string | Style) => drawnLine(G.parallel(l, p), o)),
    perpBisector: withPts((a: Pt, b: Pt, o?: string | Style) => drawnLine(G.perpBisector(a, b), o)),
    foot: withPts((p: Pt, l: Ln, name?: string) => named(G.foot(p, l), safeName(name))),
    bisector: withPts((a: Pt, b: Pt, c: Pt, o?: string | Style) => drawnLine(G.bisector(a, b, c), o)),
    tangentAt: withPts((c: Circ, p: NamedPt, o?: string | Style) => drawnLine(G.tangentAt(c, p), { color: 'amber', ...opts(o) }, p.name ? `tangent${p.name}` : undefined)),
    tangentsFrom: withPts((p: Pt, c: Circ) => G.tangentPoints(p, c).map((q) => named(q))),
    onCircle: withPts((c: Circ, deg: number, name?: string) => named(G.onCircle(c, deg), safeName(name))),
    polar: withPts((o: Pt, r: number, deg: number, name?: string) => named(G.polar(o, r, deg), safeName(name))),
    rotate: withPts((p: Pt, o: Pt, deg: number, name?: string) => named(G.rotate(p, o, deg), safeName(name))),
    reflect: withPts((p: Pt, l: Ln, name?: string) => named(G.reflect(p, l), safeName(name))),
    translate: withPts((p: Pt, dx: number, dy: number, name?: string) => named(G.translate(p, dx, dy), safeName(name))),
    lineThrough: withPts((p: Pt, deg: number, o?: string | Style) => drawnLine(G.lineThrough(p, deg), o)),
    circumcircle: withPts((a: Pt, b: Pt, c: Pt, o?: string | Style) => drawnCircle(G.circumcircle(a, b, c), { dashed: true, ...opts(o) })),
    incircle: withPts((a: Pt, b: Pt, c: Pt, o?: string | Style) => drawnCircle(G.incircle(a, b, c), { dashed: true, ...opts(o) })),
    centroid: withPts((pts: Pt[]) => named(G.centroid(pts))),
    squareOn: withPts((a: Pt, b: Pt, awayFrom: Pt) => G.squareOn(a, b, awayFrom).map((p) => named(p))),
    regularPolygon: withPts((o: Pt, r: number, n: number, startDeg?: number) => G.regularPolygon(o, r, n, startDeg).map((p) => named(p))),
    dist: withPts(G.dist),
    angleOf: withPts(G.angleOf),
    heading: withPts(G.heading),
    polygonArea: withPts((pts: Pt[]) => Math.abs(G.polygonArea(pts))),
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
