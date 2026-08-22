import { describe, expect, it, vi } from 'vitest';
import { DEMO_SESSION_ID } from '@/fixtures/demo-data';
import {
  buildGuestDemoFlashcardsResult,
  isDemoEntryConsumed,
  isGuestDemoFlashcardsResult,
  markDemoEntryConsumed,
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

  it('stops auto-loading the demo once the entry has been consumed', () => {
    // node 环境没有 window/sessionStorage：标记是 no-op，入口保持有效
    expect(isDemoEntryConsumed()).toBe(false);
    markDemoEntryConsumed();
    expect(isDemoEntryConsumed()).toBe(false);

    // 有 sessionStorage 的环境：消费后 entry=demo 不再自动灌入示例课
    const store = new Map<string, string>();
    vi.stubGlobal('window', {
      sessionStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => { store.set(key, value); },
      },
    });
    expect(resolveGuestDemoEntry({ isGuestFastEntry: true, entry: 'demo' }).autoLoadDemo).toBe(true);
    markDemoEntryConsumed();
    expect(isDemoEntryConsumed()).toBe(true);
    expect(resolveGuestDemoEntry({ isGuestFastEntry: true, entry: 'demo' }).autoLoadDemo).toBe(false);
    vi.unstubAllGlobals();
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
