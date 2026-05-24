import { describe, expect, it } from 'vitest';
import { DEMO_SESSION_ID } from '@/fixtures/demo-data';
import {
  buildGuestDemoFlashcardsResult,
  isGuestDemoFlashcardsResult,
  resolveGuestDemoEntry,
} from './guest-demo-entry';

describe('guest demo entry', () => {
  it('treats the explicit guest demo entry as classroom-first without auto-opening apps', () => {
    expect(resolveGuestDemoEntry({ isGuestFastEntry: true, entry: 'demo' })).toEqual({
      autoLoadDemo: true,
      autoOpenAppKey: undefined,
    });
    expect(resolveGuestDemoEntry({ isGuestFastEntry: true, entry: null })).toEqual({
      autoLoadDemo: false,
      autoOpenAppKey: undefined,
    });
    expect(resolveGuestDemoEntry({ isGuestFastEntry: false, entry: 'demo' })).toEqual({
      autoLoadDemo: false,
      autoOpenAppKey: undefined,
    });
  });

  it('builds a static flashcards result so first demo does not depend on network', () => {
    const result = buildGuestDemoFlashcardsResult();
    const payload = result.render?.payload as { cards?: Array<{ front: string; back: string }> };

    expect(result.pluginId).toBe('flashcards-lab');
    expect(result.render?.mode).toBe('flashcards');
    expect(result.trace).toContain(`session=${DEMO_SESSION_ID}`);
    expect(payload.cards?.length).toBeGreaterThanOrEqual(3);
    expect(payload.cards?.[0]?.front).toContain('up in the air');
  });

  it('recognizes only the static guest demo flashcards result', () => {
    const result = buildGuestDemoFlashcardsResult();

    expect(isGuestDemoFlashcardsResult(result)).toBe(true);
    expect(isGuestDemoFlashcardsResult({ ...result, version: 'inline-fallback-v1' })).toBe(false);
    expect(isGuestDemoFlashcardsResult({ ...result, pluginId: 'quiz-arena' })).toBe(false);
    expect(isGuestDemoFlashcardsResult({ ...result, trace: ['session=demo-session'] })).toBe(false);
    expect(isGuestDemoFlashcardsResult(null)).toBe(false);
  });
});
