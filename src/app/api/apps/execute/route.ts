import { NextRequest, NextResponse } from 'next/server';
import { applyRateLimit } from '@/lib/utils/rate-limit';
import { appPluginRegistry, buildExecutionContext, getWorkshopAppByKey, type AppExecuteRequest } from '@/lib/ai-native';

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
  const rateLimitResponse = await applyRateLimit(request, 'appsExecute');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const payload = (await request.json()) as Partial<AppExecuteRequest>;
    const appKey = typeof payload.appKey === 'string' ? payload.appKey.trim() : '';
    const traceHints: string[] = [];

    if (!payload?.input?.transcript || !Array.isArray(payload.input.transcript)) {
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
    const catalogPluginId = appKey ? getWorkshopAppByKey(appKey)?.pluginId : undefined;

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

    const context = buildExecutionContext({
      ...(payload as AppExecuteRequest),
      appKey: appKey || payload.appKey,
    });
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
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}
