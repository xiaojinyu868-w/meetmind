import { expect, Page, test } from '@playwright/test';

type DbSnapshot = {
  transcripts: number;
  audioSessions: number;
  latestSessionSourceType: string | null;
};

const MOCK_VIDEO_IMPORT_RESPONSE = {
  success: true,
  sourceMode: 'bili-native',
  source: {
    provider: 'bilibili',
    providerLabel: 'Bilibili',
    originalUrl: 'https://www.bilibili.com/video/BV1xx411c7mD',
    resolvedUrl: 'https://www.bilibili.com/video/BV1xx411c7mD',
    embedUrl: 'https://player.bilibili.com/player.html?bvid=BV1xx411c7mD&page=1',
    playableUrl: 'https://www.bilibili.com/video/BV1xx411c7mD',
    title: 'E2E Mock Video',
    durationSec: 120,
    thumbnailUrl: '',
    audioUrl: '/demo-audio.mp3',
    bvid: 'BV1xx411c7mD',
    sourceMode: 'bili-native',
    importTrace: [{ stage: 'mock', ok: true }],
  },
  segments: [
    { id: 'seg-0', text: 'mock 1', startMs: 0, endMs: 10_000, confidence: 0.98 },
    { id: 'seg-1', text: 'mock 2', startMs: 10_000, endMs: 25_000, confidence: 0.98 },
    { id: 'seg-2', text: 'mock 3', startMs: 25_000, endMs: 40_000, confidence: 0.98 },
  ],
};

const DEFAULT_ACTION_ITEMS = [
  {
    id: 'task-replay',
    type: 'replay',
    title: '回放核心段落',
    description: '先回放老师讲解关键句，确认理解。',
    estimatedMinutes: 6,
    completed: false,
    relatedTimestamp: 72_000,
  },
  {
    id: 'task-exercise',
    type: 'exercise',
    title: '做2道题',
    description: '围绕当前困惑点做2道题。',
    estimatedMinutes: 8,
    completed: false,
    relatedTimestamp: 30_000,
  },
] as const;

const MOCK_APP_MATRIX_PLUGINS = {
  plugins: [
    {
      id: 'knowledge-cards',
      name: '知识卡片',
      version: '0.1.0',
      description: '课堂证据卡片插件',
      tags: ['student', 'cards'],
      capabilities: ['citation-card', 'task-writeback'],
      enabledByDefault: true,
    },
  ],
  count: 1,
};

const MOCK_WORKSHOP_CATALOG = {
  apps: [
    {
      key: 'flashcards',
      name: 'Flashcards',
      category: 'Memory',
      headline: 'Active Recall Flashcards',
      description: 'Generate flashcards from classroom evidence with training flow.',
      tags: ['recall', 'spaced', 'practice'],
      coverImage: '/images/apps/flashcards-cover.svg',
      pluginId: 'flashcards-lab',
      intent: 'Generate flashcards from class evidence for active recall.',
      outputType: 'Training flashcards',
      renderMode: 'flashcards',
      status: 'ready',
      enabled: true,
    },
  ],
  count: 1,
};

const MOCK_APP_MATRIX_EXECUTION = {
  ok: true,
  pluginId: 'flashcards-lab',
  result: {
    pluginId: 'flashcards-lab',
    version: '0.1.0',
    model: 'qwen3-max-2026-01-23',
    trace: ['intent=flashcards-training', 'strategy=context_first'],
    cards: [
      {
        id: 'flashcard-card-1',
        type: 'flashcard',
        title: '?? 1',
        body: 'What is active recall?',
        priority: 'high',
        citations: [{ startMs: 10_000, endMs: 20_000, snippet: 'mock snippet' }],
        actions: [{ id: 'seek-1', label: '?? 0:10', kind: 'seek', payload: { timestamp: 10_000 } }],
        meta: {
          cardKind: 'flashcard',
          front: 'What is active recall?',
          back: 'Recall first, then verify with answer.',
          hint: 'Define first, then provide one class example',
        },
      },
    ],
    tasks: [
      {
        id: 'flashcard-task-1',
        label: 'Complete flashcard 1',
        reason: 'Recall before checking answer',
        estimatedMinutes: 5,
        relatedTimestamp: 10_000,
      },
    ],
    render: {
      mode: 'flashcards',
      title: 'Class Flashcards',
      description: 'Recall before checking answer',
      payload: {
        cards: [
          {
            id: 'flashcard-card-1',
            title: '?? 1',
            front: 'What is active recall?',
            back: 'Recall first, then verify with answer.',
            hint: 'Define first, then provide one class example',
          },
        ],
      },
    },
    raw: {
      generatedAt: '2026-02-13T00:00:00.000Z',
    },
  },
};


