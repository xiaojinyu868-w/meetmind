/**
 * POST /api/console/scenarios/:id/try — 试跑
 *
 * body: { messages: ChatMessage[] }  // 前端维护的对话历史
 *   第一次调用 messages 可以只包含一条 user mock 开场
 *
 * 返回一条 assistant reply + systemPrompt 摘要（给编辑者 live preview 用）
 *
 * 这个接口在 /console 里给 Scenario 编辑者在"发布前"亲自对话验证 persona。
 * 不写任何 DB，不消耗 PracticeSession；只是拼 system prompt + 调 LLM。
 */

import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { academicRoute, coachingPersonaService, orgService, resolveConsoleContext } from '@/lib/academic';
import { chat } from '@/lib/services/llm-service';
import { COACHING_CHAT_MODEL } from '@/lib/academic/models';
import type { CoachingSourceAnalysis } from '@/lib/academic/services/coaching-source-service';

const TRY_MODEL = COACHING_CHAT_MODEL;

interface TryBody {
  /** scenario 草稿（允许未保存的实时改动） */
  draft: Parameters<typeof coachingPersonaService.buildSystemPrompt>[0]['scenario'];
  /** 可选：mock 一个学生画像 */
  mockProfile?: { displayName?: string; stage?: string; notes?: string };
  /** 可选：mock studentInput */
  mockInput?: Record<string, string>;
  /** 前端维护的对话消息（不含 system） */
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export const POST = academicRoute(async (req: NextRequest) => {
  const context = await resolveConsoleContext(req, { requireRole: ['owner', 'consultant'] });
  const body = (await req.json()) as TryBody;

  const org = await orgService.getOrg(context.orgId);

  // 根据草稿里的 coachingSourceRefs / playbookSectionRefs 拉相关资产
  const [playbookRows, sourceRows] = await Promise.all([
    body.draft.playbookSectionRefs && body.draft.playbookSectionRefs.length > 0
      ? prisma.orgPlaybookSection.findMany({
          where: { orgId: context.orgId, id: { in: body.draft.playbookSectionRefs } },
        })
      : Promise.resolve([]),
    body.draft.coachingSourceRefs && body.draft.coachingSourceRefs.length > 0
      ? prisma.coachingSource.findMany({
          where: { orgId: context.orgId, id: { in: body.draft.coachingSourceRefs }, status: 'ready' },
        })
      : Promise.resolve([]),
  ]);

  const playbookExcerpts = playbookRows.map((r) => `${r.title}\n${r.body}`);
  const coachingSources: Array<{ title: string; analysis: CoachingSourceAnalysis }> = [];
  for (const r of sourceRows) {
    if (!r.analysisJson) continue;
    try {
      coachingSources.push({ title: r.title, analysis: JSON.parse(r.analysisJson) });
    } catch {}
  }

  const { systemPrompt, metadata } = coachingPersonaService.buildSystemPrompt({
    scenario: body.draft,
    orgName: org.name,
    profile: body.mockProfile ?? null,
    studentInput: body.mockInput,
    playbookExcerpts,
    coachingSources,
  });

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    ...body.messages,
  ];

  // 如果前端还没发过任何 user 消息，就用 kickoff 或默认开场
  if (!body.messages.some((m) => m.role === 'user')) {
    messages.push({ role: 'user' as const, content: body.draft.promptPatch?.userKickoff?.trim() || '你好，我们开始吧。' });
  }

  const response = await chat(messages, TRY_MODEL);

  return {
    data: {
      assistantReply: response.content,
      systemPromptPreview: systemPrompt,
      metadata,
      model: TRY_MODEL,
      sourcesUsed: coachingSources.map((s) => s.title),
      playbookSectionsUsed: playbookExcerpts.length,
    },
  };
});
