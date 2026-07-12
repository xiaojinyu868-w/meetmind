import { expect, test } from '@playwright/test';

const COMPOSER = '发一句想法，贴个链接…';

test('mobile collection is newest-first and opens a deduplicated sourced article', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/article/import', async (route) => {
    const body = route.request().postDataJSON() as { url?: string };
    const articleText = [
      '这是用于验收移动端多来源阅读体验的公众号正文。'.repeat(12),
      '第二段用于确认正文可以直接打开，而不是停留在一张只有链接的卡片上。'.repeat(8),
    ].join('\n\n');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        title: '模拟公众号文章',
        text: articleText,
        author: '研究者甲',
        wordCount: articleText.length,
        imageUrls: [],
        source: {
          provider: 'wechat-article',
          providerLabel: '微信公众号',
          originalUrl: body.url,
          extractMethod: 'test-reader',
        },
        segments: articleText.split('\n\n').map((text, index) => ({
          id: `article-${index}`,
          text,
          startMs: index * 1000,
          endMs: (index + 1) * 1000,
          confidence: 1,
          isFinal: true,
        })),
      }),
    });
  });

  await page.goto('/app?guest=1');
  await page.getByRole('button', { name: /已有内容，进入/ }).click();
  const composer = page.getByPlaceholder(COMPOSER);

  for (const note of ['第一条旧笔记', '第二条中间笔记', '第三条最新笔记']) {
    await composer.fill(note);
    await composer.press('Enter');
  }

  const noteCards = await page.locator('button').filter({ hasText: '条' }).allTextContents();
  const orderedNotes = noteCards.filter((text) => /第一条|第二条|第三条/.test(text));
  expect(orderedNotes).toHaveLength(3);
  expect(orderedNotes[0]).toContain('第三条最新笔记');
  expect(orderedNotes[1]).toContain('第二条中间笔记');
  expect(orderedNotes[2]).toContain('第一条旧笔记');

  const firstUrl = 'https://mp.weixin.qq.com/s/mock-article?__biz=meetmind&utm_source=first';
  await composer.fill(firstUrl);
  await composer.press('Enter');
  await expect(page.getByText('微信公众号 · 研究者甲')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('正文完整')).toBeVisible();

  const duplicateUrl = 'https://mp.weixin.qq.com/s/mock-article?__biz=meetmind&utm_source=second';
  await composer.fill(duplicateUrl);
  await composer.press('Enter');
  await expect(page.getByRole('button', { name: /模拟公众号文章/ })).toHaveCount(1);

  await page.getByRole('button', { name: /模拟公众号文章/ }).click();
  await expect(page.getByRole('heading', { name: '模拟公众号文章' })).toBeVisible();
  await expect(page.getByText('查看原文')).toBeVisible();
  await expect(page.getByText(/这是用于验收移动端多来源阅读体验/)).toBeVisible();
});
