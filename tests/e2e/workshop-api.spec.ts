import { expect, test } from '@playwright/test';

type WorkshopCase = {
  appKey: 'audio-overview' | 'flashcards' | 'quiz' | 'mindmap' | 'infographic';
  expectedPluginId: string;
  expectedRenderMode: string;
};

const WORKSHOP_CASES: WorkshopCase[] = [
  { appKey: 'audio-overview', expectedPluginId: 'studio-workshop', expectedRenderMode: 'audio' },
  { appKey: 'flashcards', expectedPluginId: 'flashcards-lab', expectedRenderMode: 'flashcards' },
  { appKey: 'quiz', expectedPluginId: 'quiz-arena', expectedRenderMode: 'quiz' },
  { appKey: 'mindmap', expectedPluginId: 'mindmap-outline', expectedRenderMode: 'mindmap' },
  { appKey: 'infographic', expectedPluginId: 'studio-workshop', expectedRenderMode: 'custom' },
];

const MOCK_TRANSCRIPT = [
  {
    id: 'seg-1',
    text: '本节课我们讲解圆锥曲线离心率的定义、性质以及常见题型。',
    startMs: 0,
    endMs: 14000,
    confidence: 0.98,
    isFinal: true,
  },
  {
    id: 'seg-2',
    text: '解题时先写出统一定义，再把几何条件转成代数约束，最后检查参数范围。',
    startMs: 14000,
    endMs: 29000,
    confidence: 0.98,
    isFinal: true,
  },
  {
    id: 'seg-3',
    text: '同学容易卡在焦点定义和准线定义的切换，这里要建立等价关系。',
    startMs: 29000,
    endMs: 43000,
    confidence: 0.98,
    isFinal: true,
  },
];

const MOCK_ANCHORS = [
  {
    id: 'anchor-1',
    sessionId: 'session-e2e-workshop',
    studentId: 'guest',
    timestamp: 30000,
    type: 'confusion',
    cancelled: false,
    resolved: false,
    createdAt: new Date('2026-02-16T10:00:00.000Z').toISOString(),
    note: '焦点与准线切换容易混淆',
  },
];

function buildExecutePayload(appKey: WorkshopCase['appKey']) {
  return {
    appKey,
    model: 'model-does-not-exist',
    goal: {
      intent: `生成${appKey}学习应用`,
      expectedOutput: 'mixed',
      appKey,
    },
    input: {
      sessionId: 'session-e2e-workshop',
      dataSource: 'video',
      transcript: MOCK_TRANSCRIPT,
      anchors: MOCK_ANCHORS,
      metadata: {
        subject: '数学',
        teacher: '王老师',
        locale: 'zh-CN',
      },
    },
    memory: {
      summary: '圆锥曲线离心率复习课',
      keyDifficulties: ['定义切换', '参数范围判断'],
    },
  };
}

test.describe('Workshop API', () => {
  test('catalog returns first-batch app keys only', async ({ request }) => {
    const response = await request.get('/api/apps/catalog');
    expect(response.ok()).toBeTruthy();

    const body = (await response.json()) as {
      count?: number;
      apps?: Array<{ key?: string }>;
    };
    const keys = (body.apps || []).map((item) => item.key).filter(Boolean).sort();

    expect(body.count).toBe(5);
    expect(keys).toEqual(['audio-overview', 'flashcards', 'infographic', 'mindmap', 'quiz']);
  });

  for (const testCase of WORKSHOP_CASES) {
    test(`execute ${testCase.appKey} returns render contract`, async ({ request }) => {
      const response = await request.post('/api/apps/execute', {
        data: buildExecutePayload(testCase.appKey),
      });
      expect(response.ok()).toBeTruthy();

      const body = (await response.json()) as {
        ok?: boolean;
        pluginId?: string;
        result?: {
          pluginId?: string;
          cards?: unknown[];
          trace?: string[];
          render?: { mode?: string };
        };
      };

      expect(body.ok).toBeTruthy();
      expect(body.pluginId).toBe(testCase.expectedPluginId);
      expect(body.result?.pluginId).toBe(testCase.expectedPluginId);
      expect(body.result?.render?.mode).toBe(testCase.expectedRenderMode);
      expect(Array.isArray(body.result?.cards)).toBeTruthy();
      expect((body.result?.cards || []).length).toBeGreaterThan(0);
      expect(Array.isArray(body.result?.trace)).toBeTruthy();
      expect((body.result?.trace || []).length).toBeGreaterThan(0);
    });
  }

  test('legacy call without appKey keeps compatibility trace', async ({ request }) => {
    const response = await request.post('/api/apps/execute', {
      data: {
        pluginId: 'legacy-plugin-id',
        model: 'model-does-not-exist',
        goal: '生成课堂复习卡片',
        input: {
          sessionId: 'session-e2e-legacy',
          dataSource: 'video',
          transcript: MOCK_TRANSCRIPT,
          anchors: [],
        },
      },
    });
    expect(response.ok()).toBeTruthy();

    const body = (await response.json()) as {
      ok?: boolean;
      result?: { trace?: string[] };
    };
    expect(body.ok).toBeTruthy();
    expect(body.result?.trace || []).toContain('legacy_appkey_fallback');
    expect((body.result?.trace || []).some((item) => item.startsWith('legacy_pluginid_unknown='))).toBeTruthy();
  });
});
