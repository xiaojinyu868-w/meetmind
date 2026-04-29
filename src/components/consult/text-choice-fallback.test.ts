import { describe, expect, it } from 'vitest';
import { parseInlineChoicePrompt } from './text-choice-parser';

describe('parseInlineChoicePrompt', () => {
  it('parses Chinese A/B/C inline choices', () => {
    const parsed = parseInlineChoicePrompt(
      '你的目标学校更倾向哪一档：A）冲刺顶尖（Stanford/CMU/Berkeley等NLP强校），B）主申中坚（UCSD/UW/UT Austin等），C）混合策略（2冲刺+3主申+2保底）？',
    );

    expect(parsed?.question).toBe('你的目标学校更倾向哪一档');
    expect(parsed?.options).toEqual([
      { id: 'a', label: 'A', text: '冲刺顶尖（Stanford/CMU/Berkeley等NLP强校）' },
      { id: 'b', label: 'B', text: '主申中坚（UCSD/UW/UT Austin等）' },
      { id: 'c', label: 'C', text: '混合策略（2冲刺+3主申+2保底）' },
    ]);
  });

  it('parses colon and full-width markers', () => {
    const parsed = parseInlineChoicePrompt(
      '你现在最想先弄清哪件事？Ａ：我适合走哪条路；Ｂ：我的背景够不够打；Ｃ：先看材料怎么改',
    );

    expect(parsed?.question).toBe('你现在最想先弄清哪件事？');
    expect(parsed?.options).toEqual([
      { id: 'a', label: 'A', text: '我适合走哪条路' },
      { id: 'b', label: 'B', text: '我的背景够不够打' },
      { id: 'c', label: 'C', text: '先看材料怎么改' },
    ]);
  });

  it('parses parenthesized markers', () => {
    const parsed = parseInlineChoicePrompt(
      '先定一个入口：(A) 路线定位 (B) 背景评估 (C) 材料诊断',
    );

    expect(parsed?.question).toBe('先定一个入口');
    expect(parsed?.options).toEqual([
      { id: 'a', label: 'A', text: '路线定位' },
      { id: 'b', label: 'B', text: '背景评估' },
      { id: 'c', label: 'C', text: '材料诊断' },
    ]);
  });

  it('ignores regular prose', () => {
    expect(parseInlineChoicePrompt('我先帮你判断目标和材料，再决定下一步。')).toBeNull();
  });
});
