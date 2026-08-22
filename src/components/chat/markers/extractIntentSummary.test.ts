import { describe, expect, it } from 'vitest';
import { extractIntentSummary } from './extractIntentSummary';

describe('extractIntentSummary — horizon 时间尺度', () => {
  it('解析首行 [中期] 前缀并剥掉', () => {
    const text = '---我想要的---\n· [中期] 我想这学期把数学拉上来\n· 每天晚自习留一小时\n---结束---';
    const r = extractIntentSummary(text)!;
    expect(r.horizon).toBe('term');
    expect(r.points[0]).toBe('我想这学期把数学拉上来');
    expect(r.title).toBe('我想这学期把数学拉上来');
  });

  it('[短期] → near，[长期] → long', () => {
    const near = extractIntentSummary('---我想要的---\n· [短期] 下周高数不挂科\n---结束---')!;
    expect(near.horizon).toBe('near');
    const long = extractIntentSummary('---我想要的---\n· [长期] 我想转行做设计\n---结束---')!;
    expect(long.horizon).toBe('long');
    expect(long.points[0]).toBe('我想转行做设计');
  });

  it('无前缀时 horizon 为 undefined（向后兼容）', () => {
    const r = extractIntentSummary('---我想要的---\n· 我想转行做设计\n---结束---')!;
    expect(r.horizon).toBeUndefined();
    expect(r.points[0]).toBe('我想转行做设计');
  });
});
