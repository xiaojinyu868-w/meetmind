/**
 * 解析器回归：晋升 spike scripts/check-parser.ts 的思路（离线，无网络）。
 *
 * ① 上游 bug 复现形态：嵌套数组参数（wb_draw_table 的 data:[[...]]）+ SSE 恰在
 *    嵌套 `]` 处停顿——上游 endsWith(']') 提前判结吞掉后续口播；[FIX vs upstream]
 *    的顶层深度扫描必须完整吐出（整段 / 1 字符 / 停顿点三种切法）。
 * ② glm 低频协议违例兜底：`{"type":"text":"content"}` 缺逗号的畸形条目，
 *    jsonrepair 修复路径必须救回口播（teach-harness-ab 实测 4/54 turn 中招形态）。
 */
import { describe, expect, it } from 'vitest';
import {
  createParserState,
  parseStructuredChunk,
  finalizeParser,
} from '../vendor/openmaic/orchestration/stateless-generate';

const payload = JSON.stringify([
  { type: 'text', content: '我们来看这个表格。' },
  {
    type: 'action',
    name: 'wb_draw_table',
    params: {
      x: 10,
      y: 10,
      width: 300,
      height: 200,
      data: [
        ['数', '因数'],
        ['4', '1,2,4'],
        ['7', '1,7'],
      ],
    },
  },
  { type: 'text', content: '发现了什么规律？' },
  { type: 'text', content: '这是停顿点之后的口播，不能被吞。' },
]);

function feed(chunks: string[]) {
  const state = createParserState();
  const texts: string[] = [];
  const actions: string[] = [];
  let closed = false;
  for (const c of chunks) {
    const r = parseStructuredChunk(c, state);
    texts.push(...r.textChunks);
    actions.push(...r.actions.map((a) => a.actionName));
    if (r.isDone) closed = true;
  }
  const fin = finalizeParser(state);
  texts.push(...fin.textChunks);
  actions.push(...fin.actions.map((a) => a.actionName));
  return { texts, actions, closed };
}

describe('vendor 解析器 [FIX vs upstream] 回归：嵌套数组参数不再提前判结', () => {
  const cases: Record<string, string[]> = {
    整段: [payload],
    '1字符粒度（SSE 任意停顿）': payload.split(''),
    '恰在嵌套 ] 后停顿（上游 bug 复现切法）': [
      payload.slice(0, payload.indexOf('],[') + 1),
      payload.slice(payload.indexOf('],[') + 1),
    ],
  };

  for (const [name, chunks] of Object.entries(cases)) {
    it(name, () => {
      const r = feed(chunks);
      const spoken = r.texts.join('');
      expect(r.closed).toBe(true);
      expect(r.actions).toEqual(['wb_draw_table']);
      expect(spoken).toContain('我们来看这个表格');
      expect(spoken).toContain('发现了什么规律');
      expect(spoken).toContain('不能被吞');
    });
  }
});

describe('glm 畸形输出兜底（jsonrepair 修复路径）', () => {
  it('{"type":"text":"content"} 缺逗号的条目被修回，口播不丢', () => {
    // glm 低频协议违例形态：相邻字段间缺逗号
    const broken =
      '[{"type":"text","content":"先回答你的问题：1 不算质数！"},' +
      '{"type":"text""content":"因为 1 的因数只有它自己。"},' +
      '{"type":"action","name":"spotlight","params":{"elementId":"note1"}}]';
    const r = feed([broken]);
    const spoken = r.texts.join('');
    expect(spoken).toContain('1 不算质数');
    expect(spoken).toContain('1 的因数只有它自己');
    expect(r.actions).toContain('spotlight');
  });

  it('顶层数组未闭合（截断）：finalize 救回已闭合条目，不泄漏裸 JSON', () => {
    const truncated =
      '[{"type":"text","content":"看到这一步。"},{"type":"action","name":"wb_clear","params":{}},{"type":"text","content":"这句话没说完';
    const r = feed([truncated]);
    const spoken = r.texts.join('');
    expect(r.closed).toBe(false);
    expect(spoken).toContain('看到这一步');
    expect(r.actions).toContain('wb_clear');
    // 截断的尾部残片不作为可见口播泄漏
    expect(spoken).not.toContain('{"type"');
  });
});
