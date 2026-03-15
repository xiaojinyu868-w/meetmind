import { expect, test } from '@playwright/test';
import { NextRequest } from 'next/server';
import { POST as refreshDailyEchoPost } from '../../src/app/api/workspace/echoes/daily-refresh/route';
import prisma from '../../src/lib/prisma';
import { authService } from '../../src/lib/services/auth-service';
import workspaceService from '../../src/lib/services/workspace-service';

test.describe.configure({ mode: 'serial' });

function buildAuthorizedRequest(token: string, force: boolean) {
  return new NextRequest('http://localhost/api/workspace/echoes/daily-refresh', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ force }),
  });
}

function setEnv(name: string, value: string | undefined) {
  (process.env as Record<string, string | undefined>)[name] = value;
}

async function seedEchoCaptures(workspaceId: string, userId: string) {
  const now = new Date();

  await prisma.workspaceCapture.createMany({
    data: [
      {
        workspaceId,
        userId,
        sourceType: 'manual-note',
        sourceKey: `manual:auto-${Date.now()}-1`,
        role: 'primary',
        contentType: 'audio',
        title: '课堂原声',
        previewText: '老师开始讲单调性和导数的关系。',
        normalizedText: '老师开始讲单调性和导数的关系，我卡在为什么导数符号可以直接推出单调区间。',
        tutorContext: '老师开始讲单调性和导数的关系，我卡在为什么导数符号可以直接推出单调区间。',
        occurredAt: now,
      },
      {
        workspaceId,
        userId,
        sourceType: 'manual-note',
        sourceKey: `manual:auto-${Date.now()}-2`,
        role: 'support',
        contentType: 'document',
        title: '讲义摘录',
        previewText: '讲义把单调区间和极值放在了一起。',
        normalizedText: '讲义把单调区间和极值放在了一起，我还没完全连起来。',
        tutorContext: '讲义把单调区间和极值放在了一起，我还没完全连起来。',
        occurredAt: new Date(now.getTime() + 1000),
      },
    ],
  });
}

async function seedCrowdedEchoCaptures(workspaceId: string, userId: string) {
  const now = new Date();
  const captures = Array.from({ length: 30 }, (_, index) => {
    const occurredAt = new Date(now.getTime() - (29 - index) * 4 * 60 * 60 * 1000);
    const isTodayTail = index >= 28;
    const olderIndexLabel = String(index + 1).padStart(2, '0');
    const title = isTodayTail ? `今天的新线索 ${index - 27}` : `更早的线索 ${olderIndexLabel}`;
    const text = isTodayTail
      ? `这是今天刚补进来的关键线索 ${index - 27}，我现在卡在为什么这里会突然转折。`
      : `这是更早之前的线索 ${index + 1}，主要在记录背景。`;

    return {
      workspaceId,
      userId,
      sourceType: 'manual-note',
      sourceKey: `manual:crowded-${Date.now()}-${index + 1}`,
      role: isTodayTail ? 'primary' : 'support',
      contentType: isTodayTail ? 'audio' : 'text',
      title,
      previewText: text,
      normalizedText: text,
      tutorContext: text,
      occurredAt,
    };
  });

  await prisma.workspaceCapture.createMany({ data: captures });
}

async function createUserAndWorkspace() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const result = await authService.register({
    username: `echo_${suffix}`,
    nickname: `Echo ${suffix}`,
    password: 'Passw0rdA',
    email: `echo_${suffix}@example.com`,
  });

  expect(result.success).toBeTruthy();
  const accessToken = result.accessToken!;
  const userId = result.user!.id;
  const workspace = await workspaceService.ensureDefaultWorkspace(userId);
  expect(workspace).not.toBeNull();

  return {
    accessToken,
    userId,
    workspaceId: workspace!.id,
  };
}

