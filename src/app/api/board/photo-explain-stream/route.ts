import { streamPhotoLecture } from '@/lib/services/photo-lecture-stream-service';
import { createLogger } from '@/lib/logger';

/**
 * POST /api/board/photo-explain-stream —— 拍题开讲·流式版（SSE）
 *
 * { image: dataURL } → text/event-stream：
 *   data: {"type":"meta","title","totalUnits"}
 *   data: {"type":"unit","pageIndex,"page"}        ← 第一单元到达即可开播
 *   data: {"type":"unit-error","pageIndex"}        ← 单单元失败不阻断
 *   data: {"type":"error","error":"not_a_problem"} ← 照片无题（或大纲失败）
 *   data: {"type":"done","model"}
 *
 * 与 /api/board/photo-explain（one-shot 整份）并存：BOARD_PHOTO_MODE=stream
 * 时前端走这里；整份模式作为降级与对比。
 */

const log = createLogger('api-board-photo-stream');

const MAX_IMAGE_CHARS = 6_000_000;

export async function POST(request: Request) {
  let body: { image?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: '请求体必须是 JSON' }, { status: 400 });
  }

  const { image } = body;
  if (typeof image !== 'string' || !image.startsWith('data:image/') || image.length > MAX_IMAGE_CHARS) {
    return Response.json({ error: '需要 image（data:image/...，≤4.5MB）' }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };
      try {
        for await (const event of streamPhotoLecture(image)) {
          send(event);
        }
      } catch (cause) {
        log.error('photo-explain-stream failed', {
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
