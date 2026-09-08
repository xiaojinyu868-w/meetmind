import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { ContextEventInput, UserContextBundle } from '../../packages/context-sdk/src';

/** Uses the distributed stdio entrypoint and the actual HTTP server, without mocks. */
export async function verifyMcpProcess(base: string, token: string, event: ContextEventInput): Promise<void> {
  const agent = new Client({ name: 'context-smoke', version: '1' });
  const env: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  const transport = new StdioClientTransport({
    command: process.execPath, args: ['--import', 'tsx', 'packages/context-mcp/main.ts'],
    env: { ...env, MEETMIND_CONTEXT_URL: `${base}/api/context/v1`, MEETMIND_CONTEXT_TOKEN: token }, stderr: 'pipe',
  });
  try {
    await agent.connect(transport);
    const { schemaVersion: _version, ...input } = event;
    const appended = await agent.callTool({ name: 'context_append', arguments: input });
    assert(!appended.isError);
    const receipt = JSON.parse(textResult(appended.content));
    assert.equal(receipt.duplicate, true);
    const recalled = await agent.callTool({ name: 'context_prepare', arguments: { intent: '继续下一次练习', maxTokens: 8_000 } });
    assert(!recalled.isError);
    const bundle = JSON.parse(textResult(recalled.content)) as UserContextBundle;
    assert(bundle.observations.some((observation) => observation.id === receipt.eventId));
    const source = await agent.callTool({ name: 'context_source', arguments: { eventId: receipt.eventId } });
    assert(!source.isError);
    assert.equal(JSON.parse(textResult(source.content)).event.content, event.content);
  } finally { await agent.close(); await transport.close(); }
}

function textResult(content: unknown): string {
  assert(Array.isArray(content));
  const block = content.find((item) => item.type === 'text');
  assert(block && typeof block.text === 'string');
  return block.text;
}
