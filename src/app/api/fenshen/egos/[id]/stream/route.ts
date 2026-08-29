import { subscribeFenshenEgo, type FenshenStreamEvent } from '@/lib/services/fenshen/event-bus';
import { getEgo } from '@/lib/services/fenshen/thread-store';

/**
 * GET /api/fenshen/egos/[id]/stream —— 分身事件 SSE 订阅（EventSource 友好）。
 *
 * 蒸馏进度与对话共用一条订阅。连接建立即发 {type:'thread',threadId}，
 * 随后实时扇出该分身的所有事件（text-delta / distill-progress / ego-ready /
 * turn-complete / interrupted / error）。长连接跨 turn 存活；25s 心跳注释行
 * 防代理断连。
 */

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const ego = await getEgo(params.id);
  if (!ego) return Response.json({ error: '分身不存在' }, { status: 404 });

  const egoId = ego.id;
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: FenshenStreamEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      send({ type: 'thread', threadId: egoId });
      unsubscribe = subscribeFenshenEgo(egoId, send);
      heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(': ping\n\n'));
      }, 25_000);
    },
    cancel() {
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
