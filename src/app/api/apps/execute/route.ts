import { NextRequest, NextResponse } from 'next/server';
import { applyRateLimit } from '@/lib/utils/rate-limit';
import { appPluginRegistry, buildExecutionContext, type AppExecuteRequest } from '@/lib/ai-native';

export async function POST(request: NextRequest) {
  const rateLimitResponse = await applyRateLimit(request, 'default');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const payload = (await request.json()) as Partial<AppExecuteRequest>;

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

    const context = buildExecutionContext(payload as AppExecuteRequest);
    const result = await appPluginRegistry.execute(context, payload.pluginId);

    return NextResponse.json({
      ok: true,
      pluginId: result.pluginId,
      result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}
