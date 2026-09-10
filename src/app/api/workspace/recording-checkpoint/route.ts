/**
 * POST /api/workspace/recording-checkpoint — 录课中的检查点（登录用户）。
 *
 * 录音期间客户端每分钟（以及页面隐藏时的 keepalive 心跳）把这节课的当前状态写到 Workspace：
 * 同一把 sourceKey（live:{uid}:{sid}）、metadata.recordingState='recording'、已定稿的转录段。
 * 另一台设备据此在列表里看到「录制中 · 已 N 分钟」；忘记结束时服务端也握着大半内容。
 *
 * 与 POST /api/workspace/captures 的区别：不带正文（不触发课后理解安全网、不算回声输入）、
 * 不返回回声状态、有独立的体积上限。结束这节课仍走 /api/workspace/captures。
 *
 * body: { sessionId, kind: 'checkpoint' | 'heartbeat', durationMs, startedAt?, title?, segments?, audioSource? }
 * 返回: { success, captureId, sourceKey }
 */

import { NextRequest, NextResponse } from 'next/server';
import { authService } from '@/lib/services/auth-service';
import {
  MAX_CHECKPOINT_BYTES,
  parseRecordingCheckpointBody,
  upsertRecordingCheckpoint,
} from '@/lib/services/recording-checkpoint-service';
import { createLogger } from '@/lib/logger';

const log = createLogger('workspace/recording-checkpoint');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getAuthPayload(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  return authService.verifyToken(authHeader.slice(7));
}

export async function POST(request: NextRequest) {
  try {
    const payload = getAuthPayload(request);
    if (!payload) {
      return NextResponse.json({ success: false, error: '未授权' }, { status: 401 });
    }

    const contentLength = Number.parseInt(request.headers.get('content-length') || '', 10);
    if (Number.isFinite(contentLength) && contentLength > MAX_CHECKPOINT_BYTES) {
      return NextResponse.json({ success: false, error: '检查点过大' }, { status: 413 });
    }

    const input = parseRecordingCheckpointBody(await request.json().catch(() => null));
    if (!input) {
      return NextResponse.json({ success: false, error: '缺少 sessionId' }, { status: 400 });
    }

    const result = await upsertRecordingCheckpoint(payload.sub, input);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    log.error('recording checkpoint failed', { error: String(error) });
    return NextResponse.json({ success: false, error: '检查点写入失败' }, { status: 500 });
  }
}
