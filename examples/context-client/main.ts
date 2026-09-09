import { readFile } from 'node:fs/promises';
import { ContextClient, ContextClientError } from '../../packages/context-sdk/src';

/** A separate application process. No Prisma, MeetMind login code, or model SDK. */
async function main(): Promise<void> {
  const token = process.env.MEETMIND_CONTEXT_TOKEN ?? '';
  const baseUrl = process.env.MEETMIND_CONTEXT_URL ?? '';
  if (!token.startsWith('mmctx_') || !baseUrl) throw new Error('context_grant_configuration_required');
  const client = new ContextClient({ baseUrl, token });
  const intent = process.env.MEETMIND_CONTEXT_TASK ?? 'Prepare the next learning activity using relevant prior context.';
  // Only an explicitly supplied event file is written; never invent a learning result.
  const eventPath = process.env.MEETMIND_CONTEXT_EVENT_PATH;
  const receipt = eventPath ? await client.append(JSON.parse(await readFile(eventPath, 'utf8'))) : undefined;
  const bundle = await client.prepare({ task: { intent }, ...(receipt ? { afterEventId: receipt.eventId } : {}) });
  process.stdout.write(`${JSON.stringify(bundle, null, 2)}\n`);
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof ContextClientError ? error.code : 'context_example_failed'}\n`);
  process.exitCode = 1;
});
