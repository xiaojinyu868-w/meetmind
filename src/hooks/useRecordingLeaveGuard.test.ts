import { describe, expect, it } from 'vitest';
import { isInAppNavigationClick } from './useRecordingLeaveGuard';

function anchor(href: string, attrs: Record<string, string> = {}): HTMLAnchorElement {
  const attributes = new Map(Object.entries({ href, ...attrs }));
  return {
    target: attrs.target || '',
    getAttribute: (name: string) => attributes.get(name) ?? null,
    hasAttribute: (name: string) => attributes.has(name),
  } as unknown as HTMLAnchorElement;
}

const currentHref = 'https://meetmind.example/app?tab=classroom';
const base = { currentHref, button: 0, hasModifier: false, defaultPrevented: false };

describe('isInAppNavigationClick', () => {
  it('站内另一条路径的普通左键点击才算离开', () => {
    expect(isInAppNavigationClick({ ...base, anchor: anchor('/pocket') })).toBe(true);
    expect(isInAppNavigationClick({ ...base, anchor: anchor('https://meetmind.example/settings') })).toBe(true);
  });

  it('同页锚点 / 只改 query 不算离开', () => {
    expect(isInAppNavigationClick({ ...base, anchor: anchor('#top') })).toBe(false);
    expect(isInAppNavigationClick({ ...base, anchor: anchor('/app?tab=record') })).toBe(false);
  });

  it('外链、新标签、下载、修饰键、已被处理的点击一律放过', () => {
    expect(isInAppNavigationClick({ ...base, anchor: anchor('https://example.com/x') })).toBe(false);
    expect(isInAppNavigationClick({ ...base, anchor: anchor('/pocket', { target: '_blank' }) })).toBe(false);
    expect(isInAppNavigationClick({ ...base, anchor: anchor('/file.pdf', { download: '' }) })).toBe(false);
    expect(isInAppNavigationClick({ ...base, anchor: anchor('/pocket'), hasModifier: true })).toBe(false);
    expect(isInAppNavigationClick({ ...base, anchor: anchor('/pocket'), button: 1 })).toBe(false);
    expect(isInAppNavigationClick({ ...base, anchor: anchor('/pocket'), defaultPrevented: true })).toBe(false);
    expect(isInAppNavigationClick({ ...base, anchor: anchor('mailto:a@b.c') })).toBe(false);
    expect(isInAppNavigationClick({ ...base, anchor: null })).toBe(false);
  });
});
