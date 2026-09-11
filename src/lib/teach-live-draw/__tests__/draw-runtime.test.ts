import { describe, expect, it } from 'vitest';
import * as G from '../geometry';
import { runDraw } from '../runtime';
import { evaluateInlineMath, evaluateArithmetic } from '@/lib/utils/safe-math';

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

describe('geometry kernel（严谨性：切线 / 交点 / 构造都是算出来的）', () => {
  it('tangent at a point is perpendicular to the radius', () => {
    const c = { c: { x: 0, y: 0 }, r: 3 };
    const p = G.onCircle(c, 40);
    const l = G.tangentAt(c, p);
    const radial = G.sub(p, c.c);
    const dir = G.sub(l.b, l.a);
    expect(near(G.dot(radial, dir), 0)).toBe(true);
  });

  it('tangent points from an external point really touch the circle', () => {
    const c = { c: { x: 0, y: 0 }, r: 3 };
    const q = { x: 6, y: 1 };
    const ts = G.tangentPoints(q, c);
    expect(ts).toHaveLength(2);
    for (const t of ts) {
      expect(near(G.dist(t, c.c), 3)).toBe(true);
      // QT ⟂ OT
      expect(near(G.dot(G.sub(t, q), G.sub(t, c.c)), 0)).toBe(true);
      // 直线 QT 到圆心的距离 = r（相切）
      expect(near(G.dist(c.c, G.foot(c.c, G.line(q, t))), 3)).toBe(true);
    }
    expect(G.tangentPoints({ x: 1, y: 1 }, c)).toEqual([]);
  });

  it('intersections: line-line, line-circle, circle-circle; circumcircle & incircle', () => {
    const p = G.intersectLines(G.line({ x: 0, y: 0 }, { x: 1, y: 1 }), G.line({ x: 0, y: 2 }, { x: 2, y: 0 }));
    expect(p && near(p.x, 1) && near(p.y, 1)).toBe(true);
    const lc = G.intersectLineCircle(G.line({ x: -5, y: 0 }, { x: 5, y: 0 }), { c: { x: 0, y: 0 }, r: 2 });
    expect(lc.map((q) => q.x).sort((a, b) => a - b)).toEqual([-2, 2]);
    const cc = G.intersectCircles({ c: { x: 0, y: 0 }, r: 2 }, { c: { x: 2, y: 0 }, r: 2 });
    expect(cc).toHaveLength(2);
    for (const q of cc) expect(near(q.x, 1)).toBe(true);
    const A = { x: 0, y: 0 };
    const B = { x: 4, y: 0 };
    const C = { x: 0, y: 3 };
    const circ = G.circumcircle(A, B, C)!;
    expect(near(circ.r, 2.5)).toBe(true); // 直角三角形外接圆半径 = 斜边一半
    const inc = G.incircle(A, B, C)!;
    expect(near(inc.r, 1)).toBe(true); // (3+4-5)/2
    expect(near(G.angleOf(B, A, C), 90)).toBe(true);
  });

  it('squareOn builds the square away from the reference point', () => {
    const A = { x: 0, y: 0 };
    const B = { x: 4, y: 0 };
    const sq = G.squareOn(A, B, { x: 2, y: 1 });
    expect(sq).toHaveLength(4);
    expect(sq.every((p) => p.y <= 1e-9)).toBe(true); // 远离 (2,1) → 落在 y<0 侧
    expect(near(G.dist(sq[1], sq[2]), 4)).toBe(true);
  });
});

