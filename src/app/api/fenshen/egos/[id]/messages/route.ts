import { parseLessonSnapshot } from '@/lib/services/fenshen/lesson-context-service';
import { sendFenshenMessage } from '@/lib/services/fenshen/fenshen-session-service';
import { preflightFenshen } from '@/lib/services/fenshen/distill-service';
import { FenshenServiceError } from '@/lib/services/fenshen/thread-store';

/**
 * POST /api/fenshen/egos/[id]/messages —— 与分身对话（试听与正式聊天同一条）。
 *
 * body: {text}（≤2000字），可选 {sessionId}（用户当前复习页的课程会话——
 * 分身按这节课物化上下文，不传则回退全库最新）。返回 {ok:true} 表示 codex
 * 已收下本轮；该轮所有事件经 GET .../stream 的 SSE 流出（本路由自身不流式）。
 * 分身未 ready 或正在讲时返回 409（后者先 interrupt 或等 turn-complete）。
 */

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const preflight = preflightFenshen();
  if (!preflight.ok) return Response.json({ error: preflight.error }, { status: 500 });

  let body: { text?: unknown; sessionId?: unknown; lessonSnapshot?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: '请求体必须是 JSON' }, { status: 400 });
  }
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text || text.length > 2000) {
    return Response.json({ error: '需要 text（≤2000字）' }, { status: 400 });
  }
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
  const lessonSnapshot = parseLessonSnapshot(body.lessonSnapshot);

  try {
    await sendFenshenMessage(params.id, text, sessionId ? { sessionId, lessonSnapshot } : {});
    return Response.json({ ok: true });
  } catch (cause) {
    if (cause instanceof FenshenServiceError) {
      return Response.json({ error: cause.message, code: cause.code }, { status: cause.status });
    }
    return Response.json({ error: 'failed' }, { status: 500 });
  }
}