function buildTutorResponse(actionItems = DEFAULT_ACTION_ITEMS) {
  return {
    explanation: {
      teacherSaid: '这是 mock 家教解释',
      citation: {
        text: 'mock citation',
        timeRange: '1:10-1:20',
        startMs: 70_000,
        endMs: 80_000,
      },
      possibleStuckPoints: ['mock 困惑点'],
      followUpQuestion: '你觉得哪一步最卡？',
    },
    actionItems,
    rawContent: 'mock raw',
    model: 'qwen-plus',
    conversation_id: 'conv-mock',
  };
}

async function mockTutorApi(page: Page, actionItems = DEFAULT_ACTION_ITEMS): Promise<void> {
  await page.route('**/api/tutor', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildTutorResponse(actionItems)),
    });
  });
}

async function mockVideoImportApi(page: Page): Promise<void> {
  await page.route('**/api/video/import', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_VIDEO_IMPORT_RESPONSE),
    });
  });
}

type ExecuteMockStep = {
  status?: number;
  body?: Record<string, unknown>;
  delayMs?: number;
};

async function mockAppMatrixApi(
  page: Page,
  options?: { executeDelayMs?: number; executePlan?: ExecuteMockStep[] }
): Promise<void> {
  await page.route('**/api/apps/catalog', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_WORKSHOP_CATALOG),
    });
  });

  await page.route('**/api/apps/plugins', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_APP_MATRIX_PLUGINS),
    });
  });

  let executeCall = 0;
  await page.route('**/api/apps/execute', async (route) => {
    const plan = options?.executePlan;
    const step = plan ? plan[Math.min(executeCall, plan.length - 1)] : undefined;
    executeCall += 1;

    const delayMs = step?.delayMs ?? options?.executeDelayMs;
    if (delayMs) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    await route.fulfill({
      status: step?.status ?? 200,
      contentType: 'application/json',
      body: JSON.stringify(step?.body ?? MOCK_APP_MATRIX_EXECUTION),
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

async function readDbSnapshot(page: Page): Promise<DbSnapshot> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('MeetMindDB');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });

    try {
      const tx = db.transaction(['audioSessions', 'transcripts'], 'readonly');
      const audioStore = tx.objectStore('audioSessions');
      const transcriptStore = tx.objectStore('transcripts');
      const audioCountRequest = audioStore.count();
      const transcriptCountRequest = transcriptStore.count();
      const audioAllRequest = audioStore.getAll();

      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });

      const sessions = (audioAllRequest.result || []) as Array<{ id?: number; sourceType?: string }>;
      sessions.sort((a, b) => (a.id || 0) - (b.id || 0));

      return {
        transcripts: Number(transcriptCountRequest.result || 0),
        audioSessions: Number(audioCountRequest.result || 0),
        latestSessionSourceType: sessions.length > 0
          ? (sessions[sessions.length - 1].sourceType || null)
          : null,
      };
    } finally {
      db.close();
    }
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

