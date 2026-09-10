import { describe, expect, it } from 'vitest';
import {
  JudgeStreamParser,
  fallbackJudge,
  parseJudgeHeader,
  parseSseChunk,
  recentJudgeIds,
  trimPanelHistory,
} from './teach-back-panel';
import type { TeachBackTurn } from './types';

describe('parseJudgeHeader', () => {
  it('裸代号', () => {
    expect(parseJudgeHeader('direct')).toEqual({ judge: 'direct', rest: '' });
    expect(parseJudgeHeader('  Guide ')).toEqual({ judge: 'guide', rest: '' });
  });

  it('带装饰与前缀的写法', () => {
    expect(parseJudgeHeader('评委：probe')).toEqual({ judge: 'probe', rest: '' });
    expect(parseJudgeHeader('[direct]')).toEqual({ judge: 'direct', rest: '' });
    expect(parseJudgeHeader('**guide**')).toEqual({ judge: 'guide', rest: '' });
  });

  it('代号后同一行跟着正文：正文不丢', () => {
    expect(parseJudgeHeader('probe: 你说的收敛具体指什么？')).toEqual({ judge: 'probe', rest: '你说的收敛具体指什么？' });
    expect(parseJudgeHeader('direct 这个结论从哪来？')).toEqual({ judge: 'direct', rest: '这个结论从哪来？' });
  });

  it('none / 沉默 → judge=null', () => {
    expect(parseJudgeHeader('none')).toEqual({ judge: null, rest: '' });
    expect(parseJudgeHeader('沉默')).toEqual({ judge: null, rest: '' });
    expect(parseJudgeHeader('评委：无')).toEqual({ judge: null, rest: '' });
  });

  it('认不出 → undefined', () => {
    expect(parseJudgeHeader('你刚才说的定义不对。')).toBeUndefined();
    expect(parseJudgeHeader('')).toBeUndefined();
  });
});

describe('JudgeStreamParser', () => {
  function collect(parser: JudgeStreamParser, deltas: string[]): { judge: unknown; text: string } {
    let judge: unknown = 'unset';
    let text = '';
    for (const delta of deltas) {
      for (const chunk of parser.push(delta)) {
        if (chunk.judge !== undefined) judge = chunk.judge;
        if (chunk.text) text += chunk.text;
      }
    }
    for (const chunk of parser.flush()) {
      if (chunk.judge !== undefined) judge = chunk.judge;
      if (chunk.text) text += chunk.text;
    }
    return { judge, text };
  }

  it('头行齐了才开始吐正文，之后逐字透传', () => {
    const parser = new JudgeStreamParser();
    expect(parser.push('dir')).toEqual([]);
    expect(parser.push('ect\n你刚')).toEqual([{ judge: 'direct' }, { text: '你刚' }]);
    expect(parser.push('才说')).toEqual([{ text: '才说' }]);
    expect(parser.judgeId).toBe('direct');
  });

  it('none 头行 → 沉默，没有正文', () => {
    const parser = new JudgeStreamParser();
    expect(collect(parser, ['none\n'])).toEqual({ judge: null, text: '' });
  });

  it('模型没写头行直接开讲：归到最近没开口的评委，正文一个字不丢', () => {
    const parser = new JudgeStreamParser(['direct', 'guide']);
    const result = collect(parser, ['你刚才说递归一定比循环慢，', '这个结论是从哪来的？']);
    expect(result.judge).toBe('probe');
    expect(result.text).toBe('你刚才说递归一定比循环慢，这个结论是从哪来的？');
  });

  it('代号和正文写在同一行', () => {
    const parser = new JudgeStreamParser();
    const result = collect(parser, ['guide：我们先退一步，', '你能举个例子吗？']);
    expect(result).toEqual({ judge: 'guide', text: '我们先退一步，你能举个例子吗？' });
  });

  it('只有代号没有正文 → 视为沉默', () => {
    const parser = new JudgeStreamParser();
    expect(collect(parser, ['probe'])).toEqual({ judge: null, text: '' });
  });

  it('空输出 → 沉默', () => {
    const parser = new JudgeStreamParser();
    expect(collect(parser, [''])).toEqual({ judge: null, text: '' });
  });
});

describe('fallbackJudge', () => {
  it('把话给最近两位之外的那位', () => {
    expect(fallbackJudge([])).toBe('direct');
    expect(fallbackJudge(['direct'])).toBe('guide');
    expect(fallbackJudge(['guide', 'direct'])).toBe('probe');
    expect(fallbackJudge(['probe', 'direct'])).toBe('guide');
  });
});

describe('trimPanelHistory / recentJudgeIds', () => {
  const turns: TeachBackTurn[] = [
    { role: 'user', text: '一'.repeat(100) },
    { role: 'assistant', text: '问一', judgeId: 'direct' },
    { role: 'user', text: '二'.repeat(100) },
    { role: 'assistant', text: '问二', judgeId: 'probe' },
    { role: 'user', text: '三'.repeat(100) },
  ];

  it('按预算从最近往前保留', () => {
    const kept = trimPanelHistory(turns, 216);
    expect(kept.map((turn) => turn.text[0])).toEqual(['二', '问', '三']);
  });

  it('预算再小也至少留最后两条用户发言', () => {
    const kept = trimPanelHistory(turns, 10);
    expect(kept.filter((turn) => turn.role === 'user')).toHaveLength(2);
  });

  it('预算够就全留', () => {
    expect(trimPanelHistory(turns, 10_000)).toHaveLength(5);
  });

  it('最近开口的评委（新→旧）', () => {
    expect(recentJudgeIds(turns)).toEqual(['probe', 'direct']);
    expect(recentJudgeIds(turns, 1)).toEqual(['probe']);
  });
});

describe('parseSseChunk', () => {
  it('切出完整 data 行并保留半截', () => {
    const first = parseSseChunk('', 'data: {"type":"judge","judgeId":"direct"}\n\ndata: {"type":"delta","te');
    expect(first.events).toEqual([{ type: 'judge', judgeId: 'direct' }]);
    const second = parseSseChunk(first.carry, 'xt":"你好"}\n\n: ping\n\ndata: [DONE]\n\n');
    expect(second.events).toEqual([{ type: 'delta', text: '你好' }]);
    expect(second.carry).toBe('');
  });

  it('done / silent / error 事件', () => {
    const { events } = parseSseChunk('', [
      'data: {"type":"done","judgeId":"guide","text":"好。"}',
      'data: {"type":"silent"}',
      'data: {"type":"error","message":"boom"}',
      'data: {"type":"judge","judgeId":"nobody"}',
      'data: not-json',
      '',
    ].join('\n'));
    expect(events).toEqual([
      { type: 'done', judgeId: 'guide', text: '好。' },
      { type: 'silent' },
      { type: 'error', message: 'boom' },
    ]);
  });
});
