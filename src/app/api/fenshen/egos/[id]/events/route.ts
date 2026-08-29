import { getEgo, readEgoEvents } from '@/lib/services/fenshen/thread-store';

/**
 * GET /api/fenshen/egos/[id]/events —— 事件日志全量回放（历史恢复）。
 *
 * 事件日志是 append-only JSONL（data/fenshen-events/<egoId>.jsonl），含 SSE
 * 契约事件 + user-message 记录（只落盘不广播）。前端打开分身时先拉这里重建
 * 历史（蒸馏进度 + 对话），再订阅 /stream 续接实时事件；断线重连后也靠它
 * 重放追齐。回放幂等，路由是薄壳。
 */

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const ego = await getEgo(params.id);
  if (!ego) return Response.json({ error: '分身不存在' }, { status: 404 });
  const events = await readEgoEvents(ego.id);
  return Response.json({ events });
}
