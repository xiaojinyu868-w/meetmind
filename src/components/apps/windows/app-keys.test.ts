import { describe, expect, it } from 'vitest';
import { isTypingTarget, resolveFlashcardKey, resolvePlayerKey, resolveQuizKey } from './app-keys';

describe('app-keys', () => {
  it('输入控件上不抢键', () => {
    expect(isTypingTarget({ tagName: 'input' })).toBe(true);
    expect(isTypingTarget({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isTypingTarget({ tagName: 'BUTTON' })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });

  describe('测验', () => {
    const base = { optionCount: 4, subjective: false, submitted: false, typing: false };
    it('1–4 选选项，超出选项数无效', () => {
      expect(resolveQuizKey('1', base)).toEqual({ type: 'select', index: 0 });
      expect(resolveQuizKey('4', base)).toEqual({ type: 'select', index: 3 });
      expect(resolveQuizKey('5', base)).toBeNull();
    });
    it('交卷后 / 主观题 / 正在输入时数字键无效', () => {
      expect(resolveQuizKey('1', { ...base, submitted: true })).toBeNull();
      expect(resolveQuizKey('1', { ...base, subjective: true })).toBeNull();
      expect(resolveQuizKey('1', { ...base, typing: true })).toBeNull();
    });
    it('回车与空格都是主动作', () => {
      expect(resolveQuizKey('Enter', base)).toEqual({ type: 'primary' });
      expect(resolveQuizKey(' ', base)).toEqual({ type: 'primary' });
      expect(resolveQuizKey(' ', { ...base, typing: true })).toBeNull();
    });
  });

  describe('闪卡', () => {
    it('空格翻面；翻开后 1/2 或 ←→ 打分；没翻开 ←→ 换牌；Z 撤销', () => {
      expect(resolveFlashcardKey(' ', { flipped: false, typing: false })).toBe('flip');
      expect(resolveFlashcardKey('1', { flipped: true, typing: false })).toBe('missed');
      expect(resolveFlashcardKey('2', { flipped: true, typing: false })).toBe('got');
      expect(resolveFlashcardKey('ArrowLeft', { flipped: true, typing: false })).toBe('missed');
      expect(resolveFlashcardKey('ArrowRight', { flipped: true, typing: false })).toBe('got');
      expect(resolveFlashcardKey('ArrowLeft', { flipped: false, typing: false })).toBe('prev');
      expect(resolveFlashcardKey('ArrowRight', { flipped: false, typing: false })).toBe('next');
      expect(resolveFlashcardKey('1', { flipped: false, typing: false })).toBeNull();
      expect(resolveFlashcardKey('z', { flipped: false, typing: false })).toBe('undo');
      expect(resolveFlashcardKey('z', { flipped: false, typing: true })).toBeNull();
    });
  });

  describe('播放类', () => {
    it('空格 / K 切换，←→ 与 J / L 前后', () => {
      expect(resolvePlayerKey(' ', false)).toBe('toggle');
      expect(resolvePlayerKey('k', false)).toBe('toggle');
      expect(resolvePlayerKey('ArrowLeft', false)).toBe('back');
      expect(resolvePlayerKey('l', false)).toBe('forward');
      expect(resolvePlayerKey(' ', true)).toBeNull();
    });
  });
});
