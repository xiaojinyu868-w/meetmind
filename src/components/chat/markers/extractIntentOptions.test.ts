import { describe, expect, it } from 'vitest';
import { extractIntentOptions, stripPartialIntentOptions, stripPartialIntentBlocks } from './extractIntentOptions';

describe('extractIntentOptions', () => {
  it('抽出选项块并返回剩余文本', () => {
    const text = '听起来是件大事。\n\n---选项---\n· 一门课 / 一场考试\n· 一项想练的技能\n· 都不是，我自己说\n---结束---';
    const r = extractIntentOptions(text);
    expect(r).not.toBeNull();
    expect(r!.options).toEqual(['一门课 / 一场考试', '一项想练的技能', '都不是，我自己说']);
    expect(r!.textWithoutBlock).toBe('听起来是件大事。');
  });

  it('支持 - / * / • 前缀，去掉前缀', () => {
    const text = '---选项---\n- 苹果\n* 香蕉\n• 橘子\n---结束---';
    const r = extractIntentOptions(text);
    expect(r!.options).toEqual(['苹果', '香蕉', '橘子']);
  });

  it('超过 4 个选项截断到 4 个', () => {
    const text = '---选项---\n· a\n· b\n· c\n· d\n· e\n---结束---';
    expect(extractIntentOptions(text)!.options).toEqual(['a', 'b', 'c', 'd']);
  });

  it('超长选项截断到 24 字', () => {
    const long = '这是一个特别特别长的选项它超过了二十四字应该被截断掉尾巴';
    const text = `---选项---\n· ${long}\n---结束---`;
    expect(extractIntentOptions(text)!.options[0].length).toBe(24);
  });

  it('块未闭合（流式中）返回 null', () => {
    expect(extractIntentOptions('文本\n---选项---\n· 半截')).toBeNull();
  });

  it('块为空返回 null', () => {
    expect(extractIntentOptions('---选项---\n---结束---')).toBeNull();
  });

  it('保留选项块前后的文本', () => {
    const text = '前文。\n---选项---\n· a\n---结束---\n后文。';
    expect(extractIntentOptions(text)!.textWithoutBlock).toBe('前文。\n\n后文。');
  });
});

describe('stripPartialIntentOptions', () => {
  it('剃掉未闭合的半截选项块', () => {
    expect(stripPartialIntentOptions('可见文本\n---选项---\n· 半截')).toBe('可见文本');
  });

  it('已闭合的块原样返回', () => {
    const text = '可见\n---选项---\n· a\n---结束---';
    expect(stripPartialIntentOptions(text)).toBe(text);
  });

  it('没有选项块原样返回', () => {
    expect(stripPartialIntentOptions('普通文本')).toBe('普通文本');
  });
});

describe('stripPartialIntentBlocks', () => {
  it('剃掉未闭合的"我想要的"半截块', () => {
    expect(stripPartialIntentBlocks('可见\n---我想要的---\n· 半截')).toBe('可见');
  });
  it('剃掉未闭合的"我了解到的你"半截块', () => {
    expect(stripPartialIntentBlocks('可见\n---我了解到的你---\n· 半截')).toBe('可见');
  });
  it('已闭合的块不动', () => {
    const t = '可见\n---我想要的---\n· a\n---结束---';
    expect(stripPartialIntentBlocks(t)).toBe(t);
  });
});
