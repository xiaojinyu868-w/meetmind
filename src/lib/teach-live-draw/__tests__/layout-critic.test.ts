import { describe, expect, it } from 'vitest';
import { resolveTextOverlapsDetailed } from '../layout-critic';
import { runDraw } from '../runtime';

describe('layout critic（代码版：文字重叠自动挪开）', () => {
  it('moves the later of two overlapping texts and leaves non-overlapping ones untouched', () => {
    const markup = [
      '<text x="100" y="100" font-size="20" text-anchor="middle">第一行文字</text>',
      '<text x="104" y="106" font-size="20" text-anchor="middle">第二行文字</text>',
      '<text x="400" y="300" font-size="20" text-anchor="middle">远处</text>',
    ].join('\n');
    const { markup: out, report } = resolveTextOverlapsDetailed(markup);
    expect(report.moved).toBeGreaterThan(0);
    expect(report.remaining).toBe(0);
    expect(out).toContain('x="100" y="100"');
    expect(out).toContain('x="400" y="300"');
    expect(out).not.toContain('x="104" y="106"');
  });
  it('ignores tick labels in data-draw="fade" groups and defs', () => {
    const markup = '<g data-draw="fade"><text x="0" y="0" font-size="15">1</text><text x="2" y="1" font-size="15">2</text></g>';
    const { report } = resolveTextOverlapsDetailed(markup);
    expect(report.moved).toBe(0);
  });
  it('note() places annotations in canvas regions, stacking in the same region, without overlapping figure labels', () => {
    const r = runDraw([
      "const A = point(0, 0, 'A'), B = point(4, 0, 'B'), C = point(0, 3, 'C');\npolygon([A, B, C]);\nnote('直角三角形', 'top-right');\nnote('a = 4, b = 3', 'top-right');\nnote('斜边 c = {{5}}', 'bottom-left');",
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const notes = r.markup.match(/<g id="note\d" data-name="note\d" class="live-note-text">/g) ?? [];
    expect(notes.length).toBe(3);
    const ys = [...r.markup.matchAll(/class="live-note-text"><text x="([\d.]+)" y="([\d.]+)"/g)].map((m) => [Number(m[1]), Number(m[2])]);
    // 同区域第二条在第一条下面；右上区域右对齐（x 相同）
    expect(ys[1][1]).toBeGreaterThan(ys[0][1]);
    expect(ys[1][0]).toBe(ys[0][0]);
    expect(r.markup).toMatch(/text-anchor="end"/);
  });
});
