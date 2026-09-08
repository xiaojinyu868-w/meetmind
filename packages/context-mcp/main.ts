import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ContextClient } from '../context-sdk/src';
import { createContextMcp } from './server';

async function main(): Promise<void> {
  const token = process.env.MEETMIND_CONTEXT_TOKEN ?? '';
  const baseUrl = process.env.MEETMIND_CONTEXT_URL ?? '';
  // Owner credentials are deliberately excluded from a third-party agent process.
  if (!token.startsWith('mmctx_') || !baseUrl) throw new Error('context_grant_configuration_required');
  const server = createContextMcp(new ContextClient({ baseUrl, token }));
  await server.connect(new StdioServerTransport());
}

void main().catch(() => { process.exitCode = 1; });
