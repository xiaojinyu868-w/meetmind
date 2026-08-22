import { describe, expect, it } from 'vitest';
import type { TranscriptSegment } from '@/types';
import {
  buildTranscriptCorpus,
  downgradeInvalidQuotes,
  formatClassTime,
  validateExplainerQuotes,
} from './explainer-quotes';

const segments: TranscriptSegment[] = [
  { id: 's1', text: '好，我们来看这道题。边际成本', startMs: 0, endMs: 5000, confidence: 0.9 },
  { id: 's2', text: '就是多生产一个单位', startMs: 5000, endMs: 9000, confidence: 0.9 },
  { id: 's3', text: '所增加的成本。大家记住这一点。', startMs: 9000, endMs: 14000, confidence: 0.9 },
];

describe('validateExplainerQuotes', () => {
  it('接受逐字出自单段的引用', () => {
    const { valid, invalid } = validateExplainerQuotes(
      [{ text: '就是多生产一个单位', startMs: 5000 }],
      segments,
    );
    expect(valid).toHaveLength(1);
    expect(invalid).toHaveLength(0);
  });

  it('接受跨相邻段拼接的引用', () => {
    const { valid, invalid } = validateExplainerQuotes(
      [{ text: '边际成本就是多生产一个单位所增加的成本', startMs: 0 }],
      segments,
    );
    expect(valid).toHaveLength(1);
    expect(invalid).toHaveLength(0);
  });

  it('判改写过的引用为 invalid', () => {
    const { valid, invalid } = validateExplainerQuotes(
      [{ text: '边际成本就是每多生产一件产品增加的成本' }],
      segments,
    );
    expect(valid).toHaveLength(0);
    expect(invalid).toHaveLength(1);
  });

  it('去空白后命中：引用里的换行和空格不影响校验', () => {
    const { valid } = validateExplainerQuotes(
      [{ text: '就是多生产\n  一个单位 所增加的\n成本' }],
      segments,
    );
    expect(valid).toHaveLength(1);
  });

  it('忽略空文本引用', () => {
    const { valid, invalid } = validateExplainerQuotes([{ text: '   ' }], segments);
    expect(valid).toHaveLength(0);
    expect(invalid).toHaveLength(0);
  });

  it('语料为全部 segment 拼接且去空白', () => {
    expect(buildTranscriptCorpus(segments)).toBe(
      '好，我们来看这道题。边际成本就是多生产一个单位所增加的成本。大家记住这一点。',
    );
  });
});

describe('downgradeInvalidQuotes', () => {
  const html = [
    '<!DOCTYPE html><html><body>',
    '<q class="mm-quote" data-ts="0">边际成本就是多生产一个单位所增加的成本</q>',
    '<q data-ts="5000" class="mm-quote">就是多生产一个单位</q>',
    '</body></html>',
  ].join('');

  it('把校验失败的 q.mm-quote 降级为 span.mm-said，并计数', () => {
    const invalid = [{ text: '边际成本就是多生产一个单位所增加的成本' }];
    const { html: fixed, downgraded } = downgradeInvalidQuotes(html, invalid);

    expect(downgraded).toBe(1);
    expect(fixed).toContain(
      '<span class="mm-said">边际成本就是多生产一个单位所增加的成本</span>',
    );
    expect(fixed).not.toContain(
      '<q class="mm-quote" data-ts="0">边际成本就是多生产一个单位所增加的成本</q>',
    );
    // 另一条引用不受影响
    expect(fixed).toContain('<q data-ts="5000" class="mm-quote">就是多生产一个单位</q>');
  });

  it('inner text 允许空白差异，仍能命中降级', () => {
    const messy = '<q class="mm-quote" data-ts="0">边际成本\n  就是多生产一个单位所增加的成本</q>';
    const { html: fixed, downgraded } = downgradeInvalidQuotes(messy, [
      { text: '边际成本就是多生产一个单位所增加的成本' },
    ]);
    expect(downgraded).toBe(1);
    expect(fixed).toContain('<span class="mm-said">');
  });

  it('html 中找不到对应引用时跳过，不改动页面', () => {
    const { html: fixed, downgraded } = downgradeInvalidQuotes(html, [
      { text: '一句页面里根本不存在的引用' },
    ]);
    expect(downgraded).toBe(0);
    expect(fixed).toBe(html);
  });

  it('不误伤没有 mm-quote 类名的 q 标签', () => {
    const plain = '<q class="other">就是多生产一个单位</q>';
    const { html: fixed, downgraded } = downgradeInvalidQuotes(plain, [
      { text: '就是多生产一个单位' },
    ]);
    expect(downgraded).toBe(0);
    expect(fixed).toBe(plain);
  });
});

describe('formatClassTime', () => {
  it('一小时内显示 MM:SS', () => {
    expect(formatClassTime(0)).toBe('00:00');
    expect(formatClassTime(83_000)).toBe('01:23');
  });

  it('超过一小时显示 HH:MM', () => {
    expect(formatClassTime(3_725_000)).toBe('01:02');
  });
});
