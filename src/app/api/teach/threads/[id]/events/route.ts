import { scheduleTeachImageBackfill } from '@/lib/services/teach-codex/image-backfill';
import { scheduleMissingLiveImages } from '@/lib/services/teach-live/live-image';
import { getThread, readThreadEvents } from '@/lib/services/teach-codex/thread-store';

/**
 * GET /api/teach/threads/[id]/events —— 线程事件日志回放（薄路由）。
 *
 * 历史课程恢复用：返回 data/teach-events/<id>.jsonl 的全部记录
 * （契约事件 + student-message），前端按序回放重建对话与画布终态，
 * 再订阅 GET .../stream 续讲。无快照格式——事件日志即单一事实源。
 *
 * 顺带自愈：历史 image 调用 / image 块缺配图时后台触发生图（不阻塞响应；
 * 完成后追加 image-ready 事件，刷新或 SSE 在线即可见）。live 线程走
 * teach-live/live-image，其余走 teach-codex/image-backfill。
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const thread = await getThread(params.id);
  if (!thread) return Response.json({ error: '课程不存在' }, { status: 404 });
  const events = await readThreadEvents(thread.id);
  if (thread.engine === 'live') scheduleMissingLiveImages(thread.id, events);
  else void scheduleTeachImageBackfill(thread.id, events);
  return Response.json({ events, engine: thread.engine ?? 'codex', title: thread.title, topic: thread.topic });
}
