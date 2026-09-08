import { describe, expect, it } from 'vitest';
import { isSameQuestion } from './useClassroomForesight';

describe('isSameQuestion（预知 chip 按问句去重）', () => {
  it('同义改写算同一个问题', () => {
    expect(isSameQuestion('up in the air 是什么意思？', 'up in the air 是啥意思？')).toBe(true);
    expect(isSameQuestion('这里为什么要填表？', '这里为啥要填表')).toBe(true);
    expect(isSameQuestion('"up in the air"是啥意思？', 'up in the air 是什么意思？')).toBe(true);
  });
  it('不同的问题不被误杀', () => {
    expect(isSameQuestion('up in the air 是什么意思？', '这是在机场还是搬家公司？')).toBe(false);
    expect(isSameQuestion('名字是填 Jane 还是 Jane Bond？', '只能听一遍吗？')).toBe(false);
  });
});
