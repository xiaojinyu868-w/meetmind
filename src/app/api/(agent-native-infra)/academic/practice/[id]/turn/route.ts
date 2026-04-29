/**
 * POST /api/academic/practice/:id/turn
 *
 * 语音陪练专用：把 Omni realtime 实时通话里 onUserTranscript / onAssistantTranscriptDone
 * 拿到的句子原样落库到 session.messagesJson，用来给挂断后的反馈生成做素材。
 *
 * 跟 /message 的区别：
 *   - /message 会调 LLM 生成 assistant 回复（文本陪练用）
 *   - /turn 只落库，不触发 LLM（语音场景 AI 回复是 Omni 直接说出来的）
 */

import { NextRequest } from 'next/server';
import { academicRoute, practiceSessionService, resolveConsoleContext } from '@/lib/academic';

export const POST = academicRoute(async (req: NextRequest, ctx) => {
  const context = await resolveConsoleContext(req);
  const { id } = await ctx.params;
  const sessionId = Array.isArray(id) ? id[0] : id;
  const body = await req.json();
  const role = body.role === 'assistant' ? 'assistant' : 'user';
  const content = String(body.content || '').trim();
  if (!content) return { data: { skipped: true } };
  await practiceSessionService.appendTurn({
    sessionId,
    orgId: context.orgId,
    userId: context.userId,
    role,
    content,
  });
  return { data: { ok: true } };
});
