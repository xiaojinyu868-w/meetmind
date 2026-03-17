import { expect, Page, test } from '@playwright/test';

const MOCK_CATALOG = {
  apps: [
    {
      key: 'flashcards',
      name: '闪卡训练',
      category: '记忆训练',
      headline: '主动回忆闪卡训练器',
      description: '围绕课堂重点生成训练闪卡，支持翻面与掌握度打分。',
      tags: ['主动回忆', '间隔复习', '训练'],
      coverImage: '/images/apps/flashcards-cover.svg',
      pluginId: 'flashcards-lab',
      intent: '生成课堂闪卡训练，帮助学生主动回忆并巩固核心知识。',
      outputType: '训练型闪卡',
      renderMode: 'flashcards',
      status: 'ready',
      enabled: true,
    },
    {
      key: 'quiz',
      name: '测验工坊',
      category: '理解检验',
      headline: '课堂理解测验生成',
      description: '自动生成可作答测验，提交后即时反馈并定位证据。',
      tags: ['课堂测验', '错题复盘', '作答'],
      coverImage: '/images/apps/quiz-cover.svg',
      pluginId: 'quiz-arena',
      intent: '生成课堂测验，检验理解并输出可回放证据。',
      outputType: '可作答测验',
      renderMode: 'quiz',
      status: 'ready',
      enabled: true,
    },
  ],
  count: 2,
};

async function openDbInBrowser(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('MeetMindDB');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
    });
  });
}

async function seedOnboardingDone(page: Page): Promise<void> {
  await openDbInBrowser(page);
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('MeetMindDB');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('preferences', 'readwrite');
        tx.onerror = () => reject(tx.error);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.objectStore('preferences').put({
          key: 'onboarding_state',
          value: {
            completedFlows: ['welcome', 'recording', 'review', 'video-review'],
            skippedFlows: [],
            currentFlow: null,
            currentStepIndex: 0,
            lastUpdated: Date.now(),
          },
        });
      };
    });
  });
}

async function openApp(page: Page): Promise<void> {
  await page.goto('/app?guest=1');
  await seedOnboardingDone(page);
  await page.reload();
  await expect(page.getByTestId('mode-review-button')).toBeVisible();
}

async function enterReviewMode(page: Page): Promise<void> {
  await page.getByTestId('mode-review-button').click();
  await expect(page.getByTestId('waveform-current-time')).toBeVisible();
}

async function mockWorkshopApis(page: Page): Promise<void> {
  await page.route('**/api/apps/catalog', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_CATALOG),
    });
  });

  await page.route('**/api/apps/execute', async (route) => {
    const body = route.request().postDataJSON() as { appKey?: string };
    if (body.appKey === 'quiz') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          pluginId: 'quiz-arena',
          result: {
            pluginId: 'quiz-arena',
            version: '0.1.0',
            cards: [
              {
                id: 'quiz-card-1',
                type: 'quiz',
                title: '题目 1',
                body: '课堂中的主动回忆步骤是什么？',
                citations: [{ startMs: 10000, endMs: 18000, snippet: 'mock snippet' }],
                meta: {
                  cardKind: 'quiz',
                  stem: '课堂中的主动回忆步骤是什么？',
                  options: ['A. 先看答案', 'B. 先回想后核对'],
                  answer: 'B',
                  explanation: '先回想，再核对答案是核心。',
                },
              },
            ],
            tasks: [{ id: 'quiz-task-1', label: '完成测验 1', estimatedMinutes: 3, relatedTimestamp: 10000 }],
            render: {
              mode: 'quiz',
              payload: {
                questions: [
                  {
                    id: 'quiz-card-1',
                    title: '题目 1',
                    stem: '课堂中的主动回忆步骤是什么？',
                    options: ['A. 先看答案', 'B. 先回想后核对'],
                    answer: 'B',
                    explanation: '先回想，再核对答案是核心。',
                  },
                ],
              },
            },
            trace: ['app=quiz'],
            raw: {},
          },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        pluginId: 'flashcards-lab',
        result: {
          pluginId: 'flashcards-lab',
          version: '0.1.0',
          cards: [
            {
              id: 'flashcard-card-1',
              type: 'flashcard',
              title: '闪卡 1',
              body: '什么是主动回忆？',
              citations: [{ startMs: 9000, endMs: 17000, snippet: 'mock snippet' }],
              meta: {
                cardKind: 'flashcard',
                front: '什么是主动回忆？',
                back: '先回想，再核对答案。',
                hint: '先说定义，再给课堂例子',
              },
            },
          ],
          tasks: [{ id: 'flash-task-1', label: '完成闪卡 1', estimatedMinutes: 3, relatedTimestamp: 9000 }],
          render: {
            mode: 'flashcards',
            payload: {
              cards: [
                {
                  id: 'flashcard-card-1',
                  title: '闪卡 1',
                  front: '什么是主动回忆？',
                  back: '先回想，再核对答案。',
                  hint: '先说定义，再给课堂例子',
                },
              ],
            },
          },
          trace: ['app=flashcards'],
          raw: {},
        },
      }),
    });
  });

  await page.route('**/api/apps/infographic/generate-image', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, enabled: false, model: 'qwen-image-max' }),
      });
      return;
    }
    await route.continue();
  });
}

test.describe('Workshop Apps', () => {
  test('cache keys are isolated by sessionId + appKey', async ({ page }) => {
    await mockWorkshopApis(page);
    await openApp(page);
    await enterReviewMode(page);

    await page.getByTestId('review-tab-apps').click();
    await expect(page.getByTestId('workshop-card-flashcards')).toBeVisible();
    await expect(page.getByTestId('workshop-card-quiz')).toBeVisible();

    await page.getByTestId('workshop-open-app-flashcards').click();
    await expect(page).toHaveURL(/\/app/);
    await expect(page.getByTestId('workshop-window-flashcards-fullscreen')).toBeVisible();
    await expect(page.getByTestId('flashcards-window')).toBeVisible();
    await page
      .getByTestId('workshop-window-flashcards-fullscreen')
      .getByRole('button', { name: '关闭窗口' })
      .click();
    await expect(page.getByTestId('workshop-window-flashcards-fullscreen')).toHaveCount(0);

    await page.getByTestId('workshop-open-app-quiz').click();
    await expect(page).toHaveURL(/\/app/);
    await expect(page.getByTestId('workshop-window-quiz-fullscreen')).toBeVisible();
    await expect(page.getByTestId('quiz-window')).toBeVisible();

    const isolation = await page.evaluate(() => {
      const sessionId =
        window.localStorage.getItem('session_id') ||
        Object.keys(window.localStorage)
          .map((key) => key.match(/^app_workspace_result:(.+):(flashcards|quiz)$/)?.[1] || '')
          .find(Boolean);
      if (!sessionId) return { ok: false, reason: 'missing-session' };
      const flashResult = Boolean(localStorage.getItem(`app_workspace_result:${sessionId}:flashcards`));
      const quizResult = Boolean(localStorage.getItem(`app_workspace_result:${sessionId}:quiz`));
      const flashTask = Boolean(localStorage.getItem(`app_workspace_task:${sessionId}:flashcards`));
      const quizTask = Boolean(localStorage.getItem(`app_workspace_task:${sessionId}:quiz`));
      return { ok: flashResult && quizResult && flashTask && quizTask };
    });
    expect(isolation.ok).toBeTruthy();
  });
});
