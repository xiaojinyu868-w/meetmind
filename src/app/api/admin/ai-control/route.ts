import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { LLMConfig } from '@/lib/config/app.config';
import { createLogger } from '@/lib/logger';
import authService from '@/lib/services/auth-service';
import {
  buildAiControlPromptPreview,
  compareAiControlCandidate,
  getAiControlItems,
  publishAiControlOverride,
  rollbackAiControlOverride,
  saveAiControlDraft,
} from '@/lib/services/ai-control-service';
import type { AiControlKey } from '@/types/ai-control';
import { applyRateLimit } from '@/lib/utils/rate-limit';

const log = createLogger('admin-ai-control');

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ControlKeySchema = z.enum([
  'tutor:in-class',
  'tutor:review',
  'tutor:shared',
  'tutor:goal',
  'tutor:word',
  'tutor:global',
  'understanding:intent',
  'understanding:memory',
  'app:flashcards',
  'app:quiz',
  'app:mindmap',
  'app:cheatsheet',
  'app:infographic',
  'app:audio-overview',
]);

const OverrideSchema = z.object({
  enabled: z.boolean(),
  additionalInstructions: z.string().max(12_000),
  modelId: z.string().max(120).optional(),
  note: z.string().max(500).optional(),
});

const ActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('preview'),
    controlKey: ControlKeySchema,
    context: z.record(z.string(), z.unknown()),
    options: z.record(z.string(), z.unknown()).default({}),
    override: OverrideSchema,
  }),
  z.object({ action: z.literal('save-draft'), controlKey: ControlKeySchema, override: OverrideSchema }),
  z.object({
    action: z.literal('compare'),
    controlKey: ControlKeySchema,
    context: z.record(z.string(), z.unknown()),
    options: z.record(z.string(), z.unknown()).default({}),
    override: OverrideSchema,
    query: z.string().min(1).max(4_000),
  }),
  z.object({ action: z.literal('publish'), controlKey: ControlKeySchema, override: OverrideSchema }),
  z.object({ action: z.literal('rollback'), controlKey: ControlKeySchema, revisionId: z.string().min(1) }),
]);

async function requireAdmin(request: NextRequest) {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return { response: NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 }) };
  const payload = authService.verifyToken(token);
  if (!payload) return { response: NextResponse.json({ success: false, error: 'Invalid token' }, { status: 401 }) };
  const user = await authService.getUserById(payload.sub);
  if (!user || user.role !== 'admin') {
    return { response: NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 }) };
  }
  return { user };
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('response' in auth) return auth.response;
  try {
    return NextResponse.json({
      success: true,
      items: await getAiControlItems(),
      models: LLMConfig.models.map(({ id, name, provider, description, recommended }) => ({
        id, name, provider, description, recommended: Boolean(recommended),
      })),
    });
  } catch (error) {
    log.error('list failed', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ success: false, error: 'Unable to load AI controls' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('response' in auth) return auth.response;
  const parsed = ActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Invalid request', detail: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const body = parsed.data;
    let data;
    if (body.action === 'preview') {
      data = await buildAiControlPromptPreview(body.controlKey, body.context, body.options, body.override);
    } else if (body.action === 'compare') {
      const rateLimit = await applyRateLimit(request, 'tutor');
      if (rateLimit) return rateLimit;
      data = await compareAiControlCandidate(body.controlKey, body.context, body.options, body.override, body.query);
    } else if (body.action === 'save-draft') {
      data = await saveAiControlDraft(body.controlKey as AiControlKey, body.override, auth.user.id);
    } else if (body.action === 'publish') {
      data = await publishAiControlOverride(body.controlKey as AiControlKey, body.override, auth.user.id);
    } else {
      data = await rollbackAiControlOverride(body.controlKey as AiControlKey, body.revisionId, auth.user.id);
    }
    return NextResponse.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('action failed', { action: parsed.data.action, message });
    const status = message === 'REVISION_NOT_FOUND' || message === 'UNKNOWN_AI_CONTROL_KEY' ? 404 : 400;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
