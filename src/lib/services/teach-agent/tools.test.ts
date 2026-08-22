import { describe, expect, it } from 'vitest';
import { createBoardEnv, createTeachTools, normalizeFormulaText } from './tools';

function call(execute: unknown, input: Record<string, unknown>) {
  return (execute as (i: unknown, o: unknown) => Promise<Record<string, unknown>>)(input, {});
}

describe('teach-agent tools + 环境反馈', () => {
  it('write 分配 wN 引用并回黑板 digest', async () => {
    const env = createBoardEnv();
    const tools = createTeachTools(env);
    const r1 = await call(tools.write.execute, { text: '配方法', role: 'title' });
    expect(r1).toMatchObject({ ok: true, ref: 'w1' });
    const r2 = await call(tools.write.execute, { text: 'x² + 6x = 0', role: 'step' });
    expect(r2.ref).toBe('w2');
    expect(r2.board).toContain('w1「配方法」');
    expect(r2.board).toContain('w2「x² + 6x = 0」');
  });

  it('circle 引用不存在的 wN 当场报错（环境自纠，不等 sanitize）', async () => {
    const env = createBoardEnv();
    const tools = createTeachTools(env);
    await call(tools.write.execute, { text: 'a', role: 'term' });
    const bad = await call(tools.circle.execute, { target: 'w9' });
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain('wN');
    const good = await call(tools.circle.execute, { target: 'w1' });
    expect(good.ok).toBe(true);
    // 区间引用
    await call(tools.write.execute, { text: 'b', role: 'term' });
    await call(tools.write.execute, { text: 'c', role: 'term' });
    const range = await call(tools.underline.execute, { target: ['w1', 'w3'] });
    expect(range.ok).toBe(true);
  });

  it('flip_page 重置 wN 计数；超过页上限报错提示 finish', async () => {
    const env = createBoardEnv();
    const tools = createTeachTools(env);
    await call(tools.write.execute, { text: 'a', role: 'term' });
    const flip = await call(tools.flip_page.execute, {});
    expect(flip).toMatchObject({ ok: true, flippedTo: 2 });
    expect(env.writes).toHaveLength(0);
    const w = await call(tools.write.execute, { text: 'b', role: 'term' });
    expect(w.ref).toBe('w1'); // 新页重新计数

    for (let i = 0; i < 4; i += 1) await call(tools.flip_page.execute, {});
    const overflow = await call(tools.flip_page.execute, {});
    expect(overflow.ok).toBe(false);
    expect(overflow.error).toContain('finish');
  });

  it('ref 只允许引用已翻过的页', async () => {
    const env = createBoardEnv();
    const tools = createTeachTools(env);
    const bad = await call(tools.ref.execute, { page: 1, target: 'w1' });
    expect(bad.ok).toBe(false);
    await call(tools.flip_page.execute, {});
    const good = await call(tools.ref.execute, { page: 1, target: 'w1' });
    expect(good.ok).toBe(true);
  });

  it('本页动作偏多时 result 带翻页提示', async () => {
    const env = createBoardEnv();
    const tools = createTeachTools(env);
    let last: Record<string, unknown> = {};
    for (let i = 0; i < 14; i += 1) {
      last = await call(tools.write.execute, { text: `s${i}`, role: 'step' });
    }
    expect(last.nudge).toContain('flip_page');
  });

  it('new_column 换栏并在 digest 里反馈栏号；一页最多 2 栏', async () => {
    const env = createBoardEnv();
    const tools = createTeachTools(env);
    await call(tools.write.execute, { text: 'a', role: 'step' });
    const r = await call(tools.new_column.execute, {});
    expect(r).toMatchObject({ ok: true, newColumn: 2 });
    expect(r.board).toContain('第2栏');
    const overflow = await call(tools.new_column.execute, {});
    expect(overflow.ok).toBe(false);
    expect(overflow.error).toContain('flip_page');
  });

  it('flip_page 后栏号归零（新页从左栏写起）', async () => {
    const env = createBoardEnv();
    const tools = createTeachTools(env);
    await call(tools.new_column.execute, {});
    expect(env.column).toBe(2);
    await call(tools.flip_page.execute, {});
    expect(env.column).toBe(1);
  });

  it('finish 置位并携带总结', async () => {
    const env = createBoardEnv();
    const tools = createTeachTools(env);
    const r = await call(tools.finish.execute, { summary: '配方法三步走' });
    expect(r.ok).toBe(true);
    expect(env.finished).toBe(true);
    expect(env.finishSummary).toBe('配方法三步走');
  });

  it('pause 上限由 schema 约束（>5000 拒绝）', () => {
    const tools = createTeachTools(createBoardEnv());
    const parsed = tools.pause.inputSchema.safeParse({ ms: 9999 });
    expect(parsed.success).toBe(false);
  });
});

describe('normalizeFormulaText（LaTeX 反斜杠双重转义收敛）', () => {
  it('字母前的连续反斜杠收敛为一个，正常文本不动', () => {
    expect(normalizeFormulaText('= a \\\\cdot a - b')).toBe('= a \\cdot a - b');
    expect(normalizeFormulaText('\\\\text{相同项}')).toBe('\\text{相同项}');
    expect(normalizeFormulaText('\\frac{a}{b}')).toBe('\\frac{a}{b}');
    expect(normalizeFormulaText('x^2+1')).toBe('x^2+1');
  });

  it('剥掉展示数学定界符（\\[ \\] / $$ / $），公式体不动', () => {
    expect(normalizeFormulaText('\\[ \\zeta(s)=\\sum_{n=1}^{\\infty}\\frac{1}{n^s} \\]')).toBe(
      '\\zeta(s)=\\sum_{n=1}^{\\infty}\\frac{1}{n^s}',
    );
    expect(normalizeFormulaText('$$a^2-b^2$$')).toBe('a^2-b^2');
    expect(normalizeFormulaText('$x^2$')).toBe('x^2');
    expect(normalizeFormulaText('  \\frac{1}{2}  ')).toBe('\\frac{1}{2}');
  });
});
