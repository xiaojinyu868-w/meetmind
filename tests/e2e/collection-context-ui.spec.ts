import { expect, test, type Page } from '@playwright/test';

const COLLECTION_PLACEHOLDER = '发一句想法，贴个链接，或者先把这节课丢进来';
const SELECTED_CONTEXT_TUTOR_PLACEHOLDER = '继续顺着这几条内容问...';

function buildChatSSE(payload: Record<string, unknown>): string {
  return [
    `data: ${JSON.stringify(payload)}`,
    '',
    'data: [DONE]',
    '',
  ].join('\n');
}

async function openGuestCollection(page: Page) {
  await page.goto('/app?mobile=1&guest=1');
  await page.getByPlaceholder(COLLECTION_PLACEHOLDER).waitFor({ state: 'visible' });
}

async function sendQuickNote(page: Page, text: string) {
  await page.getByPlaceholder(COLLECTION_PLACEHOLDER).fill(text);
  await page.getByRole('button', { name: '发送到收集流' }).click();
  await expect(page.getByText(text).first()).toBeVisible();
}

test.describe('collection context selection ui', () => {
  test('supports quoting and asks tutor only once for a single collection item', async ({ page }) => {
    let lastTutorSupportText = '';
    let tutorRequestCount = 0;
    let selectedContextMode = false;

    await page.route('**/api/tutor', async (route) => {
      tutorRequestCount += 1;
      const body = JSON.parse(route.request().postData() || '{}');
      selectedContextMode = Boolean(body.selected_context_mode);
      const supportSegment = Array.isArray(body.segments)
        ? body.segments.find((segment: { id?: string; text?: string }) => segment.id === '__support_context__')
        : null;
      lastTutorSupportText = String(supportSegment?.text || '');

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
    await sendQuickNote(page, '第一条：老师讲导数和单调性。');
    await sendQuickNote(page, '第二条：讲义里的定义我没串起来。');

    await page.getByRole('button', { name: '引用这条：第一条：老师讲导数和单调性。' }).click();
    await expect(page.getByPlaceholder(COLLECTION_PLACEHOLDER)).toHaveValue(/我想顺着这条继续记：/);
    await expect(page.getByPlaceholder(COLLECTION_PLACEHOLDER)).toHaveValue(/第一条：老师讲导数和单调性。/);

    await page.getByRole('button', { name: '顺着这条问 Tutor：第二条：讲义里的定义我没串起来。' }).click();
    await page.getByPlaceholder(SELECTED_CONTEXT_TUTOR_PLACEHOLDER).waitFor({ state: 'visible' });
    await expect(page.getByText(/顺着这条文字继续帮我讲清楚/).first()).toBeVisible();
    await expect(page.getByText('这是 mock Tutor 回复。').first()).toBeVisible();
    expect(tutorRequestCount).toBe(1);
    expect(selectedContextMode).toBeTruthy();
    expect(lastTutorSupportText).toContain('以下是用户刚刚主动圈出来的上下文');
    expect(lastTutorSupportText).toContain('【这次主要内容｜文字】第二条：讲义里的定义我没串起来。');
  });

  test('keeps multi-select lightweight and asks tutor only once', async ({ page }) => {
    let lastTutorSupportText = '';
    let tutorRequestCount = 0;
    let selectedContextMode = false;

    await page.route('**/api/tutor', async (route) => {
      tutorRequestCount += 1;
      const body = JSON.parse(route.request().postData() || '{}');
      selectedContextMode = Boolean(body.selected_context_mode);
      const supportSegment = Array.isArray(body.segments)
        ? body.segments.find((segment: { id?: string; text?: string }) => segment.id === '__support_context__')
        : null;
      lastTutorSupportText = String(supportSegment?.text || '');

      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: buildChatSSE({
          type: 'content',
          content: '这是 multi-select Tutor 回复。',
        }),
      });
    });

    await openGuestCollection(page);
    await sendQuickNote(page, '第一条：课堂原话。');
    await sendQuickNote(page, '第二条：我补的困惑。');

    await page.getByRole('button', { name: '多选' }).click();
    await page.getByRole('button', { name: '选择' }).nth(0).click();
    await page.getByRole('button', { name: '选择' }).nth(0).click();

    await expect(page.getByText('已选 2 条')).toBeVisible();
    await expect(page.getByText('系统会自动抓住重点。')).toBeVisible();
    await expect(page.getByRole('button', { name: '设为主体' })).toHaveCount(0);

    await page.getByRole('button', { name: '一起引用' }).click();
    await expect(page.getByPlaceholder(COLLECTION_PLACEHOLDER)).toHaveValue(/我想把这几条一起带上，继续记：/);
    await expect(page.getByPlaceholder(COLLECTION_PLACEHOLDER)).toHaveValue(/第一条：课堂原话。/);
    await expect(page.getByPlaceholder(COLLECTION_PLACEHOLDER)).toHaveValue(/第二条：我补的困惑。/);

    await page.getByRole('button', { name: '多选' }).click();
    await page.getByRole('button', { name: '一起问 Tutor' }).click();
    await page.getByPlaceholder(SELECTED_CONTEXT_TUTOR_PLACEHOLDER).waitFor({ state: 'visible' });
    await expect(page.getByText(/我刚圈出这组内容，想顺着它们继续往下问/).first()).toBeVisible();
    await expect(page.getByText('这是 multi-select Tutor 回复。').first()).toBeVisible();
    expect(tutorRequestCount).toBe(1);
    expect(selectedContextMode).toBeTruthy();
    expect(lastTutorSupportText).toContain('以下是用户刚刚主动圈出来的上下文');
    expect(lastTutorSupportText).toContain('【这次主要内容｜文字】第二条：我补的困惑。');
    expect(lastTutorSupportText).toContain('1. [文字] 第一条：课堂原话。');
  });
});
