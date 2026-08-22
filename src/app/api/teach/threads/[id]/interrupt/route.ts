import {
  interruptTeachThread,
  preflightTeach,
  TeachServiceError,
} from '@/lib/services/teach-codex/teach-session-service';

/**
 * POST /api/teach/threads/[id]/interrupt —— 打断当前 turn。
 *
 * body: {text?}。收到即 turn/interrupt（"当前句讲完"的打断时机由前端控制）；
 * 附带 text 时，等 interrupted 落地后同线程以学生消息续讲（上下文保留）。
 * 事件（interrupted → 新 turn 的 text-delta…）同样经 GET .../stream 流出。
 */

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const preflight = preflightTeach();
  if (!preflight.ok) return Response.json({ error: preflight.error }, { status: 500 });

  let body: { text?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // 空 body 也合法（纯打断）
  }
  const text = typeof body.text === 'string' ? body.text.trim() : undefined;

  try {
    await interruptTeachThread(params.id, text);
    return Response.json({ ok: true });
  } catch (cause) {
    if (cause instanceof TeachServiceError) {
      return Response.json({ error: cause.message, code: cause.code }, { status: cause.status });
    }
    return Response.json({ error: 'failed' }, { status: 500 });
  }
}
