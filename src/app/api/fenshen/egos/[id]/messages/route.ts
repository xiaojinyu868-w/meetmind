import {
  sendFenshenMessage,
} from '@/lib/services/fenshen/fenshen-session-service';
import { preflightFenshen } from '@/lib/services/fenshen/distill-service';
import { FenshenServiceError } from '@/lib/services/fenshen/thread-store';

/**
 * POST /api/fenshen/egos/[id]/messages —— 与分身对话（试听与正式聊天同一条）。
 *
 * body: {text}（≤2000字）。返回 {ok:true} 表示 codex 已收下本轮；
 * 该轮所有事件经 GET .../stream 的 SSE 流出（本路由自身不流式）。
 * 分身未 ready 或正在讲时返回 409（后者先 interrupt 或等 turn-complete）。
 */

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const preflight = preflightFenshen();
  if (!preflight.ok) return Response.json({ error: preflight.error }, { status: 500 });

  let body: { text?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: '请求体必须是 JSON' }, { status: 400 });
  }
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text || text.length > 2000) {
    return Response.json({ error: '需要 text（≤2000字）' }, { status: 400 });
  }

  try {
    await sendFenshenMessage(params.id, text);
    return Response.json({ ok: true });
  } catch (cause) {
    if (cause instanceof FenshenServiceError) {
      return Response.json({ error: cause.message, code: cause.code }, { status: cause.status });
    }
    return Response.json({ error: 'failed' }, { status: 500 });
  }
}
