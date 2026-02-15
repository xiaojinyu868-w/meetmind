import { NextRequest, NextResponse } from 'next/server';
import { applyRateLimit } from '@/lib/utils/rate-limit';
import { appPluginRegistry, buildExecutionContext, getWorkshopAppByKey, type AppExecuteRequest } from '@/lib/ai-native';

export async function POST(request: NextRequest) {
  const rateLimitResponse = await applyRateLimit(request, 'default');
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
    const result = await appPluginRegistry.execute(context, pluginId);

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
