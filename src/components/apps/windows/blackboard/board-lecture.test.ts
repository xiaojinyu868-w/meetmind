import { describe, expect, it } from 'vitest';
import { fitTitleFontSize, lectureFontSize, splitLectureFlow } from './board-lecture';
import type { LectureFlowItem } from './board-lecture';

function item(key: string, role?: LectureFlowItem['role'], isColumnBreak = false): LectureFlowItem {
  return { key, role, isColumnBreak };
}

describe('splitLectureFlow（v31 分栏）', () => {
  it('前导 title 提升为通栏页眉，其余进左栏', () => {
    const flow = splitLectureFlow([item('t', 'title'), item('a', 'step'), item('b', 'step')]);
    expect(flow.header.map((i) => i.key)).toEqual(['t']);
    expect(flow.columns).toHaveLength(1);
    expect(flow.columns[0].map((i) => i.key)).toEqual(['a', 'b']);
  });

  it('new_column 显式换栏：标记后的内容进右栏，标记本身不产生块', () => {
    const flow = splitLectureFlow([
      item('a', 'step'),
      item('brk', undefined, true),
      item('b', 'step'),
    ]);
    expect(flow.columns).toHaveLength(2);
    expect(flow.columns[0].map((i) => i.key)).toEqual(['a']);
    expect(flow.columns[1].map((i) => i.key)).toEqual(['b']);
  });

  it('超过 2 栏的换栏标记忽略（内容留在末栏）', () => {
    const flow = splitLectureFlow([
      item('a', 'step'),
      item('brk1', undefined, true),
      item('b', 'step'),
      item('brk2', undefined, true),
      item('c', 'step'),
    ]);
    expect(flow.columns).toHaveLength(2);
    expect(flow.columns[1].map((i) => i.key)).toEqual(['b', 'c']);
  });

  it('栏满兜底：autoBreakAfterKey 之后的内容进右栏（当前块不搬家）', () => {
    const flow = splitLectureFlow(
      [item('a', 'step'), item('b', 'step'), item('c', 'step')],
      'b',
    );
    expect(flow.columns[0].map((i) => i.key)).toEqual(['a', 'b']);
    expect(flow.columns[1].map((i) => i.key)).toEqual(['c']);
  });

  it('有显式换栏时 autoBreakAfterKey 不生效', () => {
    const flow = splitLectureFlow(
      [item('a', 'step'), item('brk', undefined, true), item('b', 'step')],
      'a',
    );
    expect(flow.columns[0].map((i) => i.key)).toEqual(['a']);
    expect(flow.columns[1].map((i) => i.key)).toEqual(['b']);
  });
});

describe('讲义字阶（v31 密度：一屏 15-25 行）', () => {
  it('正文 16px 级，title 两倍左右；formula 与节标题同档', () => {
    const H = 540;
    expect(lectureFontSize('step', H)).toBeCloseTo(16.2, 1);
    expect(lectureFontSize('title', H)).toBeGreaterThan(lectureFontSize('step', H) * 1.8);
    expect(lectureFontSize('formula', H)).toBe(lectureFontSize('term', H));
    expect(lectureFontSize('note', H)).toBeLessThan(lectureFontSize('step', H));
  });

  it('长标题收缩到一栏装下，短标题原样', () => {
    const H = 540;
    const short = fitTitleFontSize('配方法', 960, H);
    expect(short).toBe(lectureFontSize('title', H));
    const long = fitTitleFontSize('一元二次方程求根公式与判别式的完整推导与典型应用场景全解', 960, H);
    expect(long).toBeLessThan(short);
    expect(long).toBeGreaterThanOrEqual(lectureFontSize('title', H) * 0.6);
  });
});
