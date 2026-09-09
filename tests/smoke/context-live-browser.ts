import assert from 'node:assert/strict';
import { sharedContextCopy } from '@/lib/ui/shared-context-copy';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { ContextClient, type ContextEventRecord, type ContextPrepareInput, type UserContextBundle } from '../../packages/context-sdk/src';
import { COPY } from '../../src/lib/ui/copy';

/** Exercise the real Context page and backend after the caller's event has finished processing. */
export async function verifyLiveContextBrowser(
  base: string,
  token: string,
  eventId: string,
  outputDir: string,
): Promise<{ desktop: string; mobile: string; evidence: string }> {
  const owner = new ContextClient({ baseUrl: `${base}/api/context/v1`, token });
  const { event } = await owner.source(eventId);
  assert.equal(event.visibility, 'active', 'browser_source_must_be_active');
  assert(event.content, 'browser_source_requires_original_content');
  const screenshots = {
    desktop: path.resolve(outputDir, 'context-live-desktop.png'),
    mobile: path.resolve(outputDir, 'context-live-mobile.png'),
    evidence: path.resolve(outputDir, 'context-live-evidence.png'),
  };
  await mkdir(path.resolve(outputDir), { recursive: true });
  const browser = await chromium.launch({ channel: process.env.SMOKE_BROWSER ?? 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1360, height: 1050 } });
  try {
    page.setDefaultTimeout(60_000);
    await page.addInitScript((accessToken: string) => {
      localStorage.setItem('meetmind_access_token', accessToken);
    }, token);
    await page.goto(`${base}/context`);
    const c = sharedContextCopy;
    await expect(page.getByRole('heading', { name: c.title, exact: true })).toBeVisible();
    await expect(page.getByTestId('context-portrait').locator('article').first()).toBeVisible({ timeout: 60_000 });
    if (event.spaceId !== 'personal') {
      await page.getByText(c.settings, { exact: true }).click();
      await page.getByLabel(c.space, { exact: true }).fill(event.spaceId);
      await page.getByRole('button', { name: c.spaceApply, exact: true }).click();
    }
    const task = '帮我安排一次条件概率练习，结合我先前对 P(A|B) 和 P(B|A) 的困惑。';
    await page.getByLabel(c.task, { exact: true }).fill(task);
    const [prepared] = await Promise.all([
      page.waitForResponse((response) => new URL(response.url()).pathname === '/api/context/v1/prepare'
        && response.request().method() === 'POST', { timeout: 120_000 }),
      page.getByRole('button', { name: c.prepare, exact: true }).click(),
    ]);
    assert.equal(prepared.status(), 200, 'browser_prepare_failed');
    const request = prepared.request().postDataJSON() as ContextPrepareInput;
    assert.equal(request.task.intent, task);
    assert.deepEqual(request.scope?.spaceIds, [event.spaceId]);
    const bundle = await prepared.json() as UserContextBundle;
    assert.equal(bundle.degraded, false, 'browser_prepare_must_use_live_memory');
    assert(bundle.memories.length > 0, 'browser_prepare_requires_derived_memories');
    const memoryIndex = bundle.memories.findIndex((memory) => memory.sourceEventIds.includes(eventId));
    assert(memoryIndex >= 0, 'browser_prepare_requires_expected_source');
    const memory = bundle.memories[memoryIndex];
    assert(memory.text.trim(), 'browser_memory_requires_text');
    const renderedBundle = page.getByTestId('context-task-result');
    await expect(renderedBundle.getByRole('heading', { name: c.memories, exact: true })).toBeVisible();
    await expect(page.getByText(c.degraded, { exact: true })).toHaveCount(0);
    await expect(page.getByText(c.noMemories, { exact: true })).toHaveCount(0);
    const renderedMemory = renderedBundle.locator('article').nth(memoryIndex);
    await expect(renderedMemory.locator('p').first()).toHaveText(memory.text);
    const sourceNumber = memory.sourceEventIds.indexOf(eventId) + 1;
    const [sourceResponse] = await Promise.all([
      page.waitForResponse((response) => new URL(response.url()).pathname === `/api/context/v1/sources/${eventId}`
        && response.request().method() === 'GET'),
      renderedMemory.getByRole('button', { name: `${c.sources} ${sourceNumber}`, exact: true }).click(),
    ]);
    assert.equal(sourceResponse.status(), 200, 'browser_source_read_failed');
    const inspected = await sourceResponse.json() as { event: ContextEventRecord };
    assert.equal(inspected.event.id, eventId);
    assert.equal(inspected.event.content, event.content, 'browser_source_must_preserve_original');
    const original = page.locator('aside[aria-live="polite"]');
    await expect(original.getByRole('button', { name: c.closeSource, exact: true })).toBeVisible();
    await expect(original.locator('p').last()).toHaveText(event.content);
    await page.screenshot({ path: screenshots.evidence });
    await original.getByRole('button', { name: c.closeSource, exact: true }).click();
    await page.screenshot({ path: screenshots.desktop, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'mobile_horizontal_overflow');
    await page.screenshot({ path: screenshots.mobile, fullPage: true });
    return screenshots;
  } catch (error) {
    await page.screenshot({ path: path.resolve(outputDir, 'context-browser-failure.png'), fullPage: true });
    throw error;
  } finally {
    await browser.close();
  }
}

/** Empty state uses the real paused account; degraded rendering uses an explicit response fixture. */
export async function verifyContextStates(base: string, token: string, outputDir: string): Promise<void> {
  const browser = await chromium.launch({ channel: process.env.SMOKE_BROWSER ?? 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.addInitScript((accessToken: string) => localStorage.setItem('meetmind_access_token', accessToken), token);
    await page.goto(`${base}/context`);
    await expect(page.getByText(sharedContextCopy.portraitEmpty, { exact: true })).toBeVisible({ timeout: 60_000 });
    await page.screenshot({ path: path.join(outputDir, 'context-empty-mobile.png') });
    await page.route('**/api/context/v1/prepare', (route) => route.fulfill({ json: {
      schemaVersion: 1, memories: [], observations: [], sources: [], text: '', contextVersion: 'explicit-ui-fixture',
      pendingEventIds: [], degraded: true, reason: 'backend_unavailable',
    } }));
    await page.getByRole('button', { name: sharedContextCopy.refresh, exact: true }).click();
    await expect(page.getByText(sharedContextCopy.degraded, { exact: true })).toBeVisible({ timeout: 60_000 });
    await page.screenshot({ path: path.join(outputDir, 'context-degraded-ui-fixture-mobile.png') });
  } finally { await browser.close(); }
}
