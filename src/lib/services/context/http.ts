import { getContextConfig } from '@/lib/config/context';
import { createLogger } from '@/lib/logger';
import { authenticateContext, createGrant, listGrants, requireCapability, revokeGrant } from './access';
import { appendContextEvent, eventRecord, getContextEvent, listContextEvents } from './events';
import { controlContextEvent, retryContextEvent } from './controls';
import { prepareContext } from './prepare';
import { ContextError } from './validation';
import { checkRateLimit } from '@/lib/services/rate-limit-service';

const log = createLogger('context-http');

async function readBody(request: Request): Promise<unknown> {
  const max = getContextConfig().maxRequestBytes;
  if (Number(request.headers.get('content-length')) > max) throw new ContextError('request_too_large', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new ContextError('invalid_json', 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw new ContextError('request_too_large', 413);
      }
      chunks.push(part.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    if (error instanceof ContextError) throw error;
    throw new ContextError('invalid_json', 400);
  } finally { reader.releaseLock(); }
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', Vary: 'Authorization' } });
}

/** Framework-neutral HTTP adapter; callers cannot supply a user ID or bank ID. */
export async function handleContextRequest(request: Request, path: string[]): Promise<Response> {
  try {
    const principal = await authenticateContext(request.headers.get('authorization'));
    if (request.method === 'POST') {
      const limit = await checkRateLimit(`context:${principal.userId}`, 'tutor');
      if (!limit.allowed) throw new ContextError('rate_limited', 429);
    }
    const [resource, id, operation] = path;
    const method = request.method;
    const url = new URL(request.url);
    if (path.length === 1 && resource === 'events') {
      if (method === 'POST') return json(await appendContextEvent(principal, await readBody(request)), 202);
      if (method === 'GET') return json(await listContextEvents(principal, url.searchParams.get('cursor') ?? undefined, url.searchParams.get('spaceId') ?? undefined));
    }
    if (path.length === 1 && resource === 'prepare' && method === 'POST') {
      return json(await prepareContext(principal, await readBody(request)));
    }
    if (path.length === 2 && (resource === 'sources' || resource === 'jobs') && method === 'GET') {
      requireCapability(principal, 'read');
      const row = await getContextEvent(principal, id);
      if (!principal.owner && row.visibility !== 'active') throw new ContextError('not_found', 404);
      return json(resource === 'sources' ? { event: eventRecord(row) } : {
        jobId: row.id, eventId: row.id, status: row.deliveryStatus, visibility: row.visibility,
        cleanupPending: row.cleanupPending, errorCode: row.lastErrorCode,
      });
    }
    if (path.length === 2 && resource === 'sources' && method === 'PATCH') {
      return json(await controlContextEvent(principal, id, await readBody(request)));
    }
    if (path.length === 3 && resource === 'jobs' && operation === 'retry' && method === 'POST') {
      return json(await retryContextEvent(principal, id), 202);
    }
    if (path.length === 1 && resource === 'grants') {
      if (method === 'POST') return json(await createGrant(principal, await readBody(request)), 201);
      if (method === 'GET') return json(await listGrants(principal));
    }
    if (path.length === 2 && resource === 'grants' && method === 'DELETE') {
      await revokeGrant(principal, id);
      return json({ revoked: true });
    }
    throw new ContextError('not_found', 404);
  } catch (error) {
    if (error instanceof ContextError) return json({ error: { code: error.code } }, error.status);
    log.error('Context request failed', { code: 'internal_error' });
    return json({ error: { code: 'internal_error' } }, 500);
  }
}
