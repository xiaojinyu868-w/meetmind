import { NextRequest, NextResponse } from 'next/server';
import { authService } from '@/lib/services/auth-service';
import workspaceContextService from '@/lib/services/workspace-context-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getAuthPayload(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice(7);
  return authService.verifyToken(token);
}

export async function POST(request: NextRequest) {
  try {
    const payload = getAuthPayload(request);

    if (!payload) {
      return NextResponse.json(
        { success: false, error: '未授权' },
        { status: 401 }
      );
    }

    const body = await request.json() as {
      sourceType: string;
      sourceKey: string;
      role: string;
      contentType: string;
      title: string;
      previewText?: string;
      normalizedText?: string;
      sourceUrl?: string;
      mediaUrl?: string;
      tutorContext?: string;
      occurredAt?: string;
      metadata?: Record<string, unknown>;
    };

    if (!body.sourceKey || !body.title || !body.sourceType || !body.contentType) {
      return NextResponse.json(
        { success: false, error: '缺少必要字段' },
        { status: 400 }
      );
    }

    const result = await workspaceContextService.upsertCaptureForUser(payload.sub, {
      sourceType: body.sourceType,
      sourceKey: body.sourceKey,
      role: body.role || 'support',
      contentType: body.contentType,
      title: body.title,
      previewText: body.previewText,
      normalizedText: body.normalizedText,
      sourceUrl: body.sourceUrl,
      mediaUrl: body.mediaUrl,
      tutorContext: body.tutorContext,
      occurredAt: body.occurredAt,
      metadata: body.metadata,
    });

    return NextResponse.json({
      success: true,
      workspace: result.workspace,
      echo: result.echo,
      capture: {
        id: result.capture.id,
        sourceKey: result.capture.sourceKey,
      },
    });
  } catch (error) {
    console.error('workspace capture upsert error:', error);
    return NextResponse.json(
      { success: false, error: '写入工作区收集失败' },
      { status: 500 }
    );
  }
}
