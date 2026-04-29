/**
 * practice-session-service: 学生端陪练会话
 *
 * Phase 1 纯 LLM 版流程：
 *   start():
 *     - 校验 scenario published
 *     - 拉 scenario snapshot + org + student profile + 相关 playbook 摘录
 *     - 拼 system prompt（coachingPersonaService）
 *     - 创建 PracticeSession row，固化 scenarioVersionId
 *   appendMessage():
 *     - 追加一条学生消息
 *     - 组装消息历史调 llm-service，用默认 qwen3.6-plus
 *     - 写回 assistant reply
 *   finish():
 *     - （Phase 2 再实现）跑一次反馈生成；V0 先只标记 completed
 */

import prisma from '@/lib/prisma';
import { AcademicError } from '../errors';
import { orgScenarioService } from './org-scenario-service';
import { orgService } from './org-service';
import { coachingPersonaService, type StudentInputPayload, type AcademicProfileSummary } from './coaching-persona-service';
import { chat as callLLM, type ChatMessage } from '@/lib/services/llm-service';
import { COACHING_CHAT_MODEL, SYNTHESIS_MODEL } from '../models';
import { REALTIME_TEACHER_STYLE_PROMPT } from '@/app/api/(meetmind-learning)/tutor/tutor-prompts';

const COACHING_MODEL = COACHING_CHAT_MODEL;

export interface SessionMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  at: string; // ISO
}

export interface StartSessionInput {
  scenarioId: string;
  userId: string;
  orgId: string;
  mode: 'text' | 'voice';
  studentInput?: StudentInputPayload;
}

export interface SendMessageInput {
  sessionId: string;
  userId: string;
  orgId: string;
  content: string;
}

