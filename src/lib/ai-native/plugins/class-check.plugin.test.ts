import { describe, expect, it } from 'vitest';
import { normalizeClassCheckQuestion } from './class-check.plugin';

describe('normalizeClassCheckQuestion', () => {
  it('keeps a model question with a resolvable answer and canonicalizes the letter', () => {
    const question = normalizeClassCheckQuestion({
      stem: '老师说 up in the air 在这里指什么？',
      options: ['A. 在空中', 'B. 事情还没定', 'C. 很开心'],
      answer: 'B. 事情还没定',
      explanation: '原话说她刚说完自己要搬家，心里没底。',
    });
    expect(question).toEqual({
      stem: '老师说 up in the air 在这里指什么？',
      options: ['A. 在空中', 'B. 事情还没定', 'C. 很开心'],
      answer: 'B',
      explanation: '原话说她刚说完自己要搬家，心里没底。',
    });
  });

  it('drops questions without stem / enough options / a resolvable answer — never defaults to A', () => {
    expect(normalizeClassCheckQuestion(undefined)).toBeNull();
    expect(normalizeClassCheckQuestion({ options: ['A. 甲', 'B. 乙'], answer: 'A' })).toBeNull();
    expect(normalizeClassCheckQuestion({ stem: '只有一个选项', options: ['A. 甲'], answer: 'A' })).toBeNull();
    expect(normalizeClassCheckQuestion({ stem: '没有答案', options: ['A. 甲', 'B. 乙'] })).toBeNull();
    expect(normalizeClassCheckQuestion({ stem: '答案越界', options: ['A. 甲', 'B. 乙'], answer: 'E' })).toBeNull();
  });
});
