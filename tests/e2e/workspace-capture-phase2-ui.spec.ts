import { expect, test, type Page } from '@playwright/test';

const COLLECTION_PLACEHOLDER = '发一句想法，贴个链接，或者先把这节课丢进来';

type MockCapture = {
  id: string;
  sourceKey: string;
  sourceType: string;
  status: 'active' | 'archived' | 'deleted';
  role: string;
  contentType: string;
  title: string;
  previewText: string;
  normalizedText?: string | null;
  tutorContext?: string | null;
  sourceUrl?: string | null;
  mediaUrl?: string | null;
  occurredAt: string;
  createdAt: string;
  metadata?: Record<string, unknown> | null;
};

async function mockWorkspaceCaptureFlow(page: Page) {
  let captures: MockCapture[] = [
    {
      id: 'capture_text_today',
      sourceKey: 'manual:text-today',
      sourceType: 'manual-note',
      status: 'active',
      role: 'support',
      contentType: 'text',
      title: '今天的研究灵感',
      previewText: '今天的研究灵感',
      normalizedText: '今天的研究灵感',
      tutorContext: '今天的研究灵感',
      occurredAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      metadata: null,
    },
    {
      id: 'capture_video_recent',
      sourceKey: 'manual:video-recent',
      sourceType: 'manual-video',
      status: 'active',
      role: 'support',
      contentType: 'video',
      title: '最近的视频摘录',
      previewText: '这段视频是 3 天前收进来的，适合验证最近筛选。',
      normalizedText: '这段视频是 3 天前收进来的，适合验证最近筛选。',
      tutorContext: '这段视频是 3 天前收进来的，适合验证最近筛选。',
      occurredAt: new Date(Date.now() - 3 * 24 * 3600_000).toISOString(),
      createdAt: new Date(Date.now() - 3 * 24 * 3600_000).toISOString(),
      metadata: null,
    },
    {
      id: 'capture_document_earlier',
      sourceKey: 'manual:document-earlier',
      sourceType: 'manual-document',
      status: 'active',
      role: 'support',
      contentType: 'document',
      title: '更早的讲义',
      previewText: '这份讲义里有一个很适合回头整理的结构。',
      normalizedText: null,
      tutorContext: null,
      occurredAt: new Date(Date.now() - 10 * 24 * 3600_000).toISOString(),
      createdAt: new Date(Date.now() - 10 * 24 * 3600_000).toISOString(),
      metadata: null,
    },
    {
      id: 'capture_link_archived',
      sourceKey: 'manual:link-archived',
      sourceType: 'manual-link',
      status: 'archived',
      role: 'support',
      contentType: 'link',
      title: '旧的链接灵感',
      previewText: '这是之前先移出去的一条链接收集。',
      normalizedText: null,
      tutorContext: null,
      sourceUrl: 'https://example.com/archived-link',
      occurredAt: new Date(Date.now() - 3600_000).toISOString(),
      createdAt: new Date(Date.now() - 3600_000).toISOString(),
      metadata: null,
    },
  ];

  await page.addInitScript(() => {
    window.localStorage.setItem('analytics_visited', String(Date.now()));
    window.localStorage.setItem('meetmind_access_token', 'workspace-capture-phase2-token');
  });

  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        user: {
          id: 'user_capture_phase2',
          username: 'capture_phase2',
          nickname: 'Capture Phase2',
          role: 'student',
          status: 'active',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        permissions: [],
      }),
    });
  });

  await page.route('**/api/analytics', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true }),
    });
  });

  await page.route('**/api/workspace/current*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        workspace: {
          id: 'workspace_capture_phase2',
          name: '默认工作区',
          slug: null,
          kind: 'personal',
          status: 'active',
          ownerId: 'user_capture_phase2',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        captures,
        echoes: [],
      }),
    });
  });

  await page.route('**/api/workspace/captures', async (route) => {
    const method = route.request().method();

    if (method === 'POST') {
      const body = JSON.parse(route.request().postData() || '{}');
      const next: MockCapture = {
        id: `capture_created_${captures.length + 1}`,
        sourceKey: body.sourceKey,
        sourceType: body.sourceType,
        status: 'active',
        role: body.role,
        contentType: body.contentType,
        title: body.title,
        previewText: body.previewText || body.title,
        normalizedText: body.normalizedText || body.previewText || body.title,
        tutorContext: body.tutorContext || body.normalizedText || body.previewText || body.title,
        sourceUrl: body.sourceUrl || null,
        mediaUrl: body.mediaUrl || null,
        occurredAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        metadata: body.metadata || null,
      };
      captures = [next, ...captures];

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          workspace: {
            id: 'workspace_capture_phase2',
            name: '默认工作区',
          },
          capture: next,
          echoQueued: false,
          echoPending: false,
          echoAlreadyGeneratedToday: false,
        }),
      });
      return;
    }

    if (method === 'PATCH') {
      const body = JSON.parse(route.request().postData() || '{}');
      const index = captures.findIndex(
        (item) => item.id === body.captureId || item.sourceKey === body.sourceKey
      );

      if (index < 0) {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, error: '未找到这条收集' }),
        });
        return;
      }

      const current = captures[index];
      const next =
        body.action === 'restore'
          ? { ...current, status: 'active' as const }
          : body.action === 'archive'
            ? { ...current, status: 'archived' as const }
            : body.action === 'update'
              ? {
                  ...current,
                  title: body.title ?? current.title,
                  previewText: body.previewText ?? current.previewText,
                  normalizedText: body.normalizedText ?? current.normalizedText,
                  tutorContext: body.tutorContext ?? current.tutorContext,
                }
              : current;

      captures = captures.map((item, itemIndex) => (itemIndex === index ? next : item));

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          capture: next,
          retiredEchoIds: [],
        }),
      });
      return;
    }

    if (method === 'DELETE') {
      const body = JSON.parse(route.request().postData() || '{}');
      const index = captures.findIndex(
        (item) => item.id === body.captureId || item.sourceKey === body.sourceKey
      );

      if (index < 0) {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, error: '未找到这条收集' }),
        });
        return;
      }

      const next = { ...captures[index], status: 'deleted' as const };
      captures = captures.map((item, itemIndex) => (itemIndex === index ? next : item));

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          capture: next,
          retiredEchoIds: [],
        }),
      });
      return;
    }

    await route.continue();
  });
}

