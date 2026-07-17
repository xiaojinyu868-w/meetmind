import { describe, expect, it } from 'vitest';
import { getWorkshopAppKeysForTier, WORKSHOP_APP_CATALOG } from './app-catalog';
import { COPY } from '@/lib/ui/copy';

describe('WORKSHOP_APP_CATALOG copy', () => {
  it('does not expose internal product jargon in app names or descriptions', () => {
    const catalogJargon = ['AI', '智能生成', '生图', '推荐图文结构'];

    for (const app of WORKSHOP_APP_CATALOG) {
      const visibleCopy = [
        app.name,
        app.category,
        app.headline,
        app.description,
        app.outputType,
        app.learningAction,
        app.bestFor,
        app.timeLabel,
        ...app.tags,
      ].join('\n');

      for (const word of [...COPY.bannedWords, ...catalogJargon]) {
        expect(visibleCopy.includes(word), `${app.key} contains banned word ${word}`).toBe(false);
      }
    }
  });

  it('explains the learning action, fit, and expected effort for every app', () => {
    for (const app of WORKSHOP_APP_CATALOG) {
      expect(app.learningAction.length).toBeGreaterThan(2);
      expect(app.bestFor.length).toBeGreaterThan(8);
      expect(app.timeLabel).toContain('约');
    }
  });

  it('keeps exam cheatsheets out of a single lesson', () => {
    expect(getWorkshopAppKeysForTier('class')).not.toContain('cheatsheet');
    expect(getWorkshopAppKeysForTier('unit')).toContain('cheatsheet');
    expect(getWorkshopAppKeysForTier('exam')).toContain('cheatsheet');
  });
});
