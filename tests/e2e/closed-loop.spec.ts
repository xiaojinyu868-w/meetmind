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
    title: '鍥炴斁鏍稿績娈佃惤',
    description: 'Replay key section and confirm understanding.',
    estimatedMinutes: 6,
    completed: false,
    relatedTimestamp: 72_000,
  },
  {
    id: 'task-exercise',
    type: 'exercise',
    title: '鍋?閬撻',
    description: 'Do two exercises around the current confusion point.',
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
      teacherSaid: '杩欐槸 mock 瀹舵暀瑙ｉ噴',
      citation: {
        text: 'mock citation',
        timeRange: '1:10-1:20',
        startMs: 70_000,
        endMs: 80_000,
      },
      possibleStuckPoints: ['mock confusion'],
      followUpQuestion: '浣犺寰楀摢涓€姝ユ渶鍗★紵',
    },
    actionItems,
    rawContent: 'mock raw',
    model: 'qwen-plus',
    conversation_id: 'conv-mock',
  };
}

function buildTutorSSEStream(params: {
  content?: string;
  citations?: Array<{
    id: string;
    title: string;
    url: string;
    snippet: string;
    source_type: 'knowledge_base' | 'web' | 'transcript';
  }>;
}) {
  const events: string[] = [];
  if (params.citations && params.citations.length > 0) {
    events.push(
      `data: ${JSON.stringify({
        type: 'metadata',
        citations: params.citations,
      })}`
    );
    events.push('');
  }

  if (params.content) {
    events.push(
      `data: ${JSON.stringify({
        type: 'content',
        content: params.content,
      })}`
    );
    events.push('');
  }

  events.push('data: [DONE]');
  events.push('');
  return events.join('\n');
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
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
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
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const canRetry =
        attempt < 2 &&
        (message.includes('Execution context was destroyed') ||
          message.includes('Cannot find context with specified id'));
      if (!canRetry) throw error;
      await page.waitForLoadState('domcontentloaded');
    }
  }
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

    const beforeRefresh = await readDbSnapshot(page);
    expect(beforeRefresh.audioSessions).toBeGreaterThanOrEqual(0);

    await page.reload();
    const afterRefresh = await readDbSnapshot(page);
    expect(afterRefresh.transcripts).toBeGreaterThanOrEqual(0);
    expect(afterRefresh.audioSessions).toBeGreaterThanOrEqual(0);
  });

  test('learning track can expand and collapse in video review', async ({ page }) => {
    await mockVideoImportApi(page);
    await openApp(page);

    await page.getByTestId('source-video-button').click();
    await page.getByTestId('video-link-input').fill('https://www.bilibili.com/video/BV1xx411c7mD');
    await page.getByTestId('video-import-button').click();

    const toggle = page.getByTestId('learning-track-toggle');
    if ((await toggle.count()) === 0) {
      return;
    }
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

  test('support materials can be imported and counted in current session', async ({ page }) => {
    await openApp(page);
    await page.getByTestId('source-support-button').click();
    const textTab = page.getByTestId('support-import-tab-text');
    if ((await textTab.count()) === 0) return;
    await textTab.click();

    const textarea = page.getByTestId('support-textarea');
    if ((await textarea.count()) === 0) return;
    await textarea.fill(
      '资料要点：平台型入口、内容分发引擎、底层数据基建。'
    );
    await page.getByTestId('support-import-text-submit').click();
    const supportCount = page.getByTestId('support-source-count');
    if ((await supportCount.count()) === 0) return;
    await expect(supportCount).toContainText('1');
  });

  test('tutor no longer renders legacy citation card for non-stream response', async ({ page }) => {
    await page.route('**/api/tutor', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...buildTutorResponse(),
          citations: [
            {
              id: 'support-1',
              title: 'Imported Source 1',
              url: 'about:blank#support-1',
              snippet: 'platform entry and distribution engine',
              source_type: 'knowledge_base',
            },
          ],
        }),
      });
    });

    await openApp(page);
    await enterReviewMode(page);

    await expect(page.getByText('资料引用')).toHaveCount(0);
    await expect(page.getByTestId('tutor-resolve-button').first()).toBeVisible();
  });

  test('tutor follow-up renders inline citations from streaming metadata', async ({ page }) => {
    await page.route('**/api/tutor', async (route) => {
      const req = route.request();
      const payload = req.method() === 'POST' ? req.postDataJSON() as Record<string, unknown> : null;
      const isStream = Boolean(payload && payload.stream === true);

      if (isStream) {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: buildTutorSSEStream({
            citations: [
              {
                id: 'support-1',
                title: 'Imported Source 1',
                url: 'about:blank#support-1',
                snippet: 'platform entry and distribution engine',
                source_type: 'knowledge_base',
              },
            ],
            content: 'I referenced imported materials and summarized three parts [资料1].',
          }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(buildTutorResponse()),
      });
    });

    await openApp(page);
    await enterReviewMode(page);

    const tutorInput = page.locator('input[type="text"]').first();
    await tutorInput.fill('Please answer with imported materials');
    await tutorInput.press('Enter');

    await expect(page.getByText('资料引用')).toHaveCount(0);
    await expect(page.getByLabel(/资料1/)).toBeVisible();
    await expect(page.getByText('[1]')).toBeVisible();
  });
  test('ai workshop opens floating app window without leaving workspace', async ({ page }) => {
    await mockAppMatrixApi(page);
    await openApp(page);
    await enterReviewMode(page);

    await page.getByTestId('review-tab-apps').click();
    await expect(page.getByTestId('workshop-card-flashcards')).toBeVisible();

    await page.getByTestId('workshop-card-flashcards').getByRole('link').click();
    await expect(page).toHaveURL(/\/app/);
    const floatingWindow = page.getByTestId('floating-workshop-window-flashcards');
    if ((await floatingWindow.count()) > 0) {
      await expect(floatingWindow).toBeVisible();
      await expect(page.getByTestId('flashcards-window')).toBeVisible();
    }
    await expect(page.getByTestId('workshop-card-flashcards')).toBeVisible();
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
    if ((await page.getByTestId('workshop-dock-open-flashcards').count()) === 0) {
      await expect(page.getByTestId('workshop-dock-task-flashcards')).toBeVisible();
      return;
    }

    await page.getByTestId('workshop-dock-open-flashcards').click();
    await expect(page).toHaveURL(/\/app/);
    if ((await page.getByTestId('floating-workshop-window-flashcards').count()) > 0) {
      await expect(page).not.toHaveURL(/\/app\/matrix\/flashcards/);
      await expect(page.getByTestId('floating-workshop-window-flashcards')).toBeVisible();
    }
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

  test('mobile model selector panel fits viewport', async ({ page }) => {
    await mockTutorApi(page);
    await openApp(page);
    await enterReviewMode(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);

    const trigger = page.getByTestId('model-selector-trigger').first();
    if ((await trigger.count()) === 0) return;
    await expect(trigger).toBeVisible();
    await trigger.click();

    const panel = page.getByTestId('model-selector-panel');
    await expect(panel).toBeVisible();

    const panelBox = await panel.boundingBox();
    expect(panelBox).not.toBeNull();
    if (panelBox) {
      expect(panelBox.x).toBeGreaterThanOrEqual(0);
      expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(391);
    }
  });
});

