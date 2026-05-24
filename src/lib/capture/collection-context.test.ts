import { describe, expect, it } from 'vitest';
import { getCollectionContextDisplayTitle, getCollectionContextTypeLabel } from './collection-context';

describe('collection context copy', () => {
  it('uses student-facing labels for audio context', () => {
    expect(getCollectionContextTypeLabel('audio')).toBe('录音');
    expect(
      getCollectionContextDisplayTitle(
        { type: 'audio', title: '录音 12:34' },
        20,
      ),
    ).toBe('一段录音');
  });
});
