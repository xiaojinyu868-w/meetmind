/**
 * POST /api/workspace/captures/[captureId]/artifacts
 *
 * 全端采集层：向已有 capture 追加证据 artifact（正规化存储在
 * WorkspaceCaptureArtifact，kind 是自由字符串）。
 *
 * 典型用途：
 *   - 桌面端录课中上传关键帧：kind='keyframe'，payload 含
 *     { mediaUrl, timestampSec, phash }，与转录段共用同一时间轴
 *   - 桌面热键截图挂到某个课堂：kind='screenshot'
 *
 * 幂等：按 (captureId, kind, artifactKey) upsert，重传覆盖。
 * 所有权：capture 必须属于当前用户。
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { authService } from '@/lib/services/auth-service';
import { createLogger } from '@/lib/logger';

const log = createLogger('workspace/captures/artifacts');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_ARTIFACTS_PER_CALL = 100;
const MAX_PAYLOAD_BYTES = 64 * 1024;

function getAuthPayload(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  return authService.verifyToken(authHeader.slice(7));
}

function safeKey(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_:.-]/g, '').slice(0, 120);
}

type ArtifactInput = {
  kind?: unknown;
  artifactKey?: unknown;
  sessionId?: unknown;
  payload?: unknown;
};

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ captureId: string }> },
) {
  try {
    const auth = getAuthPayload(request);
    if (!auth) {
      return NextResponse.json({ success: false, error: '未授权' }, { status: 401 });
    }

    const { captureId } = await context.params;
    const capture = await prisma.workspaceCapture.findFirst({
      where: { id: captureId, userId: auth.sub },
      select: { id: true, sourceKey: true, metadataJson: true },
    });
    if (!capture) {
      return NextResponse.json({ success: false, error: '未找到课堂' }, { status: 404 });
    }

    const body = (await request.json().catch(() => null)) as
      | (ArtifactInput & { artifacts?: ArtifactInput[] })
      | null;
    if (!body) {
      return NextResponse.json({ success: false, error: '请求体格式错误' }, { status: 400 });
    }
    const items = Array.isArray(body.artifacts) ? body.artifacts : [body];
    if (items.length === 0 || items.length > MAX_ARTIFACTS_PER_CALL) {
      return NextResponse.json(
        { success: false, error: `artifacts 数量需在 1-${MAX_ARTIFACTS_PER_CALL} 之间` },
        { status: 400 },
      );
    }

    // sessionId 优先级：单条指定 > 请求级 > capture metadata > sourceKey
    let defaultSessionId = capture.sourceKey;
    try {
      const metadata = JSON.parse(capture.metadataJson || '{}') as Record<string, unknown>;
      if (typeof metadata.sessionId === 'string' && metadata.sessionId) {
        defaultSessionId = metadata.sessionId;
      }
    } catch {
      // metadata 损坏时退回 sourceKey
    }
    const requestSessionId = typeof body.sessionId === 'string' && body.sessionId
      ? safeKey(body.sessionId)
      : '';

    let upserted = 0;
    for (const [index, item] of items.entries()) {
      const kind = typeof item.kind === 'string' ? safeKey(item.kind) : '';
      if (!kind) {
        return NextResponse.json(
          { success: false, error: `第 ${index + 1} 条 artifact 缺少 kind` },
          { status: 400 },
        );
      }
      const payloadJson = JSON.stringify(item.payload ?? {});
      if (payloadJson.length > MAX_PAYLOAD_BYTES) {
        return NextResponse.json(
          { success: false, error: `第 ${index + 1} 条 artifact payload 过大` },
          { status: 400 },
        );
      }
      const artifactKey = typeof item.artifactKey === 'string' && item.artifactKey
        ? safeKey(item.artifactKey)
        : `${kind}-${Date.now()}-${index}`;
      const sessionId = typeof item.sessionId === 'string' && item.sessionId
        ? safeKey(item.sessionId)
        : requestSessionId || defaultSessionId;

      await prisma.workspaceCaptureArtifact.upsert({
        where: { captureId_kind_artifactKey: { captureId: capture.id, kind, artifactKey } },
        create: { captureId: capture.id, sessionId, kind, artifactKey, payloadJson },
        update: { sessionId, payloadJson },
      });
      upserted += 1;
    }

    return NextResponse.json({ success: true, upserted });
  } catch (error) {
    log.error('append workspace capture artifacts failed:', error);
    return NextResponse.json({ success: false, error: '追加证据失败' }, { status: 500 });
  }
}
