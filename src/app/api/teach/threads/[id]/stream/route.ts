import { subscribeTeachThread, type TeachStreamEvent } from '@/lib/services/teach-codex/event-bus';
import { getThread } from '@/lib/services/teach-codex/thread-store';

/**
 * GET /api/teach/threads/[id]/stream —— 线程事件 SSE 订阅（EventSource 友好）。
 *
 * 连接建立即发 {type:'thread',threadId}，随后实时扇出该线程的所有事件
 * （text-delta / tool-call / tool-result / turn-complete / interrupted /
 * image-ready / error）。长连接跨 turn 存活；25s 心跳注释行防代理断连。
 */

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const thread = await getThread(params.id);
  if (!thread) return Response.json({ error: '课程不存在' }, { status: 404 });

  const threadId = thread.id;
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: TeachStreamEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      send({ type: 'thread', threadId });
      unsubscribe = subscribeTeachThread(threadId, send);
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
