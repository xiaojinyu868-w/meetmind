import { NextRequest, NextResponse } from 'next/server';
import { applyRateLimit } from '@/lib/utils/rate-limit';
import {
  generateGeminiImage,
  isGeminiImageEnabled,
} from '@/lib/services/gemini-image-service';

interface InfographicImageRequest {
  sessionId?: string;
  appKey?: string;
  draftPrompt?: string;
  stylePreset?: string;
  orientation?: 'landscape' | 'portrait' | 'square';
  detailLevel?: 'concise' | 'standard' | 'detailed';
  language?: string;
  scenePreset?: string;
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    enabled: isGeminiImageEnabled(),
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
    const orientation = payload.orientation || 'landscape';
    const detailLevel = payload.detailLevel || 'standard';
    const language = (payload.language || '中文（简体）').trim();
    const scenePreset = (payload.scenePreset || 'infographic').trim();

    if (!sessionId) {
      return NextResponse.json({ ok: false, error: 'Missing sessionId' }, { status: 400 });
    }

    if (appKey !== 'infographic') {
      return NextResponse.json({ ok: false, error: 'appKey must be infographic' }, { status: 400 });
    }

    if (!draftPrompt) {
      return NextResponse.json({ ok: false, error: 'Missing draftPrompt' }, { status: 400 });
    }

    if (!isGeminiImageEnabled()) {
      return NextResponse.json(
        {
          ok: false,
          error: '未配置图片生成服务的 API Key，请先完成环境变量配置。',
        },
        { status: 400 }
      );
    }

    const result = await generateGeminiImage({
      prompt: draftPrompt,
      stylePreset,
      orientation,
      detailLevel,
      language,
      scenePreset,
    });

    const imageUrl = `data:${result.mimeType};base64,${result.base64}`;

    return NextResponse.json({
      ok: true,
      sessionId,
      appKey,
      requestId: result.requestId,
      model: result.model,
      imageUrl,
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
