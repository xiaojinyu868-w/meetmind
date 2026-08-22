import { describe, expect, it } from 'vitest';
import { isValidCell, parseInkGradeResponse } from './ink-grading-service';

describe('parseInkGradeResponse', () => {
  it('解析标准 JSON：verdict/comment/marks 全保留', () => {
    const result = parseInkGradeResponse(
      '{"verdict":"partial","comment":"前两步都对，最后一步符号错了","marks":[{"type":"check","cell":"A2"},{"type":"cross","cell":"C5"}]}',
    );
    expect(result.verdict).toBe('partial');
    expect(result.comment).toBe('前两步都对，最后一步符号错了');
    expect(result.marks).toEqual([
      { type: 'check', cell: 'A2' },
      { type: 'cross', cell: 'C5' },
    ]);
  });

  it('容错：剥 markdown 围栏取第一个 JSON 对象', () => {
    const result = parseInkGradeResponse(
      '好的，我来批改：```json\n{"verdict":"correct","comment":"全对，漂亮","marks":[]}\n```',
    );
    expect(result.verdict).toBe('correct');
    expect(result.marks).toEqual([]);
  });

  it('cell 越界 / 类型未知的 mark 丢弃，cell 统一大写', () => {
    const result = parseInkGradeResponse(
      '{"verdict":"wrong","comment":"x","marks":[{"type":"cross","cell":"e3"},{"type":"tick","cell":"A1"},{"type":"cross","cell":"Z9"},{"type":"check","cell":"D6"}]}',
    );
    // e3 合法（E 行？6 列 4 行网格：E 越界！）；Z9 越界；tick 未知类型
    expect(result.marks).toEqual([{ type: 'check', cell: 'D6' }]);
  });

  it('marks 上限 4 个', () => {
    const marks = Array.from({ length: 8 }, (_, i) => ({ type: 'check', cell: `A${i + 1}` }));
    const result = parseInkGradeResponse(
      JSON.stringify({ verdict: 'correct', comment: '', marks }),
    );
    expect(result.marks).toHaveLength(4);
  });

  it('完全不可解析 → unknown 空结果（降级不崩）', () => {
    expect(parseInkGradeResponse('我看不清')).toEqual({ verdict: 'unknown', comment: '', marks: [], corrections: [] });
    expect(parseInkGradeResponse('{broken json')).toEqual({ verdict: 'unknown', comment: '', marks: [], corrections: [] });
  });

  it('corrections：仅 partial/wrong 保留，逐行截断 20 字、上限 3 行；correct 强制清空', () => {
    const withDemo = parseInkGradeResponse(
      JSON.stringify({
        verdict: 'wrong',
        comment: '看示范',
        marks: [],
        corrections: ['y = (x-20)(250-5x)', 'x'.repeat(30), '', '第三行', '第四行（超上限丢弃）'],
      }),
    );
    expect(withDemo.corrections).toHaveLength(3);
    expect(withDemo.corrections[1]).toHaveLength(20);
    expect(withDemo.corrections[2]).toBe('第三行');

    const correct = parseInkGradeResponse(
      JSON.stringify({ verdict: 'correct', comment: '', marks: [], corrections: ['不该保留'] }),
    );
    expect(correct.corrections).toEqual([]);
  });

  it('verdict 不在白名单 → unknown；comment 截断到 60 字', () => {
    const result = parseInkGradeResponse(
      JSON.stringify({ verdict: 'great', comment: '一'.repeat(80), marks: [] }),
    );
    expect(result.verdict).toBe('unknown');
    expect(result.comment).toHaveLength(60);
  });
});

describe('isValidCell', () => {
  it('6 列 4 行网格：A1/D6 合法，E1/A7/AA1/A0 非法', () => {
    expect(isValidCell('A1', 6, 4)).toBe(true);
    expect(isValidCell('D6', 6, 4)).toBe(true);
    expect(isValidCell('E1', 6, 4)).toBe(false);
    expect(isValidCell('A7', 6, 4)).toBe(false);
    expect(isValidCell('AA1', 6, 4)).toBe(false);
    expect(isValidCell('A0', 6, 4)).toBe(false);
  });
});
