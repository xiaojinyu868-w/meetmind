import { NextRequest, NextResponse } from 'next/server';
import { authService } from '@/lib/services/auth-service';
import workspaceAccountService from '@/lib/services/workspace-account-service';
import type { LocalWorkspaceMigrationPayload } from '@/lib/services/workspace-context-types';
import { createLogger } from '@/lib/logger';
const log = createLogger('workspace/local-migration');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// payload 体积/数量上限（防止打死进程）
// 与客户端 useAuth.tsx 中的分批策略保持同步
const MAX_PAYLOAD_BYTES = 8 * 1024 * 1024; // 8MB
const MAX_SESSIONS_PER_REQUEST = 50;

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

    // 在解析 body 前先看 Content-Length，超大直接拒绝，不让 Node 进程被巨型 JSON 卡住
    const contentLengthHeader = request.headers.get('content-length');
    if (contentLengthHeader) {
      const contentLength = Number.parseInt(contentLengthHeader, 10);
      if (Number.isFinite(contentLength) && contentLength > MAX_PAYLOAD_BYTES) {
        log.warn(
          `payload too large: ${contentLength} bytes > ${MAX_PAYLOAD_BYTES} (user=${payload.sub}). 客户端应改为分批推送。`,
        );
        return NextResponse.json(
          {
            success: false,
            error: 'payload 过大，请分批推送',
            maxBytes: MAX_PAYLOAD_BYTES,
          },
          { status: 413 },
        );
      }
    }

    let body: Partial<LocalWorkspaceMigrationPayload>;
    try {
      body = (await request.json()) as Partial<LocalWorkspaceMigrationPayload>;
    } catch (parseError) {
      log.warn(`payload JSON parse failed (user=${payload.sub})`, parseError);
      return NextResponse.json(
        { success: false, error: '请求体不是合法 JSON' },
        { status: 400 },
      );
    }

    const sessions = Array.isArray(body.sessions) ? body.sessions : [];

    if (sessions.length === 0) {
      return NextResponse.json({
        success: true,
        workspace: null,
        summary: { total: 0, created: 0, updated: 0, skipped: 0, repairedWechatMessages: 0 },
      });
    }

    if (sessions.length > MAX_SESSIONS_PER_REQUEST) {
      log.warn(
        `sessions per request too many: ${sessions.length} > ${MAX_SESSIONS_PER_REQUEST} (user=${payload.sub})`,
      );
      return NextResponse.json(
        {
          success: false,
          error: `单次最多 ${MAX_SESSIONS_PER_REQUEST} 节课，请分批推送`,
          maxSessions: MAX_SESSIONS_PER_REQUEST,
        },
        { status: 413 },
      );
    }

    const startedAt = Date.now();
    const result = await workspaceAccountService.migrateLocalWorkspaceData(payload.sub, {
      sessions,
    });
    const elapsedMs = Date.now() - startedAt;

    log.info(
      `migrated user=${payload.sub} total=${result.summary.total} created=${result.summary.created} updated=${result.summary.updated} skipped=${result.summary.skipped} elapsedMs=${elapsedMs}`,
    );

    return NextResponse.json({
      success: true,
      workspace: result.workspace,
      summary: result.summary,
    });
  } catch (error) {
    log.error('workspace local migration error:', error);
    return NextResponse.json({ success: false, error: '同步本地学习历史失败' }, { status: 500 });
  }
}
