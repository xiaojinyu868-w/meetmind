import { expect, test, type Page } from '@playwright/test';

const COLLECTION_PLACEHOLDER = '发一句想法，贴个链接，或者先把这节课丢进来';

function buildChatSSE(payload: Record<string, unknown>): string {
  return [`data: ${JSON.stringify(payload)}`, '', 'data: [DONE]', ''].join('\n');
}

async function openGuestCollection(page: Page) {
  await page.goto('/app?guest=1');
  await page.getByPlaceholder(COLLECTION_PLACEHOLDER).waitFor({ state: 'visible' });
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
    await page.getByRole('button', { name: '更多操作：第一条：老师在讲导数和单调性。' }).click();
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
    await page.getByRole('button', { name: '更多操作：第一条：课堂原话。' }).click();
    await page.getByRole('button', { name: '选择' }).click();

    await page.getByRole('button', { name: '选择' }).nth(0).click();

    await expect(page.getByText('已选 2 条')).toBeVisible();
    await page.getByRole('button', { name: '引用' }).click();

    await expect(page.getByText('已引用 2 条内容')).toBeVisible();
    await expect(page.getByPlaceholder('继续顺着这几条内容写...')).toHaveValue('');
    await expect(page.getByText('第一条：课堂原话。 · 第二条：我补的困惑。')).toBeVisible();
  });

  test('desktop menu asks tutor once and sends selected context mode', async ({ page }) => {
    let tutorRequestCount = 0;
    let selectedContextMode = false;
    let supportContextText = '';

    await page.route('**/api/tutor', async (route) => {
      tutorRequestCount += 1;
      const body = JSON.parse(route.request().postData() || '{}');
      selectedContextMode = Boolean(body.selected_context_mode);
      const supportSegment = Array.isArray(body.segments)
        ? body.segments.find((segment: { id?: string; text?: string }) => segment.id === '__support_context__')
        : null;
      supportContextText = String(supportSegment?.text || '');

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
    await page.getByRole('button', { name: '更多操作：单条消息：我没串起讲义里的定义。' }).click();
    await page.getByRole('button', { name: '问 Tutor' }).click();

    await expect(page.getByText('这是 mock Tutor 回复。').first()).toBeVisible();
    expect(tutorRequestCount).toBe(1);
    expect(selectedContextMode).toBeTruthy();
    expect(supportContextText).toContain('以下是用户刚刚主动圈出来的上下文');
    expect(supportContextText).toContain('单条消息：我没串起讲义里的定义。');
  });

  test('desktop right click opens the same message menu', async ({ page }) => {
    await openGuestCollection(page);
    await sendQuickNote(page, '右键这条消息。');

    await page.getByText('右键这条消息。').first().click({ button: 'right' });
    await expect(page.getByRole('button', { name: '引用' })).toBeVisible();
    await expect(page.getByRole('button', { name: '问 Tutor' })).toBeVisible();
  });

  test('guest mode deletes a local message directly from the menu', async ({ page }) => {
    await openGuestCollection(page);
    await sendQuickNote(page, '这条消息待会要删掉。');

    await page.hover('text=这条消息待会要删掉。');
    await page.getByRole('button', { name: '更多操作：这条消息待会要删掉。' }).click();
    await page.getByRole('button', { name: '删除这条' }).click();

    await expect(page.getByText('这条消息待会要删掉。')).toHaveCount(0);
  });
});
