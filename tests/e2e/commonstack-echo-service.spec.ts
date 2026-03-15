import { expect, test } from '@playwright/test';
import { generateCommonstackEcho } from '../../src/lib/services/commonstack-echo-service';

function setEnv(name: string, value: string | undefined) {
  (process.env as Record<string, string | undefined>)[name] = value;
}

test.describe('commonstack echo service', () => {
  test('uses a system role and low temperature for daily echo generation', async () => {
    const originalFetch = global.fetch;
    const originalApiKey = process.env.COMMONSTACK_ECHO_API_KEY;
    const originalBaseUrl = process.env.COMMONSTACK_ECHO_BASE_URL;
    const originalModel = process.env.COMMONSTACK_ECHO_MODEL;
    const originalTemperature = process.env.COMMONSTACK_ECHO_TEMPERATURE;
    let requestBody: Record<string, unknown> | null = null;

    setEnv('COMMONSTACK_ECHO_API_KEY', 'test-key');
    setEnv('COMMONSTACK_ECHO_BASE_URL', 'https://api.commonstack.ai/v1');
    setEnv('COMMONSTACK_ECHO_MODEL', 'google/gemini-3-flash-preview');

    global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);

      if (url.endsWith('/models')) {
        return new Response(
          JSON.stringify({ data: [{ id: 'google/gemini-3-flash-preview' }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url.endsWith('/chat/completions')) {
        requestBody = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            id: 'cmpl_echo_service',
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    title: '顺着这条线继续记',
                    body: '导数和单调性的那条逻辑链已经冒头了，今天回来把它补全更值。',
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
      const result = await generateCommonstackEcho({
        prompt: '输出纯 JSON：{"title": string, "body": string}',
      });

      expect(result.model).toBe('google/gemini-3-flash-preview');
      expect(result.content.title).toBe('顺着这条线继续记');
      expect(result.content.body).toContain('导数和单调性');
      expect(requestBody).not.toBeNull();
      if (!requestBody) {
        throw new Error('Expected CommonStack request body to be recorded');
      }
      const body = requestBody as {
        temperature?: number;
        model?: string;
        messages?: Array<{ role?: string; content?: string }>;
      };
      expect(body.temperature).toBe(0.2);
      expect(body.model).toBe('google/gemini-3-flash-preview');
      expect(Array.isArray(body.messages)).toBeTruthy();

      const messages = body.messages as Array<{ role?: string; content?: string }>;
      expect(messages).toHaveLength(2);
      expect(messages[0]?.role).toBe('system');
      expect(messages[0]?.content).toContain('中文学习回声编辑');
      expect(messages[1]?.role).toBe('user');
      expect(messages[1]?.content).toContain('输出纯 JSON');
    } finally {
      global.fetch = originalFetch;
      setEnv('COMMONSTACK_ECHO_API_KEY', originalApiKey);
      setEnv('COMMONSTACK_ECHO_BASE_URL', originalBaseUrl);
      setEnv('COMMONSTACK_ECHO_MODEL', originalModel);
      setEnv('COMMONSTACK_ECHO_TEMPERATURE', originalTemperature);
    }
  });

  test('respects COMMONSTACK_ECHO_TEMPERATURE override', async () => {
    const originalFetch = global.fetch;
    const originalApiKey = process.env.COMMONSTACK_ECHO_API_KEY;
    const originalBaseUrl = process.env.COMMONSTACK_ECHO_BASE_URL;
    const originalModel = process.env.COMMONSTACK_ECHO_MODEL;
    const originalTemperature = process.env.COMMONSTACK_ECHO_TEMPERATURE;
    let requestBody: Record<string, unknown> | null = null;

    setEnv('COMMONSTACK_ECHO_API_KEY', 'test-key');
    setEnv('COMMONSTACK_ECHO_BASE_URL', 'https://api.commonstack.ai/v1');
    setEnv('COMMONSTACK_ECHO_MODEL', 'google/gemini-3-flash-preview');
    setEnv('COMMONSTACK_ECHO_TEMPERATURE', '0.35');

    global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);

      if (url.endsWith('/models')) {
        return new Response(
          JSON.stringify({ data: [{ id: 'google/gemini-3-flash-preview' }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url.endsWith('/chat/completions')) {
        requestBody = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            id: 'cmpl_echo_service_temp',
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    title: '顺着这条线继续记',
                    body: '导数和单调性的那条逻辑链已经冒头了，今天回来把它补全更值。',
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
      await generateCommonstackEcho({
        prompt: '输出纯 JSON：{"title": string, "body": string}',
      });

      expect(requestBody).not.toBeNull();
      if (!requestBody) {
        throw new Error('Expected CommonStack request body to be recorded');
      }
      const body = requestBody as {
        temperature?: number;
      };
      expect(body.temperature).toBe(0.35);
    } finally {
      global.fetch = originalFetch;
      setEnv('COMMONSTACK_ECHO_API_KEY', originalApiKey);
      setEnv('COMMONSTACK_ECHO_BASE_URL', originalBaseUrl);
      setEnv('COMMONSTACK_ECHO_MODEL', originalModel);
      setEnv('COMMONSTACK_ECHO_TEMPERATURE', originalTemperature);
    }
  });
});
