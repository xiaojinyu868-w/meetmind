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
import {
  sendTeachLiveMessage,
  preflightTeachLive,
  TeachLiveError,
} from '@/lib/services/teach-live/teach-live-service';
import { getThread } from '@/lib/services/teach-codex/thread-store';

/**
 * POST /api/teach/threads/[id]/messages —— 发学生消息 / 开始讲课。
 *
 * body: {text, boardNote?}（≤2000字；boardNote 仅 live 线：前端报告的板上情况，只进模型上下文）。返回 {ok:true} 表示底座已收下本轮；
 * 该轮所有事件经 GET .../stream 的 SSE 流出（本路由自身不流式）。
 * 老师正在讲时返回 409（先 interrupt 或等 turn-complete）。
 *
 * 引擎分发：按线程 TeachThread.engine 归属——'live' 走 teach-live（标签流舞台引擎），
 * 'engine' 走 teach-engine（pi loop），其余（codex / null 旧线程）走 codex 底座；
 * 错误码、409 语义、响应形状三侧完全一致，路由仍是薄壳。
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

  let body: { text?: unknown; boardNote?: unknown };
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
    if (engine === 'live') await sendTeachLiveMessage(params.id, text, typeof body.boardNote === 'string' ? body.boardNote : undefined);
    else if (engine === 'engine') await sendTeachEngineMessage(params.id, text);
    else await sendTeachMessage(params.id, text);
    return Response.json({ ok: true });
  } catch (cause) {
    if (cause instanceof TeachServiceError || cause instanceof TeachEngineError || cause instanceof TeachLiveError) {
      return Response.json({ error: cause.message, code: cause.code }, { status: cause.status });
    }
    return Response.json({ error: 'failed' }, { status: 500 });
  }
}
