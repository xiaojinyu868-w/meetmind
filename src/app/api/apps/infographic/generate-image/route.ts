import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
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
  const rateLimitResponse = await applyRateLimit(request, 'appsExecute');
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

    // 写到服务端文件，返回 HTTP URL（而非 base64 data URL）。
    // 原因：base64 data URL 会被 useAppExecution 的 stripLargeInlineData 剥空，
    // localStorage 缓存里 image 丢失 → "查看图片"读不到 → 又重新生成。
    // HTTP URL 小，能正常存 localStorage，跨 tab/会话可读。
    const ext = result.mimeType === 'image/jpeg' ? 'jpg' : 'png';
    const filename = `${result.requestId || sessionId}-${Date.now()}.${ext}`;
    const dir = path.join(process.cwd(), 'public', 'uploads', 'infographic');
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(path.join(dir, filename), Buffer.from(result.base64, 'base64'));
    const imageUrl = `/api/infographic/image/${filename}`;

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
