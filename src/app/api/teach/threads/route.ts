import { createLogger } from '@/lib/logger';
import { resolveTeachProvider, TeachConfig } from '@/lib/config/teach.config';
import { createThread, listThreads } from '@/lib/services/teach-codex/thread-store';
import { preflightTeach } from '@/lib/services/teach-codex/teach-session-service';
import { preflightTeachEngine } from '@/lib/services/teach-engine/teach-engine-service';

/**
 * GET  /api/teach/threads —— 历史课程列表（updatedAt 倒序）
 * POST /api/teach/threads —— 新建课程 {topic}（≤100字；先只支持文本课题）
 *
 * 引擎分发（P1-B）：创建时按 TEACH_ENGINE 快照写入 TeachThread.engine
 * （codex | engine），此后该线程所有路由按此归属分发；engine=null 的
 * 旧线程永远走 codex。preflight 按目标引擎各查各的 provider key。
 */

const log = createLogger('api-teach-threads');

export async function GET() {
  const threads = await listThreads();
  return Response.json({
    threads: threads.map((t) => ({
      id: t.id,
      title: t.title,
      topic: t.topic,
      model: t.model,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    })),
  });
}

export async function POST(request: Request) {
  const engine = TeachConfig.engine === 'engine' ? 'engine' : 'codex';
  const preflight = engine === 'engine' ? preflightTeachEngine() : preflightTeach();
  if (!preflight.ok) {
    return Response.json({ error: preflight.error }, { status: 500 });
  }

  let body: { topic?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: '请求体必须是 JSON' }, { status: 400 });
  }
  const topic = typeof body.topic === 'string' ? body.topic.trim() : '';
  if (!topic || topic.length > 100) {
    return Response.json({ error: '需要 topic（≤100字）' }, { status: 400 });
  }

  const provider = resolveTeachProvider();
  const thread = await createThread({ topic, model: provider.model, engine });
  log.info('teach thread created', { threadId: thread.id, topic, model: provider.model, engine });
  return Response.json({
    thread: {
      id: thread.id,
      title: thread.title,
      topic: thread.topic,
      model: thread.model,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
    },
  });
}
