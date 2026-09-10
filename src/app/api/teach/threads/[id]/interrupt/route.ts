import {
  interruptTeachThread,
  preflightTeach,
  TeachServiceError,
} from '@/lib/services/teach-codex/teach-session-service';
import {
  interruptTeachEngineThread,
  preflightTeachEngine,
  TeachEngineError,
} from '@/lib/services/teach-engine/teach-engine-service';
import {
  interruptTeachLiveThread,
  preflightTeachLive,
  TeachLiveError,
} from '@/lib/services/teach-live/teach-live-service';
import { getThread } from '@/lib/services/teach-codex/thread-store';

/**
 * POST /api/teach/threads/[id]/interrupt —— 打断当前 turn。
 *
 * body: {text?}。收到即打断（"当前句讲完"的打断时机由前端控制）；
 * 附带 text 时，等 interrupted 落地后同线程以学生消息续讲（上下文保留）。
 * 事件（interrupted → 新 turn 的 text-delta…）同样经 GET .../stream 流出。
 *
 * 引擎分发：同 messages 路由，按 TeachThread.engine 归属（live / engine / codex）分发。
 */

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const row = await getThread(params.id);
  if (!row) {
    return Response.json({ error: '课程不存在', code: 'thread-not-found' }, { status: 404 });
  }
  const engine = row.engine === 'live' ? 'live' : row.engine === 'engine' ? 'engine' : 'codex';
  const preflight =
    engine === 'live' ? preflightTeachLive() : engine === 'engine' ? preflightTeachEngine() : preflightTeach();
  if (!preflight.ok) return Response.json({ error: preflight.error }, { status: 500 });

  let body: { text?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // 空 body 也合法（纯打断）
  }
  const text = typeof body.text === 'string' ? body.text.trim() : undefined;

  try {
    if (engine === 'live') await interruptTeachLiveThread(params.id, text);
    else if (engine === 'engine') await interruptTeachEngineThread(params.id, text);
    else await interruptTeachThread(params.id, text);
    return Response.json({ ok: true });
  } catch (cause) {
    if (cause instanceof TeachServiceError || cause instanceof TeachEngineError || cause instanceof TeachLiveError) {
      return Response.json({ error: cause.message, code: cause.code }, { status: cause.status });
    }
    return Response.json({ error: 'failed' }, { status: 500 });
  }
}
