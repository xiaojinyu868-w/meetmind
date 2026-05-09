import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function readProjectFile(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('service worker retirement policy', () => {
  it('does not register a new service worker from the app shell', () => {
    const source = readProjectFile('src/components/ServiceWorkerRegister.tsx');
    expect(source).not.toContain(".register('/sw.js')");
    expect(source).toContain('registration.unregister()');
  });

  it('does not serve the offline fallback for navigations anymore', () => {
    const source = readProjectFile('public/sw.js');
    expect(source).toContain('self.registration.unregister()');
    expect(source).not.toContain('caches.match(OFFLINE_URL)');
  });

  it('keeps sw.js uncached at the nginx edge', () => {
    const source = readProjectFile('nginx-capture.conf');
    expect(source).toContain('location = /sw.js');
    expect(source).toContain('Cache-Control "no-cache, no-store, must-revalidate"');
  });

  it('ships a concrete favicon.ico so old service workers do not fetch a redirect', () => {
    expect(fs.existsSync(path.join(root, 'public/favicon.ico'))).toBe(true);
  });
});
