import { NextRequest, NextResponse } from 'next/server';
import { applyRateLimit } from '@/lib/utils/rate-limit';
import { generateQwenImage, getQwenImageModel, isQwenImageEnabled } from '@/lib/services/qwen-image-service';

interface InfographicImageRequest {
  sessionId?: string;
  appKey?: string;
  draftPrompt?: string;
  stylePreset?: string;
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    enabled: isQwenImageEnabled(),
    model: getQwenImageModel(),
  });
}

export async function POST(request: NextRequest) {
  const rateLimitResponse = await applyRateLimit(request, 'default');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const payload = (await request.json()) as InfographicImageRequest;
    const sessionId = (payload.sessionId || '').trim();
    const appKey = (payload.appKey || '').trim();
    const draftPrompt = (payload.draftPrompt || '').trim();
    const stylePreset = (payload.stylePreset || '').trim();

    if (!sessionId) {
      return NextResponse.json({ ok: false, error: 'Missing sessionId' }, { status: 400 });
    }

    if (appKey !== 'infographic') {
      return NextResponse.json({ ok: false, error: 'appKey must be infographic' }, { status: 400 });
    }

    if (!draftPrompt) {
      return NextResponse.json({ ok: false, error: 'Missing draftPrompt' }, { status: 400 });
    }

    if (!isQwenImageEnabled()) {
      return NextResponse.json(
        {
          ok: false,
          error: '未配置文生图能力（DASHSCOPE_API_KEY），请先完成环境变量配置。',
          model: getQwenImageModel(),
        },
        { status: 400 }
      );
    }

    const result = await generateQwenImage({
      prompt: draftPrompt,
      stylePreset,
    });

    return NextResponse.json({
      ok: true,
      sessionId,
      appKey,
      requestId: result.requestId,
      model: result.model,
      imageUrl: result.imageUrl,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 }
    );
  }
}
