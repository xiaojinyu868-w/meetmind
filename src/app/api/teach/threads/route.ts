import type { NextRequest } from 'next/server';
import { createLogger } from '@/lib/logger';
import { resolveTeachProvider, TeachConfig } from '@/lib/config/teach.config';
import { createThread, listThreads } from '@/lib/services/teach-codex/thread-store';
import { preflightTeach } from '@/lib/services/teach-codex/teach-session-service';
import { preflightTeachEngine } from '@/lib/services/teach-engine/teach-engine-service';
import { preflightTeachLive } from '@/lib/services/teach-live/teach-live-service';
import { resolveTeachLiveProvider } from '@/lib/config/teach.config';
import { resolveLearnerContext } from '@/lib/services/learner-context-service';
import { LEARNER_CONTEXT_VERSION, isLearnerContextEmpty } from '@/types/learner-context';
import { getUserIdFromRequest } from '@/lib/utils/rate-limit';

/**
 * GET  /api/teach/threads —— 历史课程列表（updatedAt 倒序；`?engine=live` 只列该引擎的）
 * POST /api/teach/threads —— 新建课程 {topic, learner?, engine?}（≤100字；先只支持文本课题；learner 为「这个学习者」本机切片，可选）
 *
 * 引擎分发（P1-B）：创建时按 TEACH_ENGINE 快照写入 TeachThread.engine
 * （codex | engine | live），此后该线程所有路由按此归属分发；engine=null 的
 * 旧线程永远走 codex。preflight 按目标引擎各查各的 provider key。
 * body.engine 可显式指定（/teach/live 新入口带 engine=live，不依赖环境变量默认值）。
 */

const log = createLogger('api-teach-threads');

type TeachEngineId = 'codex' | 'engine' | 'live';

function normalizeEngine(value: unknown): TeachEngineId | null {
  return value === 'codex' || value === 'engine' || value === 'live' ? value : null;
}

export async function GET(request: NextRequest) {
  const only = normalizeEngine(request.nextUrl.searchParams.get('engine'));
  const threads = await listThreads();
  return Response.json({
    threads: threads
      .filter((t) => (only ? t.engine === only : true))
      .map((t) => ({
        id: t.id,
        title: t.title,
        topic: t.topic,
        model: t.model,
        engine: t.engine ?? 'codex',
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      })),
  });
}

export async function POST(request: NextRequest) {
  let body: { topic?: unknown; learner?: unknown; engine?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: '请求体必须是 JSON' }, { status: 400 });
  }
  const engine: TeachEngineId = normalizeEngine(body.engine) ?? normalizeEngine(TeachConfig.engine) ?? 'codex';
  const preflight =
    engine === 'live' ? preflightTeachLive() : engine === 'engine' ? preflightTeachEngine() : preflightTeach();
  if (!preflight.ok) {
    return Response.json({ error: preflight.error }, { status: 500 });
  }

  const topic = typeof body.topic === 'string' ? body.topic.trim() : '';
  if (!topic || topic.length > 100) {
    return Response.json({ error: '需要 topic（≤100字）' }, { status: 400 });
  }

  const provider = engine === 'live' ? resolveTeachLiveProvider() : resolveTeachProvider();
  // 「这个学习者」读槽：开课时带来的本机切片（不合法当没有）；登录用户拿服务端事实半 + 共享 Context 按课题召回的理解半
  const learnerId = getUserIdFromRequest(request) || undefined;
  const learner = await resolveLearnerContext({
    request: { v: LEARNER_CONTEXT_VERSION, appId: 'teach', learnerId, need: ['mastery', 'challenges', 'topics', 'goals'], limit: 8, task: `给这位学生上一课：${topic}` },
    local: body.learner,
  });
  const thread = await createThread({ topic, model: provider.model, engine, learner: isLearnerContextEmpty(learner) ? null : learner });
  log.info('teach thread created', { threadId: thread.id, topic, model: provider.model, engine });
  return Response.json({
    thread: {
      id: thread.id,
      title: thread.title,
      topic: thread.topic,
      model: thread.model,
      engine,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
    },
  });
}
