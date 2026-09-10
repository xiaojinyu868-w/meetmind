import { describe, expect, it } from 'vitest';
import { hintStorageKey, markHintSeen, readHintSeen } from './keyboard-hints';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
  };
}

describe('keyboard-hints', () => {
  it('每个应用一把钥匙，互不干扰', () => {
    expect(hintStorageKey('quiz')).not.toBe(hintStorageKey('flashcards'));
    const storage = memoryStorage();
    markHintSeen(storage, 'quiz');
    expect(readHintSeen(storage, 'quiz')).toBe(true);
    expect(readHintSeen(storage, 'flashcards')).toBe(false);
  });

  it('没有 storage（SSR）时当作没看过，且写入不抛错', () => {
    expect(readHintSeen(undefined, 'quiz')).toBe(false);
    expect(() => markHintSeen(undefined, 'quiz')).not.toThrow();
  });

  it('storage 抛错（隐私模式）时静默', () => {
    const broken = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
    };
    expect(readHintSeen(broken, 'quiz')).toBe(false);
    expect(() => markHintSeen(broken, 'quiz')).not.toThrow();
  });
});
