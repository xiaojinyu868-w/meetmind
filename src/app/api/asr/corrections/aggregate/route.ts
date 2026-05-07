// POST /api/asr/corrections/aggregate — 把未处理的 AsrCorrection 聚合为 AsrHotword
//
// 两种触发方式：
//   1. 会话结束时由前端 opportunistically 触发（小代价，增量聚合）
//   2. 运维 / cron 走带密钥的 batch 模式（scope=workspace 或 scope=all）
//
// 身份验证：
//   - 个人模式 (scope=user)：使用用户 JWT
//   - 运维模式 (scope=workspace / all)：使用 ASR_CRON_SECRET header
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { applyRateLimit } from '@/lib/utils/rate-limit';
import { aggregateHotwords } from '@/lib/services/asr-corrections-service';
import { authService } from '@/lib/services/auth-service';
import { createLogger } from '@/lib/logger';

const log = createLogger('api-asr-corrections-aggregate');

const BodySchema = z.object({
  scope: z.enum(['user', 'workspace']).optional().default('user'),
  workspaceId: z.string().optional(),
  minFrequency: z.number().int().positive().max(20).optional(),
  windowDays: z.number().int().positive().max(365).optional(),
});

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

function isCronCaller(request: NextRequest): boolean {
  const expected = process.env.ASR_CRON_SECRET;
  if (!expected) return false;
  const got = request.headers.get('x-cron-secret');
  return got === expected;
}

export async function POST(request: NextRequest) {
  const rl = await applyRateLimit(request, 'transcribe');
  if (rl) return rl;

  try {
    const raw = await request.json().catch(() => ({}));
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: 'bad request', detail: parsed.error.message }, { status: 400 });
    }
    const { scope, workspaceId, minFrequency, windowDays } = parsed.data;

    // 鉴权：user scope → JWT；workspace scope → cron secret 或 workspace 成员身份
    let targetId: string | undefined;
    if (scope === 'user') {
      targetId = extractUserId(request);
      if (!targetId) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
      }
    } else {
      if (!isCronCaller(request)) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
      }
      if (!workspaceId) {
        return NextResponse.json({ error: 'workspaceId required for workspace scope' }, { status: 400 });
      }
      targetId = workspaceId;
    }

    const result = await aggregateHotwords({
      scope,
      id: targetId,
      minFrequency,
      windowDays,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    log.error('aggregate failed', { err: (err as Error).message });
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }
}
