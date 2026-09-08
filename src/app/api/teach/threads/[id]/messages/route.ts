import {
  sendTeachMessage,
  preflightTeach,
  TeachServiceError,
} from '@/lib/services/teach-codex/teach-session-service';
import {
  sendTeachEngineMessage,
  preflightTeachEngine,
  TeachEngineError,
} from '@/lib/services/teach-engine/teach-engine-service';
import { getThread } from '@/lib/services/teach-codex/thread-store';

/**
 * POST /api/teach/threads/[id]/messages —— 发学生消息 / 开始讲课。
 *
 * body: {text}（≤2000字）。返回 {ok:true} 表示底座已收下本轮；
 * 该轮所有事件经 GET .../stream 的 SSE 流出（本路由自身不流式）。
 * 老师正在讲时返回 409（先 interrupt 或等 turn-complete）。
 *
 * 引擎分发（P1-B）：按线程 TeachThread.engine 归属分发——engine='engine'
 * 走 teach-engine（pi loop），其余（codex / null 旧线程）走 codex 底座；
 * 错误码、409 语义、响应形状两侧完全一致，路由仍是薄壳。
 */

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const row = await getThread(params.id);
  if (!row) {
    return Response.json({ error: '课程不存在', code: 'thread-not-found' }, { status: 404 });
  }
  const useEngine = row.engine === 'engine';
  const preflight = useEngine ? preflightTeachEngine() : preflightTeach();
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
    if (useEngine) await sendTeachEngineMessage(params.id, text);
    else await sendTeachMessage(params.id, text);
    return Response.json({ ok: true });
  } catch (cause) {
    if (cause instanceof TeachServiceError || cause instanceof TeachEngineError) {
      return Response.json({ error: cause.message, code: cause.code }, { status: cause.status });
    }
    return Response.json({ error: 'failed' }, { status: 500 });
  }
}
