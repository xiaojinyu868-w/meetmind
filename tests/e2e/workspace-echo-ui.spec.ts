import { expect, test, type Page } from '@playwright/test';

const COLLECTION_PLACEHOLDER = '发一句想法，贴个链接，或者先把这节课丢进来';
const MANUAL_TRIGGER_ENABLED =
  process.env.NODE_ENV !== 'production' ||
  process.env.NEXT_PUBLIC_ENABLE_ECHO_MANUAL_TRIGGER === 'true';

type MockWorkspaceEchoFlowOptions = {
  authenticated?: boolean;
  captureStatus?: {
    echoQueued: boolean;
    echoPending: boolean;
    echoAlreadyGeneratedToday: boolean;
  };
  refreshDelayMs?: number;
  refreshEchoes?: Array<{
    id: string;
    sourceKey: string;
    kind: string;
    generatedDateKey: string;
    title: string;
    body: string;
    chips: string[];
    createdAt: string;
    updatedAt: string;
  }>;
};

async function mockWorkspaceEchoFlow(page: Page, options: MockWorkspaceEchoFlowOptions = {}) {
  let captureCount = 0;
  let refreshCount = 0;
  const authenticated = options.authenticated ?? true;
  const refreshDelayMs = options.refreshDelayMs || 0;
  const captureStatus = options.captureStatus || {
    echoQueued: true,
    echoPending: false,
    echoAlreadyGeneratedToday: false,
  };
  const refreshEchoes = options.refreshEchoes || [
    {
      id: 'echo_daily',
      sourceKey: 'daily:workspace_echo_ui:2026-03-14',
      kind: 'daily_return_reason',
      generatedDateKey: '2026-03-14',
      title: '单调性这条线已经冒头了',
      body: '你把课堂原话和卡住的位置放到了一起，顺着这点再补一句，今天就能更快看出它们怎么连上。',
      chips: ['课堂原声', '带着问题'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'echo_daily',
      sourceKey: 'daily:workspace_echo_ui:2026-03-14',
      kind: 'daily_return_reason',
      generatedDateKey: '2026-03-14',
      title: '别急着总结，先把转折点收全',
      body: '现在最值钱的不是结论，而是你卡住时那一下转折感，再补一小段，回头会更容易复盘。',
      chips: ['课堂原声', '同一条线索'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  await page.addInitScript(() => {
    window.localStorage.setItem('analytics_visited', String(Date.now()));
  });

  if (authenticated) {
    await page.addInitScript(() => {
      window.localStorage.setItem('meetmind_access_token', 'ui-smoke-token');
    });
  }

  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        user: {
          id: 'user_echo_ui',
          username: 'echo_ui',
          nickname: 'Echo UI',
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
      body: JSON.stringify({ success: true, data: null }),
    });
  });

  await page.route('**/api/workspace/current', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        workspace: {
          id: 'workspace_echo_ui',
          name: '默认工作区',
          slug: null,
          kind: 'personal',
          status: 'active',
          ownerId: 'user_echo_ui',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        captures: [],
        echoes: [],
      }),
    });
  });

  await page.route('**/api/workspace/captures', async (route) => {
    captureCount += 1;
    const body = JSON.parse(route.request().postData() || '{}');

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        workspace: {
          id: 'workspace_echo_ui',
          name: '默认工作区',
        },
        capture: {
          id: `capture_${captureCount}`,
          sourceKey: body.sourceKey,
          sourceType: body.sourceType,
          role: body.role,
          contentType: body.contentType,
          title: body.title,
          previewText: body.previewText || body.title,
          normalizedText: body.normalizedText || body.previewText || body.title,
          tutorContext: body.tutorContext || body.normalizedText || body.previewText || body.title,
          occurredAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        },
        echoQueued: captureStatus.echoQueued,
        echoPending: captureStatus.echoPending,
        echoAlreadyGeneratedToday: captureStatus.echoAlreadyGeneratedToday,
      }),
    });
  });

  await page.route('**/api/workspace/echoes/daily-refresh', async (route) => {
    refreshCount += 1;
    const requestBody = JSON.parse(route.request().postData() || '{}');
    const force = Boolean(requestBody.force);
    const echo = refreshEchoes[Math.min(refreshCount - 1, refreshEchoes.length - 1)];

    if (refreshDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, refreshDelayMs));
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        skipped: false,
        forced: force,
        reason: null,
        echo,
        debug: force
          ? {
              model: 'google/gemini-3-flash',
              promptVersion: 'echo-v1',
              todayCaptureCount: 1,
              recentCaptureCount: 0,
              recentEchoCount: 0,
              similarityToRecent: 0.12,
            }
          : undefined,
      }),
    });
  });

  return {
    getCaptureCount: () => captureCount,
    getRefreshCount: () => refreshCount,
  };
}

async function openEmptyEchoCenter(page: Page) {
  await page.goto('/app?mobile=1');
  await page.getByPlaceholder(COLLECTION_PLACEHOLDER).waitFor({ state: 'visible' });
  await page.getByRole('button', { name: '打开收集菜单' }).click();
  await page.getByRole('button', { name: '回声' }).click();
}

