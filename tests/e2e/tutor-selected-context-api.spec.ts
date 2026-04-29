import { expect, test } from '@playwright/test';
import { NextRequest } from 'next/server';
import { POST as tutorPost } from '../../src/app/api/(meetmind-learning)/tutor/route';

function setEnv(name: string, value: string | undefined) {
  (process.env as Record<string, string | undefined>)[name] = value;
}

test.describe('tutor selected context route', () => {
  test('accepts single selected-context segment without forcing timeline transcript mode', async () => {
    const originalFetch = global.fetch;
    const originalApiKey = process.env.DASHSCOPE_API_KEY;
    const originalBaseUrl = process.env.LLM_BASE_URL;
    let llmRequestBody: Record<string, unknown> | null = null;

    setEnv('DASHSCOPE_API_KEY', 'test-key');
    setEnv('LLM_BASE_URL', 'https://dashscope.aliyuncs.com/compatible-mode/v1');

    global.fetch = async (_input: string | URL | Request, init?: RequestInit) => {
      llmRequestBody = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;

      return new Response(
        [
          'data: {"choices":[{"delta":{"content":"先顺着这条内容讲清楚它在表达什么。"}}]}',
          '',
          'data: [DONE]',
          '',
        ].join('\n'),
        {
          status: 200,
          headers: {
            'Content-Type': 'text/event-stream',
          },
        }
      );
    };

    try {
      const request = new NextRequest('http://localhost/api/tutor', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          timestamp: 0,
          segments: [
            {
              id: '__support_context__',
              text: `【增强资料】
以下是用户刚刚主动圈出来的上下文。请先围绕“这次主要内容”理解问题，再参考后面的补充内容，不要把未选内容当成当前重点。

【这次主要内容｜文字】MeetMind 是一款基于“认知孪生”理念的数字导师。
MeetMind 会在一次次收集中沉淀专属学习上下文，再顺着这些上下文继续带用户理解。`,
              startMs: 0,
              endMs: 1,
            },
          ],
          model: 'qwen3.5-plus',
          studentQuestion: '顺着这条内容继续帮我讲清楚，它最核心在说什么？',
          globalMode: true,
          selected_context_mode: true,
          stream: true,
        }),
      });

      const response = await tutorPost(request);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type') || '').toContain('text/event-stream');

      const streamText = await response.text();
      expect(streamText).toContain('先顺着这条内容讲清楚它在表达什么');

      const capturedRequest = llmRequestBody as { messages?: Array<{ role?: string; content?: string }> } | null;
      const messages = Array.isArray(capturedRequest?.messages)
        ? capturedRequest.messages
        : [];
      const systemMessage = messages.find((message) => message.role === 'system');
      const userMessage = messages.find((message) => message.role === 'user');

      expect(systemMessage?.content || '').toContain('没有完整时间轴也要直接回答');
      expect(userMessage?.content || '').toContain('【用户刚圈出的上下文】');
      expect(userMessage?.content || '').not.toContain('[00:00]');
    } finally {
      global.fetch = originalFetch;
      setEnv('DASHSCOPE_API_KEY', originalApiKey);
      setEnv('LLM_BASE_URL', originalBaseUrl);
    }
  });
});
