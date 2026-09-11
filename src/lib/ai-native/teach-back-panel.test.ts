import { describe, expect, it } from 'vitest';
import {
  JudgeStreamParser,
  fallbackJudge,
  parseJudgeHeader,
  parseSseChunk,
  recentJudgeIds,
  selectRelevantTranscript,
  transcriptQueryFeatures,
  trimPanelHistory,
} from './teach-back-panel';
import type { TeachBackTurn } from './types';

describe('selectRelevantTranscript', () => {
  // 每段补到 ~60 字，整节课 ~480 字；预算 200~250 时只装得下三四段
  const pad = (text: string) => `${text}${'好，我们接着往下讲，大家注意听这里的推导过程和它背后的想法。'.slice(0, Math.max(0, 60 - text.length))}`;
  const seg = (index: number, text: string) => ({ text: pad(text), startMs: index * 10_000, endMs: index * 10_000 + 9_000 });
  const lesson = [
    seg(0, '同学们好，今天我们讲映射与函数。'),
    seg(1, '先说映射的定义：X 到 Y 的一个对应法则。'),
    seg(2, '然后是单射：不同的 x 对应不同的 y。'),
    seg(3, '只有单射才有逆映射，因为反过来每个 y 只能找到一个 x。'),
    seg(4, '逆映射的定义域是 Rf，不是整个 Y，这一点很多人搞错。'),
    seg(5, '再讲复合映射 f 圈 g，先做 g 再做 f。'),
    seg(6, '课间休息一下。'),
    seg(7, '最后是满射：值域等于整个 Y。'),
  ];
  const total = lesson.reduce((sum, item) => sum + item.text.length, 0);

  it('整节课装得下就原样全给', () => {
    const window = selectRelevantTranscript(lesson, '单射', [], { maxChars: total });
    expect(window.windowed).toBe(false);
    expect(window.segments).toHaveLength(lesson.length);
  });

  it('超预算时挑与刚讲这段最相关的段（带邻居），按课堂顺序拼，不逐段截断', () => {
    const window = selectRelevantTranscript(lesson, '逆映射的定义域就是原来的值域 Rf，值域是原来的定义域', [], { maxChars: 250, neighbors: 1 });
    expect(window.windowed).toBe(true);
    const texts = window.segments.map((item) => item.text);
    expect(texts).toContain(lesson[4].text);
    expect(texts.some((text) => text.includes('课间休息'))).toBe(false);
    expect(window.segments.map((item) => item.startMs)).toEqual([...window.segments.map((item) => item.startMs)].sort((a, b) => a - b));
    expect(window.segments.reduce((sum, item) => sum + item.text.length, 0)).toBeLessThanOrEqual(250);
    for (const item of window.segments) expect(lesson.map((l) => l.text)).toContain(item.text);
  });

  it('目标点的证据段先进窗口', () => {
    const window = selectRelevantTranscript(lesson, '今天天气不错', [{ evidence: { startMs: 70_000, endMs: 72_000 } }], { maxChars: 200 });
    expect(window.segments.map((item) => item.text)).toContain(lesson[7].text);
  });

  it('讲的与这节课无关：退回开头几段，评委至少知道这节课讲什么', () => {
    const window = selectRelevantTranscript(lesson, '牛顿第二定律 F=ma', [], { maxChars: 200 });
    expect(window.windowed).toBe(true);
    expect(window.segments[0].text).toBe(lesson[0].text);
    expect(window.segments.length).toBeLessThan(lesson.length);
  });

  it('特征 = 汉字二元组 + 拉丁 / 数字整词', () => {
    const features = transcriptQueryFeatures('逆映射的定义域是 Rf，x² 不是单射。');
    expect(features.has('逆映')).toBe(true);
    expect(features.has('rf')).toBe(true);
    expect(features.has('x²')).toBe(true);
    expect(features.has('，x')).toBe(false);
  });
});

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

  it('maxUserTurns 封顶回合数：只看最近两回合（连同评委对它们的回应）', () => {
    const kept = trimPanelHistory(turns, 10_000, 2);
    expect(kept.map((turn) => turn.text[0])).toEqual(['二', '问', '三']);
    expect(trimPanelHistory(turns, 10_000, 1).map((turn) => turn.text[0])).toEqual(['三']);
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
