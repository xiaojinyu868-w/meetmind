import { describe, expect, it } from 'vitest';
import { WORKSHOP_APP_CATALOG } from './app-catalog';
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
        ...app.tags,
      ].join('\n');

      for (const word of [...COPY.bannedWords, ...catalogJargon]) {
        expect(visibleCopy.includes(word), `${app.key} contains banned word ${word}`).toBe(false);
      }
    }
  });
});
