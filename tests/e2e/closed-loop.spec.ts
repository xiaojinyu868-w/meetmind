import { expect, Page, test, type Request } from '@playwright/test';

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
      id: 'flashcards-lab',
      name: '闪卡训练',
      version: '0.1.0',
      description: '主动回忆闪卡训练器',
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

function safePostDataJSON(request: Request): Record<string, unknown> | null {
  try {
    const payload = request.postDataJSON();
    return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null;
  } catch {
    return null;
  }
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
  await expect(page.getByTestId('mode-review-button')).toBeVisible();
}

async function enterReviewMode(page: Page): Promise<void> {
  await page.getByTestId('mode-review-button').click();
  await Promise.any([
    page.getByTestId('waveform-current-time').waitFor({ state: 'visible', timeout: 15_000 }),
    page.getByTestId('video-review-player').waitFor({ state: 'visible', timeout: 15_000 }),
    page.getByTestId('tutor-global-input').waitFor({ state: 'visible', timeout: 15_000 }),
  ]);
}

async function submitCollectionComposer(page: Page, text: string): Promise<void> {
  await page.getByTestId('collection-composer-input').fill(text);
  await page.getByTestId('collection-composer-submit').click();
}

async function importVideoFromCollection(page: Page, url: string): Promise<void> {
  await submitCollectionComposer(page, url);
  await expect(page.getByTestId('video-review-player')).toBeVisible();
}

async function fillBreakpointTutorAndWaitReady(page: Page, question: string): Promise<void> {
  const tutorInput = page.getByTestId('tutor-breakpoint-input');
  const sendButton = page.getByTestId('tutor-breakpoint-send');
  await tutorInput.fill(question);
  await expect(sendButton).toBeEnabled({ timeout: 60_000 });
}

async function fillGlobalTutorAndWaitReady(page: Page, question: string): Promise<void> {
  const tutorInput = page.getByTestId('tutor-global-input');
  const sendButton = page.getByTestId('tutor-global-send');
  await tutorInput.fill(question);
  await expect(sendButton).toBeEnabled({ timeout: 60_000 });
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

    await importVideoFromCollection(page, 'https://www.bilibili.com/video/BV1xx411c7mD');
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

    await importVideoFromCollection(page, 'https://www.bilibili.com/video/BV1xx411c7mD');
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

  test('support materials are injected into tutor requests after import', async ({ page }) => {
    const tutorPayloads: Array<Record<string, unknown>> = [];
    await page.route('**/api/tutor', async (route) => {
      const req = route.request();
      if (req.method() === 'POST') {
        const payload = safePostDataJSON(req);
        if (payload) {
          tutorPayloads.push(payload);
        }
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(buildTutorResponse()),
      });
    });

    await openApp(page);
    await submitCollectionComposer(page, '资料要点：平台型入口、内容分发引擎、底层数据基建。');

    tutorPayloads.length = 0;

    await enterReviewMode(page);

    await fillGlobalTutorAndWaitReady(page, '请结合资料总结三大场景');
    await page.getByTestId('tutor-global-send').click();

    let supportText = '';
    await expect.poll(() => {
      const followup = tutorPayloads.find(
        (payload) => typeof payload.studentQuestion === 'string' && payload.studentQuestion.includes('结合资料')
      );
      if (!followup) return '';
      const segments = Array.isArray(followup.segments) ? followup.segments : [];
      const supportSegment = segments.find(
        (segment) =>
          segment &&
          typeof segment === 'object' &&
          (segment as Record<string, unknown>).id === '__support_context__'
      ) as Record<string, unknown> | undefined;
      supportText = typeof supportSegment?.text === 'string' ? supportSegment.text : '';
      return supportText;
    }).toContain('平台型入口');

    expect(supportText).toContain('【增强资料】');
    expect(supportText).toContain('[资料1] 标题');
    expect(supportText).toContain('必须标注 [资料N]');
  });

  test('tutor shows knowledge-base citations when response includes support references', async ({ page }) => {
    await mockVideoImportApi(page);
    await page.route('**/api/tutor', async (route) => {
      const req = route.request();
      const payload = req.method() === 'POST' ? safePostDataJSON(req) : null;
      const isStream = Boolean(payload && payload.stream === true);

      if (isStream) {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: buildTutorSSEStream({
            citations: [
              {
                id: 'support-1',
                title: '导入资料 1',
                url: 'about:blank#support-1',
                snippet: '平台型入口、内容分发引擎、底层数据基建。',
                source_type: 'knowledge_base',
              },
            ],
            content: '我参考了导入资料，总结出课堂框架的三部分 [资料1]。',
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
    await importVideoFromCollection(page, 'https://www.bilibili.com/video/BV1xx411c7mD');
    await enterReviewMode(page);

    await fillGlobalTutorAndWaitReady(page, '请结合导入资料总结课堂框架');
    await page.getByTestId('tutor-global-send').click();

    await expect(page.getByTestId('tutor-citation-panel')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('tutor-citation-1').getByText('导入资料 1')).toBeVisible();
    await expect(page.getByText('平台型入口、内容分发引擎、底层数据基建。')).toBeVisible();
  });

  test('tutor follow-up renders knowledge-base citations from streaming metadata', async ({ page }) => {
    await mockVideoImportApi(page);
    await page.route('**/api/tutor', async (route) => {
      const req = route.request();
      const payload = req.method() === 'POST' ? safePostDataJSON(req) : null;
      const isStream = Boolean(payload && payload.stream === true);

      if (isStream) {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: buildTutorSSEStream({
            citations: [
              {
                id: 'support-1',
                title: '导入资料 1',
                url: 'about:blank#support-1',
                snippet: '平台型入口、内容分发引擎、底层数据基建。',
                source_type: 'knowledge_base',
              },
            ],
            content: '我参考了导入资料，课堂框架可归纳为三部分 [资料1]。',
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
    await importVideoFromCollection(page, 'https://www.bilibili.com/video/BV1xx411c7mD');
    await enterReviewMode(page);

    await fillGlobalTutorAndWaitReady(page, '请结合我上传的资料回答');
    await page.getByTestId('tutor-global-send').click();

    await expect(page.getByTestId('tutor-citation-panel')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('tutor-citation-1').getByText('导入资料 1')).toBeVisible();
    await expect(page.getByText('平台型入口、内容分发引擎、底层数据基建。')).toBeVisible();
  });

  test('ai workshop opens app window without leaving workspace', async ({ page }) => {
    await mockTutorApi(page);
    await mockAppMatrixApi(page);
    await openApp(page);
    await enterReviewMode(page);

    await page.getByTestId('review-tab-apps').click();
    await expect(page.getByTestId('workshop-card-flashcards')).toBeVisible();

    await page.getByTestId('workshop-open-app-flashcards').click();
    await expect(page).toHaveURL(/\/app/);
    await expect(page.getByTestId('workshop-window-flashcards-fullscreen')).toBeVisible();
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
    await expect(page.getByTestId('workshop-window-flashcards-fullscreen')).toBeVisible();
  });

  test('workshop background generation does not block timeline/chat flow', async ({ page }) => {
    await mockTutorApi(page);
    await mockAppMatrixApi(page, { executeDelayMs: 1200 });
    await openApp(page);
    await enterReviewMode(page);

    await page.getByTestId('review-tab-apps').click();
    await expect(page.getByTestId('workshop-card-flashcards')).toBeVisible();

    await page.getByTestId('workshop-bg-generate-flashcards').click();
    await expect(page.getByTestId('workshop-task-summary')).toContainText('正在做 1');

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
    await expect(page.getByTestId('workshop-window-flashcards-fullscreen')).toBeVisible();
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
