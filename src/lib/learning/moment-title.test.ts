import { describe, expect, it } from 'vitest';
import { clipDisplay, describeMoment, firstClause, momentLabel, quoteAtMoment } from './moment-title';

const segments = [
  { startMs: 0, endMs: 5000, text: "Good morning ma'am and welcome to Australia's Moving Experience. How can I help you?" },
  { startMs: 6000, endMs: 11000, text: "Well, I hope you can help me. I'm so up in the air right now." },
  { startMs: 30000, endMs: 34000, text: 'My name is Jane, Jane Bond.' },
  { startMs: 60000, endMs: 66000, text: '条件概率不是换一个公式，而是缩小我们正在观察的世界，所以先看清楚我们在哪些人里谈概率。' },
];

describe('moment-title：给一个时刻起名', () => {
  it('没有备注就用老师那一刻的原话首句', () => {
    const d = describeMoment({ timestamp: 30_500 }, segments);
    expect(d).toEqual({ time: '00:30', title: 'My name is Jane, Jane Bond', source: 'quote' });
    expect(momentLabel(d)).toBe('00:30 · My name is Jane, Jane Bond');
  });
  it('学生自己的备注最优先；脉络要点其次', () => {
    expect(describeMoment({ timestamp: 30_500, note: '  名字要写全  ' }, segments).title).toBe('名字要写全');
    const withFlow = describeMoment({ timestamp: 7_000 }, segments, [{ title: '用 up in the air 表达"事情还没定"', startMs: 6000, endMs: 20000 }]);
    expect(withFlow.source).toBe('flow');
    expect(withFlow.title).toContain('up in the air');
  });
  it('时间点落在段与段之间时取前一段；一句都没有只剩时间', () => {
    expect(quoteAtMoment(segments, 20_000)).toBe("Well, I hope you can help me");
    expect(describeMoment({ timestamp: 1000 }, [])).toEqual({ time: '00:01', title: '', source: 'none' });
    expect(momentLabel(describeMoment({ timestamp: 1000 }, []))).toBe('00:01');
  });
  it('中文长句取第一个子句并按显示宽度截断', () => {
    const t = firstClause(segments[3].text);
    expect(t).toBe('条件概率不是换一个公式');
    expect(clipDisplay('一二三四五六七八九十一二三四五六七八九十', 20)).toBe('一二三四五六七八九十…');
    expect(clipDisplay('short english', 20)).toBe('short english');
  });
});
