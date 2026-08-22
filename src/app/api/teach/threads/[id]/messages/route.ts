import {
  sendTeachMessage,
  preflightTeach,
  TeachServiceError,
} from '@/lib/services/teach-codex/teach-session-service';

/**
 * POST /api/teach/threads/[id]/messages —— 发学生消息 / 开始讲课。
 *
 * body: {text}（≤2000字）。返回 {ok:true} 表示 codex 已收下本轮；
 * 该轮所有事件经 GET .../stream 的 SSE 流出（本路由自身不流式）。
 * 老师正在讲时返回 409（先 interrupt 或等 turn-complete）。
 */

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const preflight = preflightTeach();
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
    await sendTeachMessage(params.id, text);
    return Response.json({ ok: true });
  } catch (cause) {
    if (cause instanceof TeachServiceError) {
      return Response.json({ error: cause.message, code: cause.code }, { status: cause.status });
    }
    return Response.json({ error: 'failed' }, { status: 500 });
  }
}
