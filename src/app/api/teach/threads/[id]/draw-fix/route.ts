import { appendThreadEvent, getThread } from '@/lib/services/teach-codex/thread-store';
import { DrawRepairError, repairDrawScript } from '@/lib/services/teach-live/draw-repair';

/**
 * POST /api/teach/threads/[id]/draw-fix —— <draw> 脚本自愈（仅 live 线程）。
 *
 * body: { chunks: string[], index: number, error: string, segmentId?: string }
 *   chunks = 这张图到目前为止的全部脚本段（首段 + into 追加），index = 前端预跑报错的那段。
 * → { script, verified }：修正后的第 index 段；verified = 服务端已复跑无错。
 * 前端拿到后替换该段重跑；失败则回到原来的「没画出来」提示 + 下次开口带给老师。
 * 修好的脚本以 draw-fix 事件落日志（不广播、不进课堂记录）：回看 / 恢复时替换原段，否则重放的还是跑不通的脚本。
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const row = await getThread(params.id);
  if (!row) return Response.json({ error: '课程不存在', code: 'thread-not-found' }, { status: 404 });
  if (row.engine !== 'live') return Response.json({ error: '仅 live 线程支持', code: 'engine' }, { status: 400 });

  let body: { chunks?: unknown; index?: unknown; error?: unknown; segmentId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: '请求体必须是 JSON' }, { status: 400 });
  }
  const chunks = Array.isArray(body.chunks) ? (body.chunks as unknown[]).map((c) => String(c ?? '')) : null;
  const index = typeof body.index === 'number' ? body.index : Number(body.index);
  const error = typeof body.error === 'string' ? body.error : '';
  const segmentId = typeof body.segmentId === 'string' ? body.segmentId : '';
  if (!chunks || !Number.isInteger(index) || !error) {
    return Response.json({ error: '需要 chunks / index / error' }, { status: 400 });
  }

  try {
    const result = await repairDrawScript(row.id, chunks, index, error);
    if (result.verified && segmentId) {
      void appendThreadEvent(row.id, { type: 'draw-fix', segmentId, script: result.script, error }).catch(() => undefined);
    }
    return Response.json(result);
  } catch (cause) {
    if (cause instanceof DrawRepairError) {
      return Response.json({ error: cause.message, code: cause.code }, { status: cause.status });
    }
    return Response.json({ error: 'failed' }, { status: 500 });
  }
}
