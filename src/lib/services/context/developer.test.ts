import { describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ContextClient, ContextClientError } from '../../../../packages/context-sdk/src';
import { createContextMcp } from '../../../../packages/context-mcp/server';

describe('portable developer clients', () => {
  it('preserves the event identity and transports a scoped credential without a user override', async () => {
    const fetcher = vi.fn(async () => Response.json({ eventId: 'event', duplicate: false, status: 'queued' }));
    const client = new ContextClient({ baseUrl: 'http://local/api/context/v1/', token: () => 'mmctx_test', fetch: fetcher });
    const event = { schemaVersion: 1 as const, clientEventId: 'one', type: 'quiz.answer', content: 'User answer: 1/2', occurredAt: '2026-09-05T00:00:00Z' };
    await client.append(event);
    await client.append(event);
    const calls = fetcher.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls[0][0]).toBe(calls[1][0]);
    expect(calls[0][1].body).toBe(calls[1][1].body);
    const [url, request] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://local/api/context/v1/events');
    expect(request.headers).toMatchObject({ Authorization: 'Bearer mmctx_test' });
    expect(JSON.parse(String(request.body))).toEqual(event);
  });

  it('surfaces a revoked credential and never retries authorization creation automatically', async () => {
    const fetcher = vi.fn(async () => Response.json({ error: { code: 'unauthorized' } }, { status: 401 }));
    const client = new ContextClient({ baseUrl: 'http://local/api/context/v1', token: 'mmctx_test', fetch: fetcher });
    await expect(client.grant({ appId: 'quiz', label: 'Quiz', capabilities: ['read'], spaceIds: ['personal'] })).rejects.toBeInstanceOf(ContextClientError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('completes an official MCP handshake and exposes only scoped context tools', async () => {
    const fetched: string[] = [];
    const client = new ContextClient({
      baseUrl: 'http://local/api/context/v1', token: 'mmctx_test',
      fetch: vi.fn(async (url) => {
        fetched.push(String(url));
        return Response.json({ schemaVersion: 1, memories: [], observations: [], degraded: false });
      }),
    });
    const server = createContextMcp(client);
    const agent = new Client({ name: 'independent-test-app', version: '1.0.0' });
    const [left, right] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([server.connect(left), agent.connect(right)]);
      const list = await agent.listTools();
      expect(list.tools.map((tool) => tool.name).sort()).toEqual(['context_append', 'context_job', 'context_prepare', 'context_source']);
      const result = await agent.callTool({ name: 'context_prepare', arguments: { intent: 'Prepare a probability quiz' } });
      expect(result.isError).not.toBe(true);
      expect(fetched).toEqual(['http://local/api/context/v1/prepare']);
      const missing = await agent.callTool({ name: 'context_create_grant', arguments: {} });
      expect(missing.isError).toBe(true);
    } finally { await Promise.all([agent.close(), server.close()]); }
  });
});
