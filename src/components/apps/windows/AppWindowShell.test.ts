import { describe, expect, it } from 'vitest';
import { getAppWindowShellTone } from './app-window-shell-tone';

describe('AppWindowShell tone', () => {
  it('flashcards share the same paper shell as every other app (no dark immersive room)', () => {
    const flashcards = getAppWindowShellTone('flashcards');
    const quiz = getAppWindowShellTone('quiz');

    expect(flashcards).toEqual(quiz);
    expect(flashcards.root).toContain('bg-canvas');
    expect(flashcards.root).not.toContain('immersive');
    expect(flashcards.header).toContain('bg-white');
  });

  it('keeps the quiet canvas shell for regular apps', () => {
    const tone = getAppWindowShellTone('quiz');

    expect(tone.root).toContain('bg-canvas');
    expect(tone.header).toContain('bg-white');
  });
});
