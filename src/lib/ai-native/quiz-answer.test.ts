import { describe, expect, it } from 'vitest';
import { formatMultipleAnswer, joinMultipleSelection, parseMultipleAnswer, resolveOptionRef, sameOptionSet, splitMultipleSelection } from './quiz-answer';

const options = ['A. 放弃的最佳替代方案', '已经花掉收不回的钱', 'C、所有被放弃的选项之和', '再生产一个单位的成本'];

describe('quiz-answer：多选答案的解析与规范化', () => {
  it('字母 / 连写字母 / 各种分隔符 / 选项原文都认，按选项顺序去重', () => {
    expect(parseMultipleAnswer('A、D', options)).toEqual([options[0], options[3]]);
    expect(parseMultipleAnswer('AD', options)).toEqual([options[0], options[3]]);
    expect(parseMultipleAnswer('D, A', options)).toEqual([options[0], options[3]]);
    expect(parseMultipleAnswer('A和D', options)).toEqual([options[0], options[3]]);
    expect(parseMultipleAnswer('放弃的最佳替代方案；再生产一个单位的成本', options)).toEqual([options[0], options[3]]);
    expect(parseMultipleAnswer('以上都不对', options)).toEqual([]);
  });

  it('formatMultipleAnswer 写成 "A、C" 这种字母契约；selected 里的连接符是控制字符', () => {
    expect(formatMultipleAnswer([options[0], options[2]], options)).toBe('A、C');
    const joined = joinMultipleSelection([options[1], options[3]]);
    expect(joined).toContain('\u001f');
    expect(splitMultipleSelection(joined)).toEqual([options[1], options[3]]);
    expect(splitMultipleSelection(undefined)).toEqual([]);
  });

  it('resolveOptionRef 容忍选项自带的字母前缀；sameOptionSet 顺序无关', () => {
    expect(resolveOptionRef('放弃的最佳替代方案', options)).toBe(options[0]);
    expect(resolveOptionRef('c', options)).toBe(options[2]);
    expect(resolveOptionRef('E', options)).toBeUndefined();
    expect(sameOptionSet([options[0], options[3]], [options[3], options[0]])).toBe(true);
    expect(sameOptionSet([options[0]], [options[0], options[3]])).toBe(false);
  });
});