export const practiceSessionService = {
  async start(input: StartSessionInput) {
    const published = await orgScenarioService.getPublishedVersion(input.orgId, input.scenarioId);
    const snapshot = published.snapshot;

    const [org, profile, playbook, coachingSources] = await Promise.all([
      orgService.getOrg(input.orgId),
      getAcademicProfileSummary(input.orgId, input.userId),
      pickRelevantPlaybook(input.orgId, snapshot.playbookSectionRefs),
      pickCoachingSources(input.orgId, snapshot.coachingSourceRefs),
    ]);

    const { systemPrompt, kickoffMessage } = coachingPersonaService.buildSystemPrompt({
      scenario: snapshot,
      orgName: org.name,
      profile,
      studentInput: input.studentInput,
      playbookExcerpts: playbook,
      coachingSources,
    });

    const nowIso = new Date().toISOString();
    const messages: SessionMessage[] = [
      { role: 'system', content: systemPrompt, at: nowIso },
    ];

    // 如果场景有 userKickoff，把它作为"学生第一句话"塞进去，让 AI 立刻响应第一轮
    let assistantOpening: string | null = null;
    if (kickoffMessage) {
      messages.push({ role: 'user', content: kickoffMessage, at: nowIso });
      const opening = await callLLM(messages.map(stripAt), COACHING_MODEL);
      assistantOpening = opening.content;
      messages.push({ role: 'assistant', content: assistantOpening, at: new Date().toISOString() });
    }

    const session = await prisma.practiceSession.create({
      data: {
        orgId: input.orgId,
        userId: input.userId,
        scenarioId: input.scenarioId,
        scenarioVersionId: published.versionId,
        mode: input.mode,
        status: 'active',
        messagesJson: JSON.stringify(messages),
      },
    });

    return {
      sessionId: session.id,
      messages: messages.filter((m) => m.role !== 'system'), // 不把 system prompt 送回前端
      model: COACHING_MODEL,
      /** 语音陪练专用：拼好的 Omni realtime 用 system prompt（文本版 + 口语化增强） */
      realtimeInstructions: buildRealtimeInstructions(systemPrompt),
      /** 让前端展示"本轮用到哪些资产" */
      sourcesUsed: coachingSources.map((s) => s.title),
      playbookSectionsUsed: playbook.length,
    };
  },

  async sendMessage(input: SendMessageInput) {
    const session = await prisma.practiceSession.findUnique({ where: { id: input.sessionId } });
    if (!session || session.orgId !== input.orgId || session.userId !== input.userId) {
      throw new AcademicError('NOT_FOUND', '会话不存在');
    }
    if (session.status !== 'active') {
      throw new AcademicError('INVALID_INPUT', '会话已结束');
    }
    if (!input.content?.trim()) {
      throw new AcademicError('INVALID_INPUT', '消息不能为空');
    }

    const messages: SessionMessage[] = safeJson(session.messagesJson, []);
    messages.push({ role: 'user', content: input.content, at: new Date().toISOString() });

    const response = await callLLM(messages.map(stripAt), COACHING_MODEL);

    messages.push({ role: 'assistant', content: response.content, at: new Date().toISOString() });

    await prisma.practiceSession.update({
      where: { id: session.id },
      data: { messagesJson: JSON.stringify(messages) },
    });

    return {
      sessionId: session.id,
      assistantReply: response.content,
      model: COACHING_MODEL,
    };
  },

  /**
   * 语音陪练专用：直接 append 一条 transcript（不触发 LLM），供挂断时生成反馈用素材
   */
  async appendTurn(input: {
    sessionId: string;
    orgId: string;
    userId: string;
    role: 'user' | 'assistant';
    content: string;
  }) {
    const session = await prisma.practiceSession.findUnique({ where: { id: input.sessionId } });
    if (!session || session.orgId !== input.orgId || session.userId !== input.userId) {
      throw new AcademicError('NOT_FOUND', '会话不存在');
    }
    if (session.status !== 'active') return;
    const messages: SessionMessage[] = safeJson(session.messagesJson, []);
    messages.push({ role: input.role, content: input.content, at: new Date().toISOString() });
    await prisma.practiceSession.update({
      where: { id: session.id },
      data: { messagesJson: JSON.stringify(messages) },
    });
  },

  async finish(orgId: string, userId: string, sessionId: string) {
    const session = await prisma.practiceSession.findUnique({ where: { id: sessionId } });
    if (!session || session.orgId !== orgId || session.userId !== userId) {
      throw new AcademicError('NOT_FOUND', '会话不存在');
    }
    if (session.status === 'completed') return session;

    // 生成一份反馈摘要（学生端能看到的"老师会这样总结这轮"）
    const messages: SessionMessage[] = safeJson(session.messagesJson, []);
    const convo = messages
      .filter((m) => m.role !== 'system')
      .map((m) => `${m.role === 'user' ? '学生' : '陪练'}: ${m.content}`)
      .join('\n');

    let feedback: {
      headline: string;
      strengths: string[];
      improvements: string[];
      nextAction: string;
    } | null = null;

    if (convo.trim().length > 0) {
      try {
        const resp = await callLLM(
          [
            {
              role: 'system',
              content:
                `你是刚才那位陪练分身。请对本轮练习给一份给学生看的总结，严格 JSON：
{"headline":"一句总体评价（不超过 30 字）","strengths":["做得好的 1-3 条"],"improvements":["还可以提升的 1-3 条"],"nextAction":"下一次我们可以一起练什么 / 你可以自己做什么"}
只从对话里提取，不编造。`,
            },
            { role: 'user', content: convo },
          ],
          SYNTHESIS_MODEL,
          { temperature: 0.3, responseFormat: 'json_object', maxTokens: 800 },
        );
        feedback = safeJson(resp.content, null);
      } catch {
        feedback = null;
      }
    }

    return prisma.practiceSession.update({
      where: { id: sessionId },
      data: {
        status: 'completed',
        completedAt: new Date(),
        feedbackJson: feedback ? JSON.stringify(feedback) : null,
      },
    });
  },

  async listRecentForUser(orgId: string, userId: string) {
    return prisma.practiceSession.findMany({
      where: { orgId, userId },
      orderBy: { startedAt: 'desc' },
      take: 20,
      include: { scenario: { select: { id: true, name: true } } },
    });
  },

  async getSessionForUser(orgId: string, userId: string, sessionId: string) {
    const session = await prisma.practiceSession.findUnique({
      where: { id: sessionId },
      include: { scenario: { select: { id: true, name: true, description: true, coachingSourceRefs: true, playbookSectionRefs: true } } },
    });
    if (!session || session.orgId !== orgId || session.userId !== userId) {
      throw new AcademicError('NOT_FOUND', '会话不存在');
    }
    const messages: SessionMessage[] = safeJson(session.messagesJson, []);
    const feedback = safeJson(session.feedbackJson, null);

    // 找 system prompt 用于语音 realtime 恢复会话
    const systemMsg = messages.find((m) => m.role === 'system');
    const realtimeInstructions = systemMsg ? buildRealtimeInstructions(systemMsg.content) : null;

    // 拉资产元信息（给前端显示"本轮用到了哪些"）
    const sourceRefs = safeJson<string[]>(session.scenario.coachingSourceRefs, []);
    const playbookRefs = safeJson<string[]>(session.scenario.playbookSectionRefs, []);
    const [sources, playbookCount] = await Promise.all([
      sourceRefs.length > 0
        ? prisma.coachingSource.findMany({
            where: { orgId, id: { in: sourceRefs }, status: 'ready' },
            select: { id: true, title: true },
          })
        : Promise.resolve([]),
      playbookRefs.length > 0
        ? prisma.orgPlaybookSection.count({ where: { orgId, id: { in: playbookRefs } } })
        : Promise.resolve(0),
    ]);

    return {
      sessionId: session.id,
      scenario: { id: session.scenario.id, name: session.scenario.name, description: session.scenario.description },
      mode: session.mode,
      status: session.status,
      startedAt: session.startedAt,
      messages: messages.filter((m) => m.role !== 'system'),
      feedback,
      realtimeInstructions,
      sourcesUsed: sources.map((s) => s.title),
      playbookSectionsUsed: playbookCount,
    };
  },
};

