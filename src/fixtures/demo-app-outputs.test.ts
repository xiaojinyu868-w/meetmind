import { describe, expect, it } from 'vitest';
import { DEMO_APP_PREVIEWS } from './demo-app-outputs';

describe('DEMO_APP_PREVIEWS', () => {
  it('keeps the classroom hero focused on in-class surfaces, not post-class flashcards or quiz', () => {
    const appKeys = DEMO_APP_PREVIEWS.map((preview) => preview.appKey);

    expect(appKeys).not.toContain('flashcards');
    expect(appKeys).not.toContain('quiz');
    expect(appKeys).toContain('cheatsheet');
    expect(appKeys).toContain('mindmap');
  });
});
