import { describe, expect, it } from 'vitest';
import { applyScore, faceFontSize, flyDirectionOf, undoScore, visualLength } from './flashcard-deck-model';

describe('flashcard-deck-model', () => {
  it('长卡面自动缩字：短问 21px，长解释一路缩到 14px', () => {
    expect(faceFontSize('映射的定义？')).toBe(21);
    expect(faceFontSize('在映射 f: X → Y 中，符号 Df 和 Rf 分别代表什么？其中的字母 D 和 R 源自哪两个英文单词？')).toBeLessThanOrEqual(19);
    const paragraph = '它意味着讲话的人不确定、困惑或不安，因为计划尚未最终确定。在这段对话里，它特指与即将到来的搬家相关的压力与混乱。';
    expect(faceFontSize(paragraph.repeat(2))).toBe(17);
    const long = paragraph.repeat(4);
    expect(faceFontSize(long)).toBe(14);
    // 背面小一号，但不小于 13.5
    expect(faceFontSize('映射的定义？', true)).toBe(19.5);
    expect(faceFontSize(long, true)).toBe(13.5);
  });

  it('拉丁字母按半个字算，一个英文句子不会被判成超长', () => {
    expect(visualLength('abcd')).toBeCloseTo(2.2, 1);
    expect(faceFontSize('What does "up in the air" mean here?')).toBeGreaterThanOrEqual(19);
  });

  it('打分入历史，撤销收回分数并回到那张', () => {
    let state = { scores: {}, history: [] };
    state = applyScore(state, 'a', 0, 'got');
    state = applyScore(state, 'b', 1, 'missed');
    expect(state.scores).toEqual({ a: 'got', b: 'missed' });
    const undone = undoScore(state);
    expect(undone?.index).toBe(1);
    expect(undone?.state.scores).toEqual({ a: 'got' });
    expect(undone?.state.history).toHaveLength(1);
    // 再撤一次回到第 0 张，全部清空；再撤没有历史 → null
    const again = undoScore(undone!.state);
    expect(again?.index).toBe(0);
    expect(again?.state.scores).toEqual({});
    expect(undoScore(again!.state)).toBeNull();
  });

  it('同一张改分后撤销恢复原分', () => {
    let state = { scores: {}, history: [] };
    state = applyScore(state, 'a', 0, 'missed');
    state = applyScore(state, 'a', 0, 'got');
    expect(undoScore(state)?.state.scores).toEqual({ a: 'missed' });
  });

  it('飞出方向：记住 = 右，没记住 = 左', () => {
    expect(flyDirectionOf('got')).toBe('right');
    expect(flyDirectionOf('missed')).toBe('left');
  });
});
