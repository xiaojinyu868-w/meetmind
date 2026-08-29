import { createLogger } from '@/lib/logger';
import { resolveTeachProvider } from '@/lib/config/teach.config';
import { createEgo, listEgos, type FenshenSourceType } from '@/lib/services/fenshen/thread-store';
import { isPrivateSource } from '@/lib/services/fenshen/fenshen-config';
import { preflightFenshen, startDistillation } from '@/lib/services/fenshen/distill-service';
import { runPrivateCorpusPipeline } from '@/lib/services/fenshen/corpus-service';

/**
 * GET  /api/fenshen/egos —— 分身架列表（updatedAt 倒序）
 * POST /api/fenshen/egos —— 请分身 {name, sourceType, sourceRef?}
 *   （name ≤50字；sourceType ∈ hall|bilibili|upload）。
 *   hall：建行后立即起蒸馏线程；蒸馏进度经 GET /api/fenshen/egos/[id]/stream 流出。
 *   bilibili / upload（私有轨）：语料准备是分钟级操作，POST 先返回 ego
 *   （status=learning），后台跑 corpus-service 语料管线 → 就绪后起蒸馏；
 *   语料失败由管线置 status=failed + failReason + SSE error 事件（人可读）。
 */

const log = createLogger('api-fenshen-egos');

const SOURCE_TYPES: FenshenSourceType[] = ['hall', 'bilibili', 'upload'];

function toDto(ego: {
  id: string;
  name: string;
  sourceType: string;
  sourceRef: string;
  status: string;
  skillPath: string | null;
  failReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: ego.id,
    name: ego.name,
    sourceType: ego.sourceType,
    sourceRef: ego.sourceRef,
    status: ego.status,
    skillPath: ego.skillPath,
    failReason: ego.failReason,
    createdAt: ego.createdAt,
    updatedAt: ego.updatedAt,
  };
}

export async function GET() {
  const egos = await listEgos();
  return Response.json({ egos: egos.map(toDto) });
}

export async function POST(request: Request) {
  let body: { name?: unknown; sourceType?: unknown; sourceRef?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: '请求体必须是 JSON' }, { status: 400 });
  }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 50) {
    return Response.json({ error: '需要 name（≤50字）' }, { status: 400 });
  }
  const sourceType = body.sourceType as FenshenSourceType;
  if (!SOURCE_TYPES.includes(sourceType)) {
    return Response.json({ error: 'sourceType 必须是 hall | bilibili | upload' }, { status: 400 });
  }
  const sourceRef = typeof body.sourceRef === 'string' ? body.sourceRef.trim() : '';
  if (sourceType !== 'hall' && !sourceRef) {
    return Response.json({ error: 'bilibili / upload 轨道需要 sourceRef' }, { status: 400 });
  }

  const preflight = preflightFenshen(sourceType);
  if (!preflight.ok) {
    return Response.json({ error: preflight.error }, { status: 500 });
  }

  const provider = resolveTeachProvider();
  const ego = await createEgo({ name, sourceType, sourceRef, model: provider.model });
  log.info('fenshen ego created', { egoId: ego.id, name, sourceType, model: provider.model });

  if (isPrivateSource(sourceType)) {
    // 私有轨：先返回 ego（learning），后台 语料→蒸馏；pipeline 自身兜底失败状态
    runPrivateCorpusPipeline(ego.id).catch((cause) => {
      log.error('corpus pipeline crashed', {
        egoId: ego.id,
        error: cause instanceof Error ? cause.message : String(cause),
      });
    });
    return Response.json({ ego: toDto(ego) });
  }

  try {
    await startDistillation(ego.id);
  } catch (cause) {
    // ego 已建行（startDistillation 内部已置 failed + 发 error 事件）
    return Response.json(
      { error: cause instanceof Error ? cause.message.slice(0, 200) : '蒸馏启动失败', ego: toDto(ego) },
      { status: 500 },
    );
  }
  return Response.json({ ego: toDto({ ...ego, status: 'learning' }) });
}
