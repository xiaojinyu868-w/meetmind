import { NextRequest, NextResponse } from 'next/server';
import { applyRateLimit } from '@/lib/utils/rate-limit';
import {
  appPluginRegistry,
  buildExecutionContext,
  buildExecutionContextFromPack,
  getWorkshopAppByKey,
  isAppSupportedAtTier,
  validatePack,
  type AppExecuteRequest,
  type ContextPack,
  type ContextTier,
} from '@/lib/ai-native';
import { assessWorkshopReadiness } from '@/lib/services/workshop-readiness-service';

function parseServerTimeoutMs(
  envValue: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number.parseInt(envValue || '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

const APP_EXEC_DEFAULT_TIMEOUT_MS = parseServerTimeoutMs(
  process.env.APP_EXEC_TIMEOUT_MS,
  180 * 1000,
  30 * 1000,
  10 * 60 * 1000
);
const APP_EXEC_PODCAST_TIMEOUT_MS = parseServerTimeoutMs(
  process.env.APP_EXEC_PODCAST_TIMEOUT_MS,
  300 * 1000,
  60 * 1000,
  15 * 60 * 1000
);

function resolveExecuteTimeoutMs(appKey: string): number {
  return appKey === 'audio-overview' ? APP_EXEC_PODCAST_TIMEOUT_MS : APP_EXEC_DEFAULT_TIMEOUT_MS;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`App execution timeout (${timeoutMs}ms)`)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

export async function POST(request: NextRequest) {
  try {
    const rateLimitResponse = await applyRateLimit(request, 'appsExecute');
    if (rateLimitResponse) return rateLimitResponse;

    const payload = (await request.json()) as Partial<AppExecuteRequest>;
    const appKey = typeof payload.appKey === 'string' ? payload.appKey.trim() : '';
    const rawPack = payload.contextPack;
    const contextPack = rawPack
      && typeof rawPack === 'object'
      && Array.isArray(rawPack.lessons)
      && (rawPack.tier === 'class' || rawPack.tier === 'unit' || rawPack.tier === 'exam')
      ? rawPack as ContextPack
      : undefined;
    if (rawPack && !contextPack) {
      return NextResponse.json({ error: 'Invalid contextPack' }, { status: 400 });
    }
    if (contextPack) {
      const validation = validatePack(contextPack);
      if (!validation.ok) {
        return NextResponse.json({ error: validation.reason || 'Invalid contextPack' }, { status: 400 });
      }
      if (payload.contextTier && payload.contextTier !== contextPack.tier) {
        return NextResponse.json({ error: 'contextTier does not match contextPack.tier' }, { status: 400 });
      }
    }
    const contextTier: ContextTier = contextPack?.tier
      ?? (payload.contextTier === 'unit' || payload.contextTier === 'exam' ? payload.contextTier : 'class');
    const traceHints: string[] = [];

    if (!contextPack && (!payload?.input?.transcript || !Array.isArray(payload.input.transcript))) {
      return NextResponse.json(
        { error: 'Missing input.transcript array' },
        { status: 400 }
      );
    }

    if (!payload.goal) {
      return NextResponse.json(
        { error: 'Missing goal' },
        { status: 400 }
      );
    }

    const requestedPluginId = typeof payload.pluginId === 'string' ? payload.pluginId.trim() : '';
    const catalogItem = appKey ? getWorkshopAppByKey(appKey) : undefined;
    const catalogPluginId = catalogItem?.pluginId;

    if (catalogItem && !isAppSupportedAtTier(catalogItem.supportedTiers, contextTier)) {
      return NextResponse.json({
        ok: false,
        error: 'APP_NOT_SUITABLE',
      }, { status: 422 });
    }

    if (appKey === 'cheatsheet') {
      const hasMultipleLessons = (contextPack?.lessons.length || 0) >= 2;
      const hasExamScope = contextPack?.tier === 'exam' && Boolean(
        contextPack.exam?.syllabus?.trim()
          || contextPack.exam?.pastPapers?.some((paper) => paper.content?.trim()),
      );
      if (!contextPack || (!hasMultipleLessons && !hasExamScope)) {
        return NextResponse.json({
          ok: false,
          error: 'MULTI_LESSON_CONTEXT_REQUIRED',
        }, { status: 422 });
      }
    }

    // appKey 是新链路的唯一分发依据，避免前端陈旧 pluginId 造成 500
    let pluginId: string | undefined = catalogPluginId || (requestedPluginId || undefined);
    if (catalogPluginId && requestedPluginId && requestedPluginId !== catalogPluginId) {
      traceHints.push(`plugin_override=${requestedPluginId}->${catalogPluginId}`);
    }

    // 兼容旧链路：若传入未知 pluginId，回退为自动匹配，避免直接失败
    if (!catalogPluginId && pluginId && !appPluginRegistry.get(pluginId)) {
      traceHints.push(`legacy_pluginid_unknown=${pluginId}`);
      pluginId = undefined;
    }

    const baseContext = buildExecutionContext({
      ...(payload as AppExecuteRequest),
      appKey: appKey || payload.appKey,
      contextTier,
      input: payload.input ?? { transcript: [], anchors: [], dataSource: 'unknown' },
    });
    const context = contextPack
      ? buildExecutionContextFromPack(contextPack, baseContext.goal, baseContext.model)
      : baseContext;
    const readiness = await assessWorkshopReadiness({
      transcript: context.input.transcript,
      contextTitle: typeof context.input.metadata?.title === 'string' ? context.input.metadata.title : undefined,
      contextType: typeof context.input.metadata?.contextType === 'string'
        ? context.input.metadata.contextType
        : context.input.dataSource,
      activeAnchorCount: context.input.anchors.filter((anchor) => !anchor.cancelled && !anchor.resolved).length,
      keyDifficulties: context.memory.keyDifficulties,
      summary: context.memory.summary,
      goalIntent: context.goal.intent,
      contextTier,
    });

    if (readiness.status === 'not_ready' || readiness.allowedAppKeys.length === 0) {
      return NextResponse.json({
        ok: false,
        error: 'CONTENT_NOT_READY',
        readiness,
      }, { status: 422 });
    }

    if (appKey && !readiness.allowedAppKeys.includes(appKey as typeof readiness.allowedAppKeys[number])) {
      return NextResponse.json({
        ok: false,
        error: 'APP_NOT_SUITABLE',
        readiness,
      }, { status: 422 });
    }

    const result = await withTimeout(
      appPluginRegistry.execute(context, pluginId),
      resolveExecuteTimeoutMs(appKey)
    );

    const tracedResult = {
      ...result,
      trace: [
        ...result.trace,
        ...traceHints,
        ...(!appKey ? ['legacy_appkey_fallback'] : []),
      ],
    };

    return NextResponse.json({
      ok: true,
      pluginId: tracedResult.pluginId,
      result: tracedResult,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (message === 'CONTENT_NOT_READY') {
      return NextResponse.json(
        { ok: false, error: 'CONTENT_NOT_READY' },
        { status: 422 },
      );
    }
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}