async function openGuestEmptyEchoCenter(page: Page) {
  await page.goto('/app?mobile=1&guest=1');
  await page.getByPlaceholder(COLLECTION_PLACEHOLDER).waitFor({ state: 'visible' });
  await page.getByRole('button', { name: '打开收集菜单' }).click();
  await page.getByRole('button', { name: '回声' }).click();
}

async function openEchoCenterAfterCapture(page: Page) {
  await page.goto('/app?mobile=1');
  await page.getByPlaceholder(COLLECTION_PLACEHOLDER).waitFor({ state: 'visible' });
  await page
    .getByPlaceholder(COLLECTION_PLACEHOLDER)
    .fill('老师这里开始讲单调性和导数的关系，我还卡在为什么导数符号可以直接推出区间变化。');
  await page.getByRole('button', { name: '发送到收集流' }).click();

  await page.getByRole('button', { name: '打开收集菜单' }).click();
  await page.getByRole('button', { name: '回声' }).click();
}

test.describe('workspace echo ui', () => {
  test('shows today echo after sending one capture', async ({ page }) => {
    const counters = await mockWorkspaceEchoFlow(page);

    await openEchoCenterAfterCapture(page);

    await expect(page.getByText('今日回声')).toBeVisible();
    await expect(page.getByText('单调性这条线已经冒头了').first()).toBeVisible();
    await expect(page.getByText('你把课堂原话和卡住的位置放到了一起，顺着这点再补一句，今天就能更快看出它们怎么连上。').first()).toBeVisible();
    await expect(page.getByText('先继续收集，系统听到的线索会慢慢沉到这里。')).toHaveCount(0);
    await expect(page.getByText('回声历史')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '继续收这一条' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: '问 Tutor' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: '去复习' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: '继续录音' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '写一句想法' })).toHaveCount(0);

    expect(counters.getCaptureCount()).toBe(1);
    expect(counters.getRefreshCount()).toBe(1);
  });

  test('hydrates the existing daily echo after capture when today already has one', async ({ page }) => {
    const counters = await mockWorkspaceEchoFlow(page, {
      captureStatus: {
        echoQueued: false,
        echoPending: false,
        echoAlreadyGeneratedToday: true,
      },
    });

    await openEchoCenterAfterCapture(page);

    await expect(page.getByText('今日回声')).toBeVisible();
    await expect(page.getByText('单调性这条线已经冒头了').first()).toBeVisible();

    expect(counters.getCaptureCount()).toBe(1);
    expect(counters.getRefreshCount()).toBe(1);
  });

  test.skip(!MANUAL_TRIGGER_ENABLED, 'requires NEXT_PUBLIC_ENABLE_ECHO_MANUAL_TRIGGER=true');
  test('manual trigger explains guest mode immediately when user is not logged in', async ({ page }) => {
    const counters = await mockWorkspaceEchoFlow(page, {
      authenticated: false,
      captureStatus: {
        echoQueued: false,
        echoPending: false,
        echoAlreadyGeneratedToday: false,
      },
    });

    await openGuestEmptyEchoCenter(page);

    await expect(page.getByRole('button', { name: '登录后测试' })).toBeVisible();
    await page.getByRole('button', { name: '登录后测试' }).click();

    await expect(page.getByRole('status').getByText('游客模式下不能直接测回声')).toBeVisible();
    await expect(page.getByRole('status').getByText('先登录，再在工作区里触发。')).toBeVisible();

    expect(counters.getCaptureCount()).toBe(0);
    expect(counters.getRefreshCount()).toBe(0);
  });

  test('manual trigger shows immediate pending feedback in the empty state', async ({ page }) => {
    const counters = await mockWorkspaceEchoFlow(page, {
      captureStatus: {
        echoQueued: false,
        echoPending: false,
        echoAlreadyGeneratedToday: false,
      },
      refreshDelayMs: 900,
    });

    await openEmptyEchoCenter(page);

    await expect(page.getByRole('button', { name: '测试生成' })).toBeVisible();
    await page.getByRole('button', { name: '测试生成' }).click();

    await expect(page.getByText('正在生成今日回声', { exact: true })).toBeVisible();
    await expect(page.getByText('测试请求已发出，你可以继续收集。')).toBeVisible();
    await expect(page.getByRole('button', { name: '生成中...' })).toBeVisible();
    await expect(page.getByText('单调性这条线已经冒头了').first()).toBeVisible();

    expect(counters.getCaptureCount()).toBe(0);
    expect(counters.getRefreshCount()).toBe(1);
  });

  test('manual trigger overwrites the same daily echo and shows debug note', async ({ page }) => {
    const counters = await mockWorkspaceEchoFlow(page);

    await openEchoCenterAfterCapture(page);

    await expect(page.getByRole('button', { name: '测试生成' })).toBeVisible();
    await page.getByRole('button', { name: '测试生成' }).click();

    await expect(page.getByText('别急着总结，先把转折点收全').first()).toBeVisible();
    await expect(page.getByText('查看测试信息')).toBeVisible();
    await page.getByText('查看测试信息').click();
    await expect(page.getByText('模型：google/gemini-3-flash')).toBeVisible();
    await expect(page.getByText('Prompt：echo-v1')).toBeVisible();
    await expect(page.getByText('重复度：0.12')).toBeVisible();
    await expect(page.getByText('回声历史')).toHaveCount(0);

    expect(counters.getCaptureCount()).toBe(1);
    expect(counters.getRefreshCount()).toBe(2);
  });
});
