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

const MOCK_APP_MATRIX_EXECUTION = {
  ok: true,
  pluginId: 'knowledge-cards',
  result: {
    pluginId: 'knowledge-cards',
    version: '0.1.0',
    model: 'qwen3-max-2026-01-23',
    trace: ['intent=复习模式：生成课堂证据知识卡片', 'strategy=context_first'],
    cards: [
      {
        id: 'knowledge-card-1',
        type: 'timeline',
        title: '条件从句速记卡',
        body: '先识别 if 从句，再判断主句时态，最后反推语义。',
        priority: 'high',
        citations: [{ startMs: 10_000, endMs: 20_000, snippet: 'mock snippet' }],
        actions: [
          { id: 'seek-1', label: '回放 0:10', kind: 'seek', payload: { timestamp: 10_000 } },
          { id: 'mark-1', label: '标记已掌握', kind: 'mark_done', payload: { taskId: 'knowledge-task-1' } },
        ],
      },
    ],
    tasks: [
      {
        id: 'knowledge-task-1',
        label: '复习卡片 1（0:10）',
        reason: '先听再复述',
        estimatedMinutes: 5,
        relatedTimestamp: 10_000,
      },
    ],
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

async function mockAppMatrixApi(page: Page): Promise<void> {
  await page.route('**/api/apps/plugins', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_APP_MATRIX_PLUGINS),
    });
  });

  await page.route('**/api/apps/execute', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_APP_MATRIX_EXECUTION),
    });
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

  test('app matrix knowledge cards can run and persist task state', async ({ page }) => {
    await mockAppMatrixApi(page);
    await openApp(page);
    await enterReviewMode(page);

    await page.getByTestId('review-tab-apps').click();
    await expect(page.getByTestId('app-matrix-panel')).toBeVisible();

    await page.getByTestId('app-matrix-run').click();
    await expect(page.getByTestId('app-card-knowledge-card-1')).toBeVisible();

    await page.getByTestId('app-task-toggle-knowledge-task-1').click();
    await expect(page.getByTestId('app-task-knowledge-task-1')).toHaveAttribute('data-completed', 'true');

    await page.reload();
    await page.getByTestId('mode-review-button').click();
    await page.getByTestId('review-tab-apps').click();
    await expect(page.getByTestId('app-task-knowledge-task-1')).toHaveAttribute('data-completed', 'true');
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
