import { createLogger } from '@/lib/logger';
import { preflightFenshen, requestDistillRevision } from '@/lib/services/fenshen/distill-service';
import { FenshenServiceError, getEgo, touchEgo } from '@/lib/services/fenshen/thread-store';

/**
 * POST /api/fenshen/egos/[id]/feedback —— 试听反馈「像 / 不像他」。
 *
 * body: {verdict:'like'|'unlike', note?}。
 * like：记录在案即可（touch 排序）；unlike：触发重蒸馏 turn（带 note 重听），
 * 分身状态回到 learning，修订产物落盘后完成检测再次发 ego-ready。
 */

const log = createLogger('api-fenshen-feedback');

export async function POST(request: Request, { params }: { params: { id: string } }) {
  let body: { verdict?: unknown; note?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: '请求体必须是 JSON' }, { status: 400 });
  }
  const verdict = body.verdict;
  if (verdict !== 'like' && verdict !== 'unlike') {
    return Response.json({ error: "verdict 必须是 'like' | 'unlike'" }, { status: 400 });
  }
  const note = typeof body.note === 'string' ? body.note.trim() : undefined;

  const ego = await getEgo(params.id);
  if (!ego) return Response.json({ error: '分身不存在' }, { status: 404 });

  if (verdict === 'like') {
    await touchEgo(ego.id);
    log.info('fenshen feedback like', { egoId: ego.id });
    return Response.json({ ok: true });
  }

  const preflight = preflightFenshen();
  if (!preflight.ok) return Response.json({ error: preflight.error }, { status: 500 });
  try {
    await requestDistillRevision(ego.id, note);
    return Response.json({ ok: true });
  } catch (cause) {
    if (cause instanceof FenshenServiceError) {
      return Response.json({ error: cause.message, code: cause.code }, { status: cause.status });
    }
    return Response.json({ error: 'failed' }, { status: 500 });
  }
}
