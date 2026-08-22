import { describe, expect, it } from 'vitest';
import { parsePhotoProblemResponse } from './photo-problem-service';

describe('parsePhotoProblemResponse', () => {
  it('解析标准审题输出（含图形与学生尝试）', () => {
    const raw = JSON.stringify({
      isProblem: true,
      subject: '数学',
      statement: '某商店购进一批单价为 $20$ 元的商品，若以每件 $30$ 元出售，每天可卖 $100$ 件……',
      figureDesc: '',
      studentAttempt: '设每件涨价 $x$ 元',
    });
    const problem = parsePhotoProblemResponse(raw);
    expect(problem).not.toBeNull();
    expect(problem?.subject).toBe('数学');
    expect(problem?.statement).toContain('某商店');
    expect(problem?.figureDesc).toBeUndefined();
    expect(problem?.studentAttempt).toContain('涨价');
  });

  it('容错剥掉 markdown 围栏', () => {
    const raw = '```json\n{"isProblem":true,"subject":"物理","statement":"一个小球从 $h=5$ 米高处自由落下……","figureDesc":"小球下落示意"}\n```';
    const problem = parsePhotoProblemResponse(raw);
    expect(problem?.subject).toBe('物理');
    expect(problem?.figureDesc).toContain('下落');
  });

  it('isProblem=false → null（照片里没有题）', () => {
    expect(parsePhotoProblemResponse('{"isProblem":false}')).toBeNull();
  });

  it('statement 为空 → null', () => {
    expect(parsePhotoProblemResponse('{"isProblem":true,"subject":"数学","statement":""}')).toBeNull();
  });

  it('完全不可解析 → null', () => {
    expect(parsePhotoProblemResponse('这不是 JSON')).toBeNull();
  });

  it('缺学科时兜底为数学；字段超长截断', () => {
    const raw = JSON.stringify({
      isProblem: true,
      statement: 'x'.repeat(2000),
      figureDesc: 'y'.repeat(1000),
    });
    const problem = parsePhotoProblemResponse(raw);
    expect(problem?.subject).toBe('数学');
    expect(problem?.statement.length).toBeLessThanOrEqual(1200);
    expect(problem?.figureDesc?.length).toBeLessThanOrEqual(400);
  });
});
