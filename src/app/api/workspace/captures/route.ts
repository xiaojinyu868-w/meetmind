import { NextRequest, NextResponse } from 'next/server';
import { authService } from '@/lib/services/auth-service';
import { isCommonstackEchoConfigured } from '@/lib/services/commonstack-echo-service';
import workspaceContextService from '@/lib/services/workspace-context-service';
import workspaceEchoService from '@/lib/services/workspace-echo-service';
import { createLogger } from '@/lib/logger';
const log = createLogger('workspace/captures');


export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getAuthPayload(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }

  return authService.verifyToken(authHeader.slice(7));
}

function unauthorizedResponse() {
  return NextResponse.json({ success: false, error: '未授权' }, { status: 401 });
}

export async function POST(request: NextRequest) {
  try {
    const payload = getAuthPayload(request);
    if (!payload) {
      return unauthorizedResponse();
    }

    const body = (await request.json()) as {
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
      return NextResponse.json({ success: false, error: '缺少必要字段' }, { status: 400 });
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

    const echoStatus = await workspaceEchoService.getDailyEchoStatusForWorkspace(result.workspace.id);

    return NextResponse.json({
      success: true,
      workspace: result.workspace,
      capture: result.capture,
      echoQueued: isCommonstackEchoConfigured() && (echoStatus.status === 'missing' || echoStatus.status === 'failed'),
      echoPending: echoStatus.status === 'pending',
      echoAlreadyGeneratedToday: echoStatus.status === 'active',
    });
  } catch (error) {
    log.error('workspace capture upsert error:', error);
    return NextResponse.json({ success: false, error: '写入工作区收集失败' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const payload = getAuthPayload(request);
    if (!payload) {
      return unauthorizedResponse();
    }

    const body = (await request.json()) as {
      captureId?: string;
      sourceKey?: string;
      action?: 'archive' | 'restore' | 'update';
      title?: string | null;
      previewText?: string | null;
      normalizedText?: string | null;
      tutorContext?: string | null;
    };

    if (!body.captureId && !body.sourceKey) {
      return NextResponse.json({ success: false, error: '缺少要更新的收集标识' }, { status: 400 });
    }

    const action = body.action || 'archive';

    if (action === 'update') {
      const result = await workspaceContextService.updateCaptureContentForUser(payload.sub, {
        captureId: body.captureId,
        sourceKey: body.sourceKey,
        title: body.title,
        previewText: body.previewText,
        normalizedText: body.normalizedText,
        tutorContext: body.tutorContext,
      });

      if (!result.capture) {
        return NextResponse.json({ success: false, error: '未找到这条收集' }, { status: 404 });
      }

      return NextResponse.json({
        success: true,
        capture: result.capture,
      });
    }

    if (action !== 'archive' && action !== 'restore') {
      return NextResponse.json({ success: false, error: '不支持的收集操作' }, { status: 400 });
    }

    const result = await workspaceContextService.updateCaptureStatusForUser(payload.sub, {
      captureId: body.captureId,
      sourceKey: body.sourceKey,
      status: action === 'restore' ? 'active' : 'archived',
    });

    if (!result.capture) {
      return NextResponse.json({ success: false, error: '未找到这条收集' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      capture: result.capture,
      retiredEchoIds: result.retiredEchoIds,
    });
  } catch (error) {
    log.error('workspace capture patch error:', error);
    return NextResponse.json({ success: false, error: '更新收集失败' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const payload = getAuthPayload(request);
    if (!payload) {
      return unauthorizedResponse();
    }

    const body = (await request.json()) as {
      captureId?: string;
      sourceKey?: string;
    };

    if (!body.captureId && !body.sourceKey) {
      return NextResponse.json({ success: false, error: '缺少要删除的收集标识' }, { status: 400 });
    }

    const result = await workspaceContextService.updateCaptureStatusForUser(payload.sub, {
      captureId: body.captureId,
      sourceKey: body.sourceKey,
      status: 'deleted',
    });

    if (!result.capture) {
      return NextResponse.json({ success: false, error: '未找到这条收集' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      capture: result.capture,
      retiredEchoIds: result.retiredEchoIds,
    });
  } catch (error) {
    log.error('workspace capture delete error:', error);
    return NextResponse.json({ success: false, error: '彻底删除收集失败' }, { status: 500 });
  }
}
