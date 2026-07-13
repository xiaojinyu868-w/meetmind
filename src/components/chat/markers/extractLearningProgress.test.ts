import { describe, expect, it } from 'vitest';
import { extractLearningProgress } from './extractLearningProgress';

describe('extractLearningProgress', () => {
  it('extracts confirmed-learning candidates without showing the marker block', () => {
    const result = extractLearningProgress(`先用一个例子讲清楚。\n\n---学习进展---\n· 已经能区分损失和梯度\n- 下一次可以自己推一次链式法则\n---结束---`);
    expect(result?.points).toEqual(['已经能区分损失和梯度', '下一次可以自己推一次链式法则']);
    expect(result?.textWithoutBlock).toBe('先用一个例子讲清楚。');
  });

  it('waits for a complete block while streaming', () => {
    expect(extractLearningProgress('---学习进展---\n· 刚刚学会')).toBeNull();
  });
});