test.describe('workspace daily echo route', () => {
  test('generates once per day and skips the second automatic call', async () => {
    const originalFetch = global.fetch;
    const originalApiKey = process.env.COMMONSTACK_ECHO_API_KEY;
    const originalBaseUrl = process.env.COMMONSTACK_ECHO_BASE_URL;
    const originalModel = process.env.COMMONSTACK_ECHO_MODEL;
    const originalNodeEnv = process.env.NODE_ENV;

    setEnv('COMMONSTACK_ECHO_API_KEY', 'test-key');
    setEnv('COMMONSTACK_ECHO_BASE_URL', 'https://api.commonstack.ai/v1');
    setEnv('COMMONSTACK_ECHO_MODEL', 'google/gemini-3-flash');
    setEnv('NODE_ENV', 'test');

    global.fetch = async (input: string | URL | Request) => {
      const url = String(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
      if (url.endsWith('/models')) {
        return new Response(
          JSON.stringify({ data: [{ id: 'google/gemini-3-flash' }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url.endsWith('/chat/completions')) {
        return new Response(
          JSON.stringify({
            id: 'cmpl_echo_1',
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    title: '这条单调性线索值得继续',
                    body: '你今天把课堂原话和讲义里卡住的位置放到了一起，现在顺着这一点继续补，会更快看到联系。',
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    };

    try {
      const { accessToken, workspaceId, userId } = await createUserAndWorkspace();
      await seedEchoCaptures(workspaceId, userId);

      const firstResponse = await refreshDailyEchoPost(buildAuthorizedRequest(accessToken, false));
      expect(firstResponse.status).toBe(200);
      const firstBody = (await firstResponse.json()) as {
        success?: boolean;
        skipped?: boolean;
        echo?: { title?: string; body?: string; sourceKey?: string };
      };

      expect(firstBody.success).toBeTruthy();
      expect(firstBody.skipped).toBeFalsy();
      expect(firstBody.echo?.title).toBe('这条单调性线索值得继续');
      expect(firstBody.echo?.sourceKey).toContain(`daily:${workspaceId}:`);

      const secondResponse = await refreshDailyEchoPost(buildAuthorizedRequest(accessToken, false));
      expect(secondResponse.status).toBe(200);
      const secondBody = (await secondResponse.json()) as { success?: boolean; skipped?: boolean; reason?: string };

      expect(secondBody.success).toBeTruthy();
      expect(secondBody.skipped).toBeTruthy();
      expect(secondBody.reason).toBe('active');
    } finally {
      global.fetch = originalFetch;
      setEnv('COMMONSTACK_ECHO_API_KEY', originalApiKey);
      setEnv('COMMONSTACK_ECHO_BASE_URL', originalBaseUrl);
      setEnv('COMMONSTACK_ECHO_MODEL', originalModel);
      setEnv('NODE_ENV', originalNodeEnv);
    }
  });

  test('parallel automatic refresh only claims one model generation slot', async () => {
    const originalFetch = global.fetch;
    const originalApiKey = process.env.COMMONSTACK_ECHO_API_KEY;
    const originalBaseUrl = process.env.COMMONSTACK_ECHO_BASE_URL;
    const originalModel = process.env.COMMONSTACK_ECHO_MODEL;
    const originalNodeEnv = process.env.NODE_ENV;
    let chatCompletionCalls = 0;

    setEnv('COMMONSTACK_ECHO_API_KEY', 'test-key');
    setEnv('COMMONSTACK_ECHO_BASE_URL', 'https://api.commonstack.ai/v1');
    setEnv('COMMONSTACK_ECHO_MODEL', 'google/gemini-3-flash');
    setEnv('NODE_ENV', 'test');

    global.fetch = async (input: string | URL | Request) => {
      const url = String(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
      if (url.endsWith('/models')) {
        return new Response(
          JSON.stringify({ data: [{ id: 'google/gemini-3-flash' }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url.endsWith('/chat/completions')) {
        chatCompletionCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 40));
        return new Response(
          JSON.stringify({
            id: 'cmpl_echo_parallel',
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    title: '今天先顺着这条记下去',
                    body: '你已经把课堂原话和讲义里的卡点接上了，继续补这一条会比重新开新话题更值。',
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    };

    try {
      const { accessToken, workspaceId, userId } = await createUserAndWorkspace();
      await seedEchoCaptures(workspaceId, userId);

      const [firstResponse, secondResponse] = await Promise.all([
        refreshDailyEchoPost(buildAuthorizedRequest(accessToken, false)),
        refreshDailyEchoPost(buildAuthorizedRequest(accessToken, false)),
      ]);

      expect(firstResponse.status).toBe(200);
      expect(secondResponse.status).toBe(200);
      expect(chatCompletionCalls).toBe(1);

      const [firstBody, secondBody] = (await Promise.all([
        firstResponse.json(),
        secondResponse.json(),
      ])) as Array<{
        success?: boolean;
        skipped?: boolean;
        reason?: string;
        echo?: { title?: string };
      }>;

      expect(firstBody.success).toBeTruthy();
      expect(secondBody.success).toBeTruthy();
      expect([firstBody.skipped, secondBody.skipped].filter(Boolean)).toHaveLength(1);
      expect(
        [firstBody.reason, secondBody.reason].some((reason) => reason === 'pending' || reason === 'active')
      ).toBeTruthy();
      expect([firstBody.echo?.title, secondBody.echo?.title]).toContain('今天先顺着这条记下去');
    } finally {
      global.fetch = originalFetch;
      setEnv('COMMONSTACK_ECHO_API_KEY', originalApiKey);
      setEnv('COMMONSTACK_ECHO_BASE_URL', originalBaseUrl);
      setEnv('COMMONSTACK_ECHO_MODEL', originalModel);
      setEnv('NODE_ENV', originalNodeEnv);
    }
  });

  test('crowded lookback still sends the newest captures into the prompt', async () => {
    const originalFetch = global.fetch;
    const originalApiKey = process.env.COMMONSTACK_ECHO_API_KEY;
    const originalBaseUrl = process.env.COMMONSTACK_ECHO_BASE_URL;
    const originalModel = process.env.COMMONSTACK_ECHO_MODEL;
    const originalNodeEnv = process.env.NODE_ENV;
    let recordedPrompt = '';

    setEnv('COMMONSTACK_ECHO_API_KEY', 'test-key');
    setEnv('COMMONSTACK_ECHO_BASE_URL', 'https://api.commonstack.ai/v1');
    setEnv('COMMONSTACK_ECHO_MODEL', 'google/gemini-3-flash');
    setEnv('NODE_ENV', 'test');

    global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
      if (url.endsWith('/models')) {
        return new Response(
          JSON.stringify({ data: [{ id: 'google/gemini-3-flash' }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url.endsWith('/chat/completions')) {
        const requestBody = JSON.parse(String(init?.body || '{}')) as {
          messages?: Array<{ content?: string }>;
        };
        recordedPrompt = String(requestBody.messages?.[1]?.content || requestBody.messages?.[0]?.content || '');

        return new Response(
          JSON.stringify({
            id: 'cmpl_echo_latest',
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    title: '今天先顺着新线索收',
                    body: '你今天刚补进来的那一下转折感最值钱，先把这条继续收清楚。',
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    try {
      const { accessToken, workspaceId, userId } = await createUserAndWorkspace();
      await seedCrowdedEchoCaptures(workspaceId, userId);

      const response = await refreshDailyEchoPost(buildAuthorizedRequest(accessToken, false));
      expect(response.status).toBe(200);

      const body = (await response.json()) as {
        success?: boolean;
        skipped?: boolean;
        echo?: { title?: string };
      };

      expect(body.success).toBeTruthy();
      expect(body.skipped).toBeFalsy();
      expect(body.echo?.title).toBe('今天先顺着新线索收');
      expect(recordedPrompt).toContain('今天的新线索 1');
      expect(recordedPrompt).toContain('今天的新线索 2');
      expect(recordedPrompt).not.toContain('更早的线索 01');
    } finally {
      global.fetch = originalFetch;
      setEnv('COMMONSTACK_ECHO_API_KEY', originalApiKey);
      setEnv('COMMONSTACK_ECHO_BASE_URL', originalBaseUrl);
      setEnv('COMMONSTACK_ECHO_MODEL', originalModel);
      setEnv('NODE_ENV', originalNodeEnv);
    }
  });

  test('rejects forced manual refresh in production when flag is disabled', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalManualFlag = process.env.ENABLE_ECHO_MANUAL_TRIGGER;

    setEnv('NODE_ENV', 'production');
    delete (process.env as Record<string, string | undefined>).ENABLE_ECHO_MANUAL_TRIGGER;

    try {
      const { accessToken } = await createUserAndWorkspace();
      const response = await refreshDailyEchoPost(buildAuthorizedRequest(accessToken, true));
      expect(response.status).toBe(403);
      const body = (await response.json()) as { success?: boolean; error?: string };
      expect(body.success).toBeFalsy();
      expect(body.error).toContain('未开启');
    } finally {
      setEnv('NODE_ENV', originalNodeEnv);
      setEnv('ENABLE_ECHO_MANUAL_TRIGGER', originalManualFlag);
    }
  });
});