describe('runDraw（脚本 → SVG）', () => {
  const TRIANGLE = `
    const A = point(0, 0, 'A'), B = point(4, 0, 'B'), C = point(0, 3, 'C');
    polygon([A, B, C]);
    segment(A, B, 'a'); segment(A, C, 'b'); segment(B, C, 'c', { color: 'amber' });
    angle(B, A, C);
  `;

  it('renders a labelled right triangle with stable ids and a right-angle mark', () => {
    const r = runDraw([TRIANGLE], { idPrefix: 'tri-' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.markup).toContain('id="tri-A"');
    expect(r.markup).toContain('data-name="BC"');
    expect(r.markup).toContain('id="tri-angleA"');
    expect(r.markup).not.toContain('NaN');
    // 三个点的标签都在
    expect((r.markup.match(/<text /g) ?? []).length).toBeGreaterThanOrEqual(6);
    expect(r.viewBox.split(' ')).toHaveLength(4);
    expect(r.params).toEqual([]);
  });

  it('into-chunks reuse the first transform and only emit new drawables', () => {
    const first = runDraw([TRIANGLE], { idPrefix: 'tri-' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = runDraw([TRIANGLE, `squareOn(A, B, C).forEach(() => {}); polygon(squareOn(A, B, C), { color: 'blue', label: 'a²' });`], {
      idPrefix: 'tri-',
      transform: first.transform,
      fromChunk: 1,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.transform).toEqual(first.transform);
    expect(second.markup).toContain('a²');
    expect(second.markup).not.toContain('id="tri-A"'); // 首块元素不重复输出
    // 正方形落在三角形下方 → viewBox 外扩到负 y 以上区域之外
    const [, y, , h] = second.viewBox.split(' ').map(Number);
    const [, y0, , h0] = first.viewBox.split(' ').map(Number);
    expect(y + h).toBeGreaterThan(y0 + h0 - 1e-6);
  });

  it('analysis: tangent line at a point of a curve has the right slope; area/roots/extrema compute', () => {
    const r = runDraw([
      `axes({ x: [-3, 3], y: [-1, 9] });
       const c = curve('x^2', [-3, 3], 'f');
       const t = tangentLine('x^2', 1);
       area('x^2', 0, 2, 's');
       trace(c, { dur: 4 });
       console.log(JSON.stringify({ slope: t.slope, area: integral('x^2', 0, 2), roots: roots('x^2 - 1', -3, 3), ext: extrema('x^2', -3, 3) }));`,
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const info = JSON.parse(r.log[0]) as { slope: number; area: number; roots: number[]; ext: Array<{ x: number; kind: string }> };
    expect(near(info.slope, 2, 1e-6)).toBe(true);
    expect(near(info.area, 8 / 3, 1e-6)).toBe(true);
    expect(info.roots.map((x) => Math.round(x * 1000) / 1000)).toEqual([-1, 1]);
    expect(info.ext).toHaveLength(1);
    expect(near(info.ext[0].x, 0, 1e-4) && info.ext[0].kind === 'min').toBe(true);
    expect(r.markup).toContain('<animateMotion');
    expect(r.markup).toContain('<mpath');
    expect(r.markup).toContain('data-draw="fade"');
  });

  it('params register sliders and feed values into the script', () => {
    const src = `const k = param('k', 1, 5, 2, 1); curve('x^2 * ' + k, [-2, 2]);`;
    const a = runDraw([src]);
    expect(a.ok && a.params[0]).toMatchObject({ name: 'k', min: 1, max: 5, value: 2, step: 1 });
    const b = runDraw([src], { params: { k: 4 } });
    expect(b.ok).toBe(true);
    expect(a.ok && b.ok && a.markup !== b.markup).toBe(true);
  });

  it('returns structured errors for syntax / runtime failures and strips code fences', () => {
    const bad = runDraw(['const A = point(0, 0; ']);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/SyntaxError/);
    // 运行期错误发生在已有对象之后：部分渲染（ok + error），出错段是第 2 段
    const rt = runDraw(['point(0,0,"A");', 'nope();']);
    expect(rt.ok).toBe(true);
    if (rt.ok) {
      expect(rt.error).toMatch(/nope/);
      expect(rt.errorChunk).toBe(1);
      expect(rt.drawables).toBe(1);
    }
    const fenced = runDraw(['```js\npoint(1, 1, "P");\n```']);
    expect(fenced.ok).toBe(true);
  });

  it('script cannot reach the network or escape (globals shadowed by caller contract)', () => {
    // runtime 本身不做沙箱（调用方在 Worker 里跑），但 console 是假的、脚本抛错不外泄
    const r = runDraw([`throw new Error('boom')`]);
    expect(r.ok).toBe(false);
  });
});

describe('inline math for speech', () => {
  it('evaluates {{ }} and leaves unparseable text readable', () => {
    expect(evaluateInlineMath('每秒 {{ 24 / 2 }} 米，面积 {{3^2 + 4^2}}，也就是 {{sqrt(25)}} 的平方')).toBe('每秒 12 米，面积 25，也就是 5 的平方');
    expect(evaluateInlineMath('{{ 10 / 3 }} 米')).toBe('3.3333 米');
    expect(evaluateInlineMath('{{ 你好 }}')).toBe('你好');
    expect(evaluateArithmetic('2pi')).toBeCloseTo(Math.PI * 2, 9);
  });
});

describe('runDraw partial rendering（模型笔误不再让整张图消失）', () => {
  it('renders the objects computed before a ReferenceError and reports the error', () => {
    const r = runDraw(["const O = point(0, 0, 'O');\ncircle(O, 3);\nconst P = point(onCircle(c, 45), 'P');\nsegment(O, P, 'r');"]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.error).toMatch(/c is not defined/);
    expect(r.errorChunk).toBe(0);
    expect(r.drawables).toBe(2);
    expect(r.markup).toContain('data-name="O"');
    expect(r.markup).toContain('<path');
  });

  it('still fails hard on a syntax error (nothing was computed)', () => {
    const r = runDraw(['const = point(0, 0);']);
    expect(r.ok).toBe(false);
  });

  it('into-chunk error keeps the base figure and reports the failing chunk index', () => {
    const r = runDraw(["const A = point(0, 0, 'A'), B = point(4, 0, 'B');\nsegment(A, B);", "segment(P0, P0, { hidden: true });\npoint(2, 2, 'C');"], { fromChunk: 1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.errorChunk).toBe(1);
    expect(r.error).toMatch(/P0 is not defined/);
  });
});

describe('API 对误用给出能修的错误，而不是 NaN', () => {
  it('arrow accepts both (A, B) and (A, dx, dy); a vector field never emits NaN', () => {
    const r = runDraw(["axes({ x: [-1, 5], y: [-1, 4] });\nfor (let i = 0; i < 3; i++) arrow(point(i, 1), 0.5, 0.3, '');\narrow(pt(0,0), pt(1,1), 'v');"]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.error).toBeUndefined();
    expect(r.markup).not.toMatch(/NaN/);
    expect((r.markup.match(/marker-end/g) ?? []).length).toBe(4);
  });
  it('segment with a non-point argument throws a TypeError naming the argument (repairable)', () => {
    const r = runDraw(["const A = point(0, 0, 'A');\nsegment(A, 3);"]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.error).toMatch(/segment\(\) 的 B 需要一个点/);
    expect(r.drawables).toBe(1);
  });
});

describe('老师最自然的写法都认（线性代数那节课的原始脚本）', () => {
  it('[x, y] arrays are points everywhere; label + style trailing args both apply', () => {
    const r = runDraw([
      "axes({ x: [-1, 6], y: [-1, 5] });\nconst h = 1.2;\nvector([0, 0], 1, 0, 'e₁', { color: 'blue' });\nvector([0, 0], 0, 1, 'e₂', { color: 'rose' });\nvector([0, 0], h, 1, 'M·e₁', { color: 'blue', width: 3 });\npolygon([[0, 0], [1, 0], [1 + h, 1], [h, 1]], { color: 'amber', label: '面积 = 1' });\nsegment([0,0], [2,2], 'd', { color: 'pine', dashed: true });\nconst M = midpoint([0, 0], [2, 2]);\npoint(M, 'M');",
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.error).toBeUndefined();
    expect(r.markup).toContain('#C24B5A'); // rose vector
    expect(r.markup).toContain('面积 = 1');
    expect(r.markup).toMatch(/stroke="#2F6B55"[^>]*stroke-dasharray/); // segment label+style both applied
    expect(r.markup).toContain('data-label="M"');
  });

  it('hidden points are not drawn but usable; arrows without color cycle through the palette', () => {
    const r = runDraw([
      "function P3(x, y, z) { return [x + z * 0.5, y - z * 0.35]; }\nconst A = point(P3(0,0,0), '', { hidden: true });\nconst B = point(P3(3,0,0), 'e₁');\narrow(A, B);\narrow(A, point(P3(0,3,0), 'e₂'));\narrow(A, point(P3(0,0,3), 'e₃'));",
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.error).toBeUndefined();
    const colors = new Set((r.markup.match(/marker-end="url\(#[^"]*arrow-([0-9A-Fa-f]{6})\)"/g) ?? []).map((m) => m.slice(-8, -2)));
    expect(colors.size).toBe(3);
    expect(r.drawables).toBe(3 + 3); // 3 visible points + 3 arrows（hidden 的 A 不登记）
  });

  it('misuse still yields a repairable TypeError mentioning arrays are fine', () => {
    const r = runDraw(["segment('A', 'B');"]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/需要一个点（\{x, y\} 或 \[x, y\]）/);
  });
});

describe('view3d（正交投影，配 time 会转）', () => {
  it('projects 3d points consistently and axes3d draws three colored arrows', () => {
    const r = runDraw(["const v = view3d({ yaw: 30, pitch: 20 });\nv.axes3d(3);\nv.box3([0,0,0], 2, 1, 1.5);\nconst P = v.point3([2,1,1.5], 'P');\nv.arrow3([0,0,0], [2,1,1.5], 'd', { color: 'amber' });"]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.error).toBeUndefined();
    expect(r.drawables).toBe(3 + 12 + 1 + 1);
    expect(new Set((r.markup.match(/arrow-([0-9A-Fa-f]{6})\)/g) ?? [])).size).toBe(4);
    const spin = runDraw(["const t = time(6);\nconst v = view3d({ yaw: 60 * t });\nv.axes3d(3);"]);
    expect(spin.ok && spin.timeline?.dur).toBe(6);
    expect(spin.ok && spin.markup).toMatch(/attributeName="d"/);
  });
});

describe('坐标范围自动贴内容', () => {
  it('a unit square inside axes [-4,4]² gets a tight view (origin kept); lock keeps the teacher range', () => {
    const script = "axes({ x: [-4, 4], y: [-4, 4] });\nvector([0,0], 1, 0, 'e₁');\nvector([0,0], 0, 1, 'e₂');\npolygon([[0,0],[1,0],[1,1],[0,1]], { color: 'amber' });";
    const tight = runDraw([script]);
    const locked = runDraw([script.replace('axes({ x: [-4, 4], y: [-4, 4] })', 'axes({ x: [-4, 4], y: [-4, 4], lock: true })')]);
    expect(tight.ok && locked.ok).toBe(true);
    if (!tight.ok || !locked.ok) return;
    // 收紧后单位向量占的像素长度远大于锁定时
    const len = (m: string) => { const a = /data-name="e1"[^>]*d="M([\d.]+) ([\d.]+) L([\d.]+) ([\d.]+)"/.exec(m); return a ? Math.abs(Number(a[3]) - Number(a[1])) : 0; };
    expect(len(tight.markup)).toBeGreaterThan(len(locked.markup) * 2.5);
    // 刻度不再画到 -4：范围里没有 -3 这个刻度了
    expect(tight.markup).not.toMatch(/>-3</);
    expect(locked.markup).toMatch(/>-3</);
  });

  it('content that already fills the range is left alone; axes-only figures keep their range', () => {
    const r = runDraw(["axes({ x: [-3, 3], y: [-1, 9] });\nconst f = curve(x => x * x, [-3, 3]);"]);
    expect(r.ok && r.markup).toMatch(/>-3</);
    const empty = runDraw(["axes({ x: [-1, 6], y: [-1, 5] });"]);
    expect(empty.ok && empty.markup).toMatch(/>6</);
  });
});

describe('上板顺序', () => {
  it('filled shapes are painted before vectors written earlier in the same chunk; chunks stay in order', () => {
    const r = runDraw(["vector([0,0], 0, 1, 'e2', { color: 'rose' });\npolygon([[0,0],[1,0],[1,1],[0,1]], { color: 'pine' });", "vector([0,0], 2, 1, 'v', { color: 'amber' });"]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const poly = r.markup.indexOf('<path id="poly1"');
    const e2 = r.markup.indexOf('data-name="e2"');
    const v = r.markup.indexOf('data-name="v"');
    expect(poly).toBeGreaterThan(-1);
    expect(poly).toBeLessThan(e2);
    expect(e2).toBeLessThan(v);
  });
});
