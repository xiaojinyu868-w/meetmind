import { expect, test, type Page } from '@playwright/test';

const COLLECTION_PLACEHOLDER = '发一句想法，贴个链接，或者先把这节课丢进来';

function buildChatSSE(payload: Record<string, unknown>): string {
  const content = String(payload.content || '');
  return [
    `data: ${JSON.stringify({ type: 'text-start', id: 'mock-text' })}`,
    '',
    `data: ${JSON.stringify({ type: 'text-delta', id: 'mock-text', delta: content })}`,
    '',
    `data: ${JSON.stringify({ type: 'text-end', id: 'mock-text' })}`,
    '',
    `data: ${JSON.stringify({ type: 'finish', finishReason: 'stop' })}`,
    '',
    'data: [DONE]',
    '',
  ].join('\n');
}

async function openGuestCollection(page: Page) {
  await page.goto('/app?guest=1');
  await page.getByRole('button', { name: '收集', exact: true }).first().click();
  await page.getByPlaceholder(COLLECTION_PLACEHOLDER).waitFor({ state: 'visible', timeout: 120_000 });
}

async function sendQuickNote(page: Page, text: string) {
  await page.getByPlaceholder(COLLECTION_PLACEHOLDER).fill(text);
  await page.getByRole('button', { name: '发送到收集流' }).click();
  await expect(page.getByText(text).first()).toBeVisible();
}

test.describe('collection context ui', () => {
  test('desktop more menu quotes one message without polluting the composer', async ({ page }) => {
    await openGuestCollection(page);
    await sendQuickNote(page, '第一条：老师在讲导数和单调性。');

    await page.hover(`text=第一条：老师在讲导数和单调性。`);
    await page.getByRole('button', { name: '操作：第一条：老师在讲导数和单调性。' }).click();
    await page.getByRole('button', { name: '引用' }).click();

    await expect(page.getByText('引用文字')).toBeVisible();
    await expect(page.getByText('第一条：老师在讲导数和单调性。').first()).toBeVisible();
    await expect(page.getByPlaceholder('继续顺着这条文字写...')).toHaveValue('');
  });

  test('desktop menu enters multi-select and multi-quote stays above the composer', async ({ page }) => {
    await openGuestCollection(page);
    await sendQuickNote(page, '第一条：课堂原话。');
    await sendQuickNote(page, '第二条：我补的困惑。');

    await page.hover(`text=第一条：课堂原话。`);
    await page.getByRole('button', { name: '操作：第一条：课堂原话。' }).click();
    await page.getByRole('button', { name: '选择' }).click();

    await page.getByRole('button', { name: '选择' }).nth(0).click();

    await expect(page.getByText('2 条', { exact: true })).toBeVisible();
    await expect(page.getByText('已加入这次操作')).toBeVisible();
    await page.getByRole('button', { name: '引用' }).click();

    await expect(page.getByText('已引用 2 条内容')).toBeVisible();
    await expect(page.getByPlaceholder('继续顺着这几条内容写...')).toHaveValue('');
    await expect(page.getByText('第一条：课堂原话。 · 第二条：我补的困惑。')).toBeVisible();
  });

  test('desktop menu asks tutor once and sends selected context mode', async ({ page }) => {
    let tutorRequestCount = 0;
    let selectedContextMode = false;
    let supportContextText = '';

    await page.route('**/api/tutor/agent', async (route) => {
      tutorRequestCount += 1;
      const body = JSON.parse(route.request().postData() || '{}');
      const supportMaterials = Array.isArray(body.context?.supportMaterials)
        ? body.context.supportMaterials
        : [];
      const selectedMaterial = supportMaterials.find(
        (material: { title?: string; content?: string }) => material.title === '当前选中的内容'
      );
      selectedContextMode = Boolean(selectedMaterial);
      supportContextText = String(selectedMaterial?.content || '');

      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: buildChatSSE({
          type: 'content',
          content: '这是 mock Tutor 回复。',
        }),
      });
    });

    await openGuestCollection(page);
    await sendQuickNote(page, '单条消息：我没串起讲义里的定义。');

    await page.hover(`text=单条消息：我没串起讲义里的定义。`);
    await page.getByRole('button', { name: '操作：单条消息：我没串起讲义里的定义。' }).click();
    await page.getByRole('button', { name: '问同学' }).click();

    await expect(page.getByText('这是 mock Tutor 回复。').first()).toBeVisible();
    expect(tutorRequestCount).toBe(1);
    expect(selectedContextMode).toBeTruthy();
    expect(supportContextText).toContain('单条消息：我没串起讲义里的定义。');
  });

  test('desktop right click opens the same message menu', async ({ page }) => {
    await openGuestCollection(page);
    await sendQuickNote(page, '右键这条消息。');

    await page.getByText('右键这条消息。').first().click({ button: 'right' });
    await expect(page.getByRole('button', { name: '引用' })).toBeVisible();
    await expect(page.getByRole('button', { name: '问同学' })).toBeVisible();
  });

  test('guest mode deletes a local message directly from the menu', async ({ page }) => {
    await openGuestCollection(page);
    await sendQuickNote(page, '这条消息待会要删掉。');

    await page.hover('text=这条消息待会要删掉。');
    await page.getByRole('button', { name: '操作：这条消息待会要删掉。' }).click();
    await page.getByRole('button', { name: '删除这条' }).click();

    await expect(page.getByText('这条消息待会要删掉。')).toHaveCount(0);
  });
});
