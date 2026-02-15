import { NextRequest, NextResponse } from 'next/server';
import { applyRateLimit } from '@/lib/utils/rate-limit';
import { appPluginRegistry, buildExecutionContext, getWorkshopAppByKey, type AppExecuteRequest } from '@/lib/ai-native';

export async function POST(request: NextRequest) {
  const rateLimitResponse = await applyRateLimit(request, 'default');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const payload = (await request.json()) as Partial<AppExecuteRequest>;
    const appKey = typeof payload.appKey === 'string' ? payload.appKey.trim() : '';

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

    let pluginId = typeof payload.pluginId === 'string' ? payload.pluginId : undefined;
    if (!pluginId && appKey) {
      pluginId = getWorkshopAppByKey(appKey)?.pluginId;
    }

    const context = buildExecutionContext({
      ...(payload as AppExecuteRequest),
      appKey: appKey || payload.appKey,
    });
    const result = await appPluginRegistry.execute(context, pluginId);

    const tracedResult = !appKey
      ? {
          ...result,
          trace: [...result.trace, 'legacy_appkey_fallback'],
        }
      : result;

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
