import { streamTeachLesson } from '@/lib/services/teach-agent/teach-agent-service';
import { createLogger } from '@/lib/logger';

/**
 * POST /api/board/teach-agent —— agent 驱动板书课（SSE）
 *
 * { topic, material? } → text/event-stream：
 *   data: {"type":"meta","model"}
 *   data: {"type":"text","text"}            ← 讲解文本 delta（老师说的话）
 *   data: {"type":"tool","tool","ok"}       ← 板书动作进度
 *   data: {"type":"image","done","total"}   ← 插图生成进度
 *   data: {"type":"done","title","script",…} ← BoardScript，交给现有播放器
 *   data: {"type":"error","error":"failed"}
 *
 * v28：一节课 = 一次 streamText agent 运行（kimi-k3 + 11 个原子板书工具），
 * 轨迹即 AI SDK messages，walker 装配成 BoardScript。messages 不转发给前端。
 */

const log = createLogger('api-board-teach-agent');

export async function POST(request: Request) {
  let body: { topic?: unknown; material?: unknown; model?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: '请求体必须是 JSON' }, { status: 400 });
  }

  const topic = typeof body.topic === 'string' ? body.topic.trim() : '';
  if (!topic || topic.length > 100) {
    return Response.json({ error: '需要 topic（≤100字）' }, { status: 400 });
  }
  const material = typeof body.material === 'string' ? body.material.slice(0, 8000) : undefined;
  const model = typeof body.model === 'string' ? body.model.trim() : undefined;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };
      try {
        for await (const event of streamTeachLesson({ topic, material, model })) {
          // messages（完整轨迹）只在服务端落盘/续讲用，不下发前端
          if (event.type === 'done') {
            const { messages: _messages, ...rest } = event;
            send(rest);
            continue;
          }
          send(event);
        }
      } catch (cause) {
        log.error('teach-agent failed', {
          error: cause instanceof Error ? cause.message : String(cause),
        });
        send({ type: 'error', error: 'failed' });
      } finally {
        controller.close();
      }
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