async function openAllCollections(page: Page) {
  await page.goto('/app?mobile=1');
  await page.getByPlaceholder(COLLECTION_PLACEHOLDER).waitFor({ state: 'visible' });
  await page.getByRole('button', { name: '打开收集菜单' }).click();
  await page.getByRole('button', { name: '全部收集' }).click();
}

test.describe('workspace capture phase2 ui', () => {
  test('supports searching archived captures, time filters, and restoring them into the current flow', async ({ page }) => {
    await mockWorkspaceCaptureFlow(page);
    await openAllCollections(page);
    const panel = page.getByTestId('workspace-capture-list');

    await panel.getByRole('button', { name: '筛选' }).click();
    await panel.getByRole('button', { name: '最近', exact: true }).click();
    await expect(panel.getByText('最近的视频摘录').first()).toBeVisible();
    await expect(panel.getByText('今天的研究灵感')).toHaveCount(0);

    await panel.getByRole('button', { name: '更早', exact: true }).click();
    await expect(panel.getByText('更早的讲义')).toBeVisible();
    await expect(panel.getByText('最近的视频摘录')).toHaveCount(0);

    await panel.getByRole('button', { name: '全部时间', exact: true }).click();
    await panel.getByRole('button', { name: /已移除/ }).click();
    await expect(panel.getByText('旧的链接灵感')).toBeVisible();

    await panel.getByLabel('搜索收集内容').fill('链接灵感');
    await expect(panel.getByText('旧的链接灵感')).toBeVisible();

    await panel.getByRole('button', { name: '更多操作：旧的链接灵感' }).click();
    await panel.getByRole('button', { name: '恢复到当前流' }).click();

    await panel.getByRole('button', { name: /当前流/ }).click();
    await panel.getByRole('button', { name: '全部时间', exact: true }).click();
    await panel.getByLabel('搜索收集内容').fill('');
    await expect(panel.getByText('旧的链接灵感').last()).toBeVisible();
  });

  test('opens capture editor from all captures and saves updated text', async ({ page }) => {
    await mockWorkspaceCaptureFlow(page);
    await openAllCollections(page);
    const panel = page.getByTestId('workspace-capture-list');

    await expect(panel.getByText('今天的研究灵感').first()).toBeVisible();
    await panel.getByRole('button', { name: '更多操作：今天的研究灵感' }).click();
    await panel.getByRole('button', { name: '编辑文字' }).click();

    await page.getByLabel('收集正文').fill('更新后的研究灵感正文');
    await page.getByRole('button', { name: '保存' }).click();

    await expect(page.getByText('更新后的研究灵感正文').first()).toBeVisible();
  });

  test('supports editing title and note for non-text captures', async ({ page }) => {
    await mockWorkspaceCaptureFlow(page);
    await openAllCollections(page);
    const panel = page.getByTestId('workspace-capture-list');

    await panel.getByRole('button', { name: '筛选' }).click();
    await panel.getByRole('button', { name: '更早', exact: true }).click();
    await panel.getByRole('button', { name: '更多操作：更早的讲义' }).click();
    await panel.getByRole('button', { name: '编辑标题/备注' }).click();

    await page.getByLabel('收集标题').fill('整理过的讲义标题');
    await page.getByLabel('收集备注').fill('这份讲义后来补了一个更清楚的备注。');
    await page.getByRole('button', { name: '保存' }).click();

    await expect(page.getByText('整理过的讲义标题').first()).toBeVisible();
    await expect(page.getByText('这份讲义后来补了一个更清楚的备注。')).toBeVisible();
  });

  test('guest local captures appear in all collections immediately', async ({ page }) => {
    await page.goto('/app?guest=1&mobile=1');
    await page.getByPlaceholder(COLLECTION_PLACEHOLDER).waitFor({ state: 'visible' });

    await page.getByPlaceholder(COLLECTION_PLACEHOLDER).fill('这条是刚刚记下来的本地收集');
    await page.getByRole('button', { name: '发送到收集流' }).click();

    await page.getByRole('button', { name: '打开收集菜单' }).click();
    await page.getByRole('button', { name: '全部收集' }).click();

    const panel = page.getByTestId('workspace-capture-list');
    await expect(panel.getByText('这条是刚刚记下来的本地收集').first()).toBeVisible();
  });

  test('multi-select supports batch remove and destructive delete confirmation', async ({ page }) => {
    await page.goto('/app?guest=1');
    await page.getByPlaceholder(COLLECTION_PLACEHOLDER).waitFor({ state: 'visible' });

    await page.getByPlaceholder(COLLECTION_PLACEHOLDER).fill('第一条待批量处理');
    await page.getByRole('button', { name: '发送到收集流' }).click();
    await page.getByPlaceholder(COLLECTION_PLACEHOLDER).fill('第二条待批量处理');
    await page.getByRole('button', { name: '发送到收集流' }).click();

    await expect(page.getByText('第一条待批量处理')).toBeVisible();
    await expect(page.getByText('第二条待批量处理')).toBeVisible();

    await page.getByRole('button', { name: '更多操作：第一条待批量处理' }).click();
    await page.getByRole('button', { name: '选择' }).click();
    await page.getByRole('button', { name: '选择' }).click();

    await expect(page.getByText('已选 2 条')).toBeVisible();
    await page.getByRole('button', { name: '移除' }).click();
    await expect(page.getByText('第一条待批量处理')).toHaveCount(0);
    await expect(page.getByText('第二条待批量处理')).toHaveCount(0);

    await page.getByPlaceholder(COLLECTION_PLACEHOLDER).fill('第三条待彻底删除');
    await page.getByRole('button', { name: '发送到收集流' }).click();
    await page.getByPlaceholder(COLLECTION_PLACEHOLDER).fill('第四条待彻底删除');
    await page.getByRole('button', { name: '发送到收集流' }).click();

    await page.getByRole('button', { name: '更多操作：第三条待彻底删除' }).click();
    await page.getByRole('button', { name: '选择' }).click();
    await page.getByRole('button', { name: '选择' }).click();

    await page.getByRole('button', { name: '删除' }).click();
    await expect(page.getByRole('button', { name: '确认删除' })).toBeVisible();
    await page.getByRole('button', { name: '确认删除' }).click();
    await expect(page.getByText('第三条待彻底删除')).toHaveCount(0);
    await expect(page.getByText('第四条待彻底删除')).toHaveCount(0);
  });
});
