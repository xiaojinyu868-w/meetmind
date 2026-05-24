import { describe, expect, it } from 'vitest';
import { createTutorTools } from './tutor-tools';

describe('createTutorTools', () => {
  it('does not expose native tools in in-class mode because classroom uses open_app markers for light products', () => {
    const tools = createTutorTools({
      sessionId: 's-1',
      transcript: [],
      mode: 'in-class',
    });

    expect(Object.keys(tools)).toEqual([]);
  });

  it('keeps native tools available in review mode', () => {
    const tools = createTutorTools({
      sessionId: 's-1',
      transcript: [],
      mode: 'review',
    });

    expect(Object.keys(tools).sort()).toEqual([
      'lookupTranscript',
      'makeCheatsheet',
      'makeFlashcards',
      'makeMindmap',
      'makeQuiz',
      'makeStudyReport',
    ].sort());
  });
});
