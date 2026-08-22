import { createLogger } from '@/lib/logger';
import { checkTeachInternalToken } from '@/lib/services/teach-codex/internal-auth';
import { handleMcpToolCall } from '@/lib/services/teach-codex/teach-session-service';

/**
 * POST /api/teach/internal/tool —— MCP server 工具回调（tools/call）。
 *
 * body: {threadId, name, args} → {result}（BoardEnv digest）。
 * 内部路由：x-teach-internal 共享令牌鉴权。事件（tool-call/tool-result）
 * 由 handleMcpToolCall 进事件总线 → SSE 扇出。
 */

const log = createLogger('api-teach-internal-tool');

export async function POST(request: Request) {
  if (!checkTeachInternalToken(request)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: { threadId?: unknown; name?: unknown; args?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: '请求体必须是 JSON' }, { status: 400 });
  }
  const threadId = typeof body.threadId === 'string' ? body.threadId : '';
  const name = typeof body.name === 'string' ? body.name : '';
  if (!threadId || !name) {
    return Response.json({ error: '需要 threadId 与 name' }, { status: 400 });
  }
  const args =
    body.args !== null && typeof body.args === 'object' && !Array.isArray(body.args)
      ? (body.args as Record<string, unknown>)
      : {};

  try {
    const result = await handleMcpToolCall(threadId, name, args);
    return Response.json({ result });
  } catch (cause) {
    log.error('tool call failed', {
      threadId,
      name,
      error: cause instanceof Error ? cause.message : String(cause),
    });
    return Response.json({ error: 'failed' }, { status: 500 });
  }
}