// ------- 辅助 -------

/**
 * 把 coachingPersonaService 生成的文字版 system prompt 转成更适合 realtime 语音的 instructions：
 * 保留所有 persona 设定与老师画像，叠加 REALTIME_TEACHER_STYLE_PROMPT（口语化、句子短、不念标题）。
 */
function buildRealtimeInstructions(systemPrompt: string): string {
  return `${systemPrompt}

---

## 语音对话额外守则（仅口语版）
${REALTIME_TEACHER_STYLE_PROMPT.trim()}

- 你现在不是在写文章，是在跟这个学生**面对面讲话**。
- 每次回应控制在 2-3 句；如果要展开，也等学生追问。
- 不要念 "## 你的人格设定"、"## 提问范式" 这类章节标题——它们只是给你看的。
- 不要报时间戳、不要念编号。
- 如果学生沉默或无声，就自然地等一会儿或再鼓励一句，不要自说自话。
`;
}

function stripAt(m: SessionMessage): ChatMessage {
  return { role: m.role, content: m.content };
}

async function getAcademicProfileSummary(orgId: string, userId: string): Promise<AcademicProfileSummary | null> {
  const profile = await prisma.academicProfile.findUnique({
    where: { orgId_userId: { orgId, userId } },
  });
  if (!profile) return null;
  return {
    displayName: profile.displayName,
    stage: profile.stage,
    goals: safeJson(profile.goalsJson ?? '{}', {}),
    background: safeJson(profile.backgroundJson ?? '{}', {}),
    materials: safeJson(profile.materialsJson ?? '{}', {}),
    notes: profile.notes,
  };
}

async function pickRelevantPlaybook(orgId: string, refIds: string[]): Promise<string[]> {
  if (!refIds || refIds.length === 0) {
    // V0 fallback：拉 org 最早的 overview 一条作为通用背景，避免 system prompt 完全没有机构味
    const fallback = await prisma.orgPlaybookSection.findFirst({
      where: { orgId, sectionKind: 'overview' },
      orderBy: { createdAt: 'asc' },
    });
    return fallback ? [`${fallback.title}\n${fallback.body}`] : [];
  }
  const rows = await prisma.orgPlaybookSection.findMany({
    where: { orgId, id: { in: refIds } },
  });
  return rows.map((r) => `${r.title}\n${r.body}`);
}

/** 拉取 scenario 引用的 CoachingSource（已 analyze 完成的才会被带上） */
async function pickCoachingSources(orgId: string, refIds: string[]) {
  if (!refIds || refIds.length === 0) return [];
  const rows = await prisma.coachingSource.findMany({
    where: { orgId, id: { in: refIds }, status: 'ready' },
  });
  const result: Array<{ title: string; analysis: import('./coaching-source-service').CoachingSourceAnalysis }> = [];
  for (const r of rows) {
    if (!r.analysisJson) continue;
    try {
      result.push({ title: r.title, analysis: JSON.parse(r.analysisJson) });
    } catch {
      // ignore corrupted
    }
  }
  return result;
}

function safeJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export type PracticeSessionService = typeof practiceSessionService;
