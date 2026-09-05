import { parseLessonSnapshot } from '@/lib/services/fenshen/lesson-context-service';
import { interruptFenshenChat } from '@/lib/services/fenshen/fenshen-session-service';
import { preflightFenshen } from '@/lib/services/fenshen/distill-service';
import { FenshenServiceError } from '@/lib/services/fenshen/thread-store';

/**
 * POST /api/fenshen/egos/[id]/interrupt —— 打断分身当前 turn。
 *
 * body: {text?, sessionId?}。收到即 turn/interrupt；附带 text 时，等 interrupted
 * 落地后同线程以学生消息续讲（上下文保留；sessionId 用于按这节课重刷物化文件）。
 * 事件（interrupted → 新 turn 的 text-delta…）同样经 GET .../stream 流出。
 */

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const preflight = preflightFenshen();
  if (!preflight.ok) return Response.json({ error: preflight.error }, { status: 500 });

  let body: { text?: unknown; sessionId?: unknown; lessonSnapshot?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // 空 body 也合法（纯打断）
  }
  const text = typeof body.text === 'string' ? body.text.trim() : undefined;
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
  const lessonSnapshot = parseLessonSnapshot(body.lessonSnapshot);

  try {
    await interruptFenshenChat(params.id, text, sessionId ? { sessionId, lessonSnapshot } : {});
    return Response.json({ ok: true });
  } catch (cause) {
    if (cause instanceof FenshenServiceError) {
      return Response.json({ error: cause.message, code: cause.code }, { status: cause.status });
    }
    return Response.json({ error: 'failed' }, { status: 500 });
  }
}
