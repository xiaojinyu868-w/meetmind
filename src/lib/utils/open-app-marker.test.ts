import { describe, expect, it } from 'vitest';
import { extractOpenAppMarker, isInlineAppKey } from './open-app-marker';

describe('open app marker parsing', () => {
  it('extracts the first valid app marker and removes all markers from visible text', () => {
    const result = extractOpenAppMarker('我来整理。\n<open_app:cheatsheet/>\n<open_app:quiz/>');
    expect(result.key).toBe('cheatsheet');
    expect(result.cleaned).toBe('我来整理。');
  });

  it('recognizes only inline app keys supported by the compact chat renderer', () => {
    expect(isInlineAppKey('cheatsheet')).toBe(true);
    expect(isInlineAppKey('audio-overview')).toBe(false);
    expect(isInlineAppKey('unknown')).toBe(false);
  });
});
