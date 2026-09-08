import { describe, expect, it } from 'vitest';
import { buildReviewOpening } from './review-starters';

describe('buildReviewOpening', () => {
  it('有标记：开场点名时刻，chip 先是标记处，再补通用起手，最多 3 个', () => {
    const opening = buildReviewOpening({
      anchors: [
        { timestamp: 30_000, cancelled: false, resolved: false },
        { timestamp: 17_000, cancelled: false, resolved: false },
        { timestamp: 90_000, cancelled: false, resolved: true },
        { timestamp: 5_000, cancelled: true, resolved: false },
      ],
    });
    expect(opening.lead).toBe('听完了。你在 0:17、0:30 留了标记——从哪里开始？');
    expect(opening.prompts).toEqual([
      '0:17 那里我没跟上，帮我讲一下',
      '0:30 那里我没跟上，帮我讲一下',
      '先讲清这节课的主线',
    ]);
  });

  it('有转录时 chip 带上那一刻老师的原话——同桌和学生都知道在说哪一句', () => {
    const opening = buildReviewOpening({
      anchors: [{ timestamp: 30_500, cancelled: false, resolved: false }],
      segments: [{ startMs: 30_000, endMs: 34_000, text: 'My name is Jane, Jane Bond.' }],
    });
    expect(opening.prompts[0]).toBe('0:30「My name is Jane, Jane Bond」那里我没跟上，帮我讲一下');
  });

  it('没有标记但有难点：开场说难点，chip 带难点名', () => {
    const opening = buildReviewOpening({ anchors: [], keyDifficulties: ['贝叶斯定理的分母到底是什么意思'] });
    expect(opening.lead).toBe('听完了。这节课有 1 个地方值得多说两句——从哪里开始？');
    expect(opening.prompts[0]).toBe('帮我讲清「贝叶斯定理的分母到底是什么意思」');
  });

  it('什么都没有：退回通用开场', () => {
    const opening = buildReviewOpening({ anchors: [] });
    expect(opening.lead).toBe('在这里。');
    expect(opening.prompts).toEqual(['先讲清这节课的主线', '从我标记的地方开始']);
  });
});
