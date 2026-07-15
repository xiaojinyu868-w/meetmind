import { describe, expect, it } from 'vitest';
import { recommendWorkshopApp } from './workshop-recommendation';

describe('recommendWorkshopApp', () => {
  it('prioritizes an explicit learner mark over inferred content density', () => {
    expect(recommendWorkshopApp({ activeAnchorCount: 2, difficultyCount: 3, segmentCount: 80 }).key)
      .toBe('quiz');
  });

  it('uses known difficulties to favor active recall', () => {
    expect(recommendWorkshopApp({ activeAnchorCount: 0, difficultyCount: 2, segmentCount: 10 }).key)
      .toBe('flashcards');
  });

  it('uses a structure view for long classes and stays neutral without a real signal', () => {
    expect(recommendWorkshopApp({ activeAnchorCount: 0, difficultyCount: 0, segmentCount: 30 }).key)
      .toBe('mindmap');
    expect(recommendWorkshopApp({ activeAnchorCount: 0, difficultyCount: 0, segmentCount: 8 }).key)
      .toBeNull();
  });
});
