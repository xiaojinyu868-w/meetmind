import { describe, expect, it } from 'vitest';
import { getAppWindowShellTone } from './app-window-shell-tone';

describe('AppWindowShell tone', () => {
  it('uses a low-luminance immersive shell for flashcards so the practice page is not a white glare field', () => {
    const tone = getAppWindowShellTone('flashcards');

    expect(tone.root).toContain('bg-[#11110F]');
    expect(tone.header).toContain('bg-[#151411]');
    expect(tone.main).toContain('min-h-[calc(100vh-64px)]');
  });

  it('keeps the quiet canvas shell for regular apps', () => {
    const tone = getAppWindowShellTone('quiz');

    expect(tone.root).toContain('bg-canvas');
    expect(tone.header).toContain('bg-white');
  });
});
