import { describe, expect, it } from 'vitest';
import { runDraw } from '../runtime';
import { compileTimeline, parseMarkup, sampleCount } from '../timeline';

describe('timeline: time(t) → 逐帧精确几何 → SMIL', () => {
  it('a tangent that follows a point around the circle animates its endpoints, and the point animates too', () => {
    const r = runDraw([
      "const t = time(4);\nconst O = point(0, 0, 'O');\nconst c = circle(O, 3);\nconst P = point(onCircle(c, 90 * t), 'P');\ntangentAt(c, P);\nsegment(O, P, 'r', { dashed: true });",
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.timeline).toEqual({ dur: 4, loop: true });
    expect(r.log.some((l) => /timeline: \d+ frames/.test(l))).toBe(true);
    const animates = r.markup.match(/<animate /g) ?? [];
    expect(animates.length).toBeGreaterThanOrEqual(3); // 点 cx/cy + 切线 d + 半径 d …
    expect(r.markup).toContain('attributeName="d"');
    expect(r.markup).toContain('calcMode="linear"');
    expect(r.markup).toContain('repeatCount="indefinite"');
    // 圆本身不动：圆的 path 不该带 d 动画
    const circlePath = r.markup.split('\n').find((line) => line.includes('data-name="c1"')) ?? '';
    expect(circlePath).not.toMatch(/attributeName="d"/);
    expect(r.markup).not.toMatch(/NaN/);
  });

  it('a changing numeric label becomes text copies switched by opacity (few runs) and is capped when too many', () => {
    const few = runDraw(["const t = time(3);\nconst k = Math.floor(t);\nlabel([0, 0], 'k = ' + k);\npoint(t, 0, 'P');"]);
    expect(few.ok).toBe(true);
    if (!few.ok) return;
    // k 取 0,1,2,3 → 4 段：原元素 + 3 个副本
    expect((few.markup.match(/k = /g) ?? []).length).toBe(4);
    const many = runDraw(["const t = time(4);\nlabel([0, 0], 't = ' + t.toFixed(2));\npoint(t, 0, 'P');"]);
    expect(many.ok).toBe(true);
    if (!many.ok) return;
    // 每帧都不同：40 帧 → 40 份副本按 opacity 轮播（读数跟得上）
    expect((many.markup.match(/t = /g) ?? []).length).toBe(40);
  });

  it('pingpong mirrors values and doubles dur; loop:false plays once', () => {
    const pp = runDraw(["const t = time(2, { loop: 'pingpong' });\npoint(t, 0, 'P');"]);
    expect(pp.ok && pp.markup).toMatch(/dur="4s"/);
    const once = runDraw(["const t = time(2, { loop: false });\npoint(t, 0, 'P');"]);
    expect(once.ok && once.markup).toMatch(/repeatCount="1"/);
  });

  it('elements present only in some frames toggle opacity instead of breaking the diff', () => {
    const frames = [
      '<g id="a"><circle cx="0" cy="0" r="3"></circle></g>\n<path id="b" d="M0 0 L1 1"/>',
      '<g id="a"><circle cx="1" cy="0" r="3"></circle></g>',
      '<g id="a"><circle cx="2" cy="0" r="3"></circle></g>\n<path id="b" d="M0 0 L2 2"/>',
    ];
    const { markup, animated } = compileTimeline(frames, { dur: 3, loop: true });
    expect(animated).toBeGreaterThanOrEqual(3);
    expect(markup).toMatch(/attributeName="cx" values="0;1;2"/);
    expect(markup).toMatch(/attributeName="opacity" values="1;0;1"/);
    expect(parseMarkup(markup).length).toBe(2);
  });

  it('sampleCount stays within 12–40', () => {
    expect(sampleCount(0.5)).toBe(12);
    expect(sampleCount(3)).toBe(30);
    expect(sampleCount(30)).toBe(40);
  });

  it('a circle with axes keeps equal scaling (no ellipse)', () => {
    const r = runDraw(["axes({ x: [-4, 4], y: [-4, 4] });\nconst O = point(0, 0, 'O');\ncircle(O, 3);"]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.transform.sx).toBeCloseTo(r.transform.sy, 6);
    const plot = runDraw(["axes({ x: [0, 4], y: [0, 16] });\ncurve('x^2', [0, 4]);"]);
    expect(plot.ok && plot.transform.sx !== plot.transform.sy).toBe(true);
  });

  it('a static script (no time()) renders exactly as before', () => {
    const r = runDraw(["const A = point(0, 0, 'A'), B = point(3, 0, 'B');\nsegment(A, B);"]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.timeline).toBeUndefined();
    expect(r.markup).not.toContain('<animate');
  });
});
