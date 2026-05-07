// POST /api/asr/corrections — 记录 ASR 纠错事件（M5 T5.1）
// GET  /api/asr/corrections/hotwords?scope=user|workspace — 返回当前热词列表
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { applyRateLimit } from '@/lib/utils/rate-limit';
import { recordCorrection, getHotwords } from '@/lib/services/asr-corrections-service';
import { createLogger } from '@/lib/logger';
import { authService } from '@/lib/services/auth-service';

const log = createLogger('api-asr-corrections');

function extractUserId(request: NextRequest): string | undefined {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return undefined;
    const payload = authService.verifyToken(authHeader.slice(7));
    return payload?.sub ?? undefined;
  } catch {
    return undefined;
  }
}

const PostBodySchema = z.object({
  sessionId: z.string().min(1).max(128),
  wrongText: z.string().min(1).max(500),
  correctedText: z.string().min(1).max(500),
  beginMs: z.number().int().nonnegative().optional(),
  endMs: z.number().int().nonnegative().optional(),
  context: z.string().max(500).optional(),
  asrMode: z.enum(['realtime', 'fast', 'async', 'unknown']).optional(),
  workspaceId: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const rl = await applyRateLimit(request, 'transcribe');
  if (rl) return rl;

  try {
    const raw = await request.json();
    const parsed = PostBodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: 'bad request', detail: parsed.error.message }, { status: 400 });
    }

    const userId = extractUserId(request);

    const created = await recordCorrection({
      ...parsed.data,
      userId,
    });

    if (!created) {
      return NextResponse.json({ error: 'dropped (no-op or too long)' }, { status: 400 });
    }

    return NextResponse.json({ success: true, id: created.id });
  } catch (err) {
    log.error('POST /corrections failed', { err: (err as Error).message });
    return NextResponse.json(
      { error: 'internal error', detail: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  const rl = await applyRateLimit(request, 'transcribe');
  if (rl) return rl;

  try {
    const { searchParams } = new URL(request.url);
    const scope = searchParams.get('scope') ?? 'user';
    const limit = Number(searchParams.get('limit') ?? '20');

    let userId: string | undefined = extractUserId(request);
    let workspaceId: string | undefined;

    if (scope === 'workspace') {
      workspaceId = searchParams.get('workspaceId') ?? undefined;
      if (!workspaceId) {
        return NextResponse.json({ error: 'workspaceId required' }, { status: 400 });
      }
      userId = undefined;
    }

    if (!userId && !workspaceId) {
      return NextResponse.json({ hotwords: [] });
    }

    const hotwords = await getHotwords({ userId, workspaceId, limit });
    return NextResponse.json({ hotwords });
  } catch (err) {
    log.error('GET /corrections/hotwords failed', { err: (err as Error).message });
    return NextResponse.json(
      { error: 'internal error' },
      { status: 500 },
    );
  }
}