function parseClockToMs(text: string | null): number {
  const value = (text || '').trim();
  if (!value) return 0;
  const parts = value.split(':').map((item) => Number(item));
  if (parts.some((item) => Number.isNaN(item))) return 0;
  if (parts.length === 2) {
    const [minutes, seconds] = parts;
    return (minutes * 60 + seconds) * 1000;
  }
  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts;
    return (hours * 3600 + minutes * 60 + seconds) * 1000;
  }
  return 0;
}

test.describe('Closed Loop Regression', () => {
  test('video import persists transcript + session after refresh', async ({ page }) => {
    await mockVideoImportApi(page);
    await openApp(page);

    await page.getByTestId('source-video-button').click();
    await page.getByTestId('video-link-input').fill('https://www.bilibili.com/video/BV1xx411c7mD');
    await page.getByTestId('video-import-button').click();

    await expect(page.getByTestId('video-review-player')).toBeVisible();
    await expect.poll(async () => (await readDbSnapshot(page)).transcripts).toBeGreaterThan(0);

    const beforeRefresh = await readDbSnapshot(page);
    expect(beforeRefresh.audioSessions).toBeGreaterThan(0);
    expect(beforeRefresh.latestSessionSourceType).toBe('video-link');

    await page.reload();
    const afterRefresh = await readDbSnapshot(page);
    expect(afterRefresh.transcripts).toBe(beforeRefresh.transcripts);
    expect(afterRefresh.audioSessions).toBe(beforeRefresh.audioSessions);
    expect(afterRefresh.latestSessionSourceType).toBe(beforeRefresh.latestSessionSourceType);
  });

  test('learning track can expand and collapse in video review', async ({ page }) => {
    await mockVideoImportApi(page);
    await openApp(page);

    await page.getByTestId('source-video-button').click();
    await page.getByTestId('video-link-input').fill('https://www.bilibili.com/video/BV1xx411c7mD');
    await page.getByTestId('video-import-button').click();

    await expect(page.getByTestId('video-review-player')).toBeVisible();
    const toggle = page.getByTestId('learning-track-toggle');
    await expect(toggle).toBeVisible();
    await expect(page.getByTestId('learning-track-panel')).toHaveCount(0);

    await toggle.click();
    await expect(page.getByTestId('learning-track-panel')).toBeVisible();

    await toggle.click();
    await expect(page.getByTestId('learning-track-panel')).toHaveCount(0);
  });

  test('anchor resolve updates unresolved status immediately', async ({ page }) => {
    await mockTutorApi(page);
    await openApp(page);
    await enterReviewMode(page);

    const unresolvedBadge = page.getByTestId('unresolved-count');
    const unresolvedBefore = Number((await unresolvedBadge.getAttribute('data-count')) || '0');
    await expect(page.getByTestId('tutor-resolve-button').first()).toBeVisible();
    await page.getByTestId('tutor-resolve-button').first().click();

    await expect(unresolvedBadge).toHaveAttribute('data-count', String(unresolvedBefore - 1));
    await expect(page.getByTestId('tutor-resolve-button')).toHaveCount(0);
  });

  test('action completion state persists after page reload', async ({ page }) => {
    await mockTutorApi(page);
    await openApp(page);
    await enterReviewMode(page);

    await page.getByTestId('action-sidebar-toggle').click();
    await expect(page.getByTestId('action-drawer')).toBeVisible();
    await expect(page.getByTestId('action-item-task-replay')).toBeVisible();

    await page.getByTestId('action-checkbox-task-replay').click();
    await expect(page.getByTestId('action-item-task-replay')).toHaveAttribute('data-completed', 'true');

    await page.reload();
    await page.getByTestId('mode-review-button').click();
    await page.getByTestId('action-sidebar-toggle').click();
    await expect(page.getByTestId('action-item-task-replay')).toHaveAttribute('data-completed', 'true');
  });

  test('ai workshop opens floating app window without leaving workspace', async ({ page }) => {
    await mockAppMatrixApi(page);
    await openApp(page);
    await enterReviewMode(page);

    await page.getByTestId('review-tab-apps').click();
    await expect(page.getByTestId('workshop-card-flashcards')).toBeVisible();

    await page.getByTestId('workshop-card-flashcards').getByRole('link').click();
    await expect(page).toHaveURL(/\/app/);
    await expect(page.getByTestId('floating-workshop-window-flashcards')).toBeVisible();
    await expect(page.getByTestId('flashcards-window')).toBeVisible();

    const cached = await page.evaluate(() => {
      const sessionId =
        window.localStorage.getItem('session_id') ||
        Object.keys(window.localStorage)
          .map((key) => key.match(/^app_workspace_result:(.+):flashcards$/)?.[1] || '')
          .find(Boolean);
      if (!sessionId) return false;
      return Boolean(window.localStorage.getItem(`app_workspace_result:${sessionId}:flashcards`));
    });
    expect(cached).toBeTruthy();

    await page.reload();
    await page.getByTestId('mode-review-button').click();
    await expect(page.getByTestId('floating-workshop-window-flashcards')).toBeVisible();
  });

  test('workshop background generation does not block timeline/chat flow', async ({ page }) => {
    await mockAppMatrixApi(page, { executeDelayMs: 1200 });
    await openApp(page);
    await enterReviewMode(page);

    await page.getByTestId('review-tab-apps').click();
    await expect(page.getByTestId('workshop-card-flashcards')).toBeVisible();

    await page.getByTestId('workshop-bg-generate-flashcards').click();
    await expect(page.getByTestId('workshop-task-summary')).toContainText('后台任务运行中');

    await page.getByRole('button', { name: '时间轴' }).first().click();
    await expect(page.getByTestId('review-tab-apps')).toBeVisible();

    await page.getByTestId('review-tab-apps').click();
    await expect(page.getByTestId('workshop-card-flashcards')).toContainText('已生成');
  });

  test('workshop dock supports cancel retry and open result', async ({ page }) => {
    await mockAppMatrixApi(page, {
      executePlan: [
        {
          delayMs: 1800,
          status: 200,
          body: MOCK_APP_MATRIX_EXECUTION,
        },
        {
          status: 200,
          body: MOCK_APP_MATRIX_EXECUTION,
        },
      ],
    });
    await openApp(page);
    await enterReviewMode(page);

    await page.getByTestId('review-tab-apps').click();
    await page.getByTestId('workshop-bg-generate-flashcards').click();

    await page.getByTestId('workshop-dock-toggle').click();
    await expect(page.getByTestId('workshop-dock-panel')).toBeVisible();

    await page.getByTestId('workshop-dock-cancel-flashcards').click();
    await expect(page.getByTestId('workshop-dock-task-flashcards')).toContainText('已取消');

    await page.getByTestId('workshop-dock-retry-flashcards').click();
    await expect(page.getByTestId('workshop-dock-task-flashcards')).toContainText('已完成');

    await page.getByTestId('workshop-dock-open-flashcards').click();
    await expect(page).toHaveURL(/\/app/);
    await expect(page).not.toHaveURL(/\/app\/matrix\/flashcards/);
    await expect(page.getByTestId('floating-workshop-window-flashcards')).toBeVisible();
    await expect(page.getByTestId('flashcards-window')).toBeVisible();
  });


  test('start-next-task seeks playback forward', async ({ page }) => {
    await mockTutorApi(page, DEFAULT_ACTION_ITEMS);
    await openApp(page);
    await enterReviewMode(page);

    await page.getByTestId('action-sidebar-toggle').click();
    await expect(page.getByTestId('action-drawer')).toBeVisible();
    await expect(page.getByTestId('action-start-next')).toBeVisible();

    const beforeText = await page.getByTestId('waveform-current-time').textContent();
    const beforeMs = parseClockToMs(beforeText);

    await page.getByTestId('action-start-next').click();

    await expect.poll(async () => {
      const currentText = await page.getByTestId('waveform-current-time').textContent();
      return parseClockToMs(currentText);
    }).toBeGreaterThan(beforeMs);
  });
});
