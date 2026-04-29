/**
 * POST /api/consult/voice/context
 *
 * 学生点"接听" → voice 页加载时调这里拿到 realtime instructions。
 * 前端已经把 toolCallId + openingLine/focus/voice 塞进了 sessionStorage，
 * 这个端点**只负责一件事**：把 session 最近的对话 + 学生画像 → 拼成一段
 * Omni realtime 能直接吃的 system instructions。
 *
 * 请求体：
 *   { orgSlug, studentKey, openingLine, focus[], voice }
 * 返回：
 *   { data: { instructions: string, voice, introLine, studentSummary } }
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionMessages } from '@/lib/services/consult-session-service';
import { readProfile } from '@/lib/services/consult-profile-service';
import type { UIMessage } from 'ai';

export const runtime = 'nodejs';

interface Body {
  orgSlug: string;
  studentKey: string;
  openingLine: string;
  focus?: string[];
  voice?: string;
}

async function resolveOrgId(orgSlug: string): Promise<string | null> {
  const byId = await prisma.organization.findUnique({ where: { id: orgSlug } }).catch(() => null);
  if (byId) return byId.id;
  const byName = await prisma.organization.findFirst({ where: { name: { contains: orgSlug } } });
  if (byName) return byName.id;
  const fallback = await prisma.organization.findFirst({ orderBy: { createdAt: 'asc' } });
  return fallback?.id ?? null;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ success: false, error: 'invalid json' }, { status: 400 });
  }
  if (!body.orgSlug || !body.studentKey || !body.openingLine) {
    return NextResponse.json({ success: false, error: 'missing fields' }, { status: 400 });
  }

  const orgId = await resolveOrgId(body.orgSlug);
  if (!orgId) return NextResponse.json({ success: false, error: 'org not found' }, { status: 404 });

  // 对话 + 画像
  const sess = await prisma.consultSession.findUnique({
    where: { orgId_studentKey: { orgId, studentKey: body.studentKey } },
    select: { id: true, activeScenarioName: true, visitedScenarios: true },
  });
  const bundle = sess ? await getSessionMessages(sess.id) : null;
  const profileRes = await readProfile(orgId, body.studentKey, [
    'cv', 'target_field', 'target_degree', 'target_schools',
    'advisor_candidates', 'strengths', 'weaknesses', 'worries', 'tone_preference',
  ]);

  const dialogueExcerpt = bundle ? excerptDialogue(bundle.messages) : '（尚无文字对话记录）';
  const profileSummary = summarizeProfile(profileRes.profile ?? {});
  const activeScenario = sess?.activeScenarioName ?? null;
  const focus = Array.isArray(body.focus) ? body.focus.slice(0, 4) : [];

  const instructions = buildRealtimeInstructions({
    orgSlug: body.orgSlug,
    openingLine: body.openingLine,
    focus,
    activeScenario,
    dialogueExcerpt,
    profileSummary,
  });

  return NextResponse.json({
    success: true,
    data: {
      instructions,
      voice: body.voice ?? 'Ethan',
      introLine: body.openingLine,
      studentSummary: profileSummary.slice(0, 300),
      activeScenario,
    },
  });
}

// ─────────── helpers ───────────

function buildRealtimeInstructions(opts: {
  orgSlug: string;
  openingLine: string;
  focus: string[];
  activeScenario: string | null;
  dialogueExcerpt: string;
  profileSummary: string;
}): string {
  const { orgSlug, openingLine, focus, activeScenario, dialogueExcerpt, profileSummary } = opts;
  return [
    `# 你是谁`,
    `你是 ${orgSlug} 机构提供的 AI 申请顾问。此刻学生刚在**文字对话**里按了"接听"，你正通过语音和他深聊。`,
    ``,
    `# 开场第一句`,
    `接通后，立刻说（且**只**说）这一句：`,
    `「${openingLine}」`,
    `然后停顿，等学生回应。不要自我介绍、不要寒暄。`,
    ``,
    `# 本次通话要聊透的重点`,
    focus.length > 0 ? focus.map((f) => `- ${f}`).join('\n') : '- （自由探索学生此刻最想聊的点）',
    ``,
    `# 之前文字里发生了什么`,
    activeScenario ? `当前跑的 skill：${activeScenario}` : '',
    ``,
    `最近文字对话节选：`,
    dialogueExcerpt,
    ``,
    `# 学生画像`,
    profileSummary,
    ``,
    `# 语音对话纪律`,
    `1. **一次只说一件事**，一句话不超过 25 字。语音不是文本，学生会打断你。`,
    `2. 鼓励打断：学生开口你就停。`,
    `3. 不要列表、不要 "**加粗**"、不要 markdown —— 你在说话。`,
    `4. 聚焦重点清单里的点。偏题了用"回到你刚才说的 X"拉回来。`,
    `5. 不要复述文字里已经给过的 draft 全文。抓**一个细节**深聊。`,
    `6. 如果学生说"没什么要聊的了"，自然收尾："好，那我先挂了，回头文字里继续。"`,
    `7. 绝对不要说"我是 AI"、"我是程序"。你是 AI 顾问，专业和真诚就够了。`,
  ]
    .filter(Boolean)
    .join('\n');
}

function summarizeProfile(profile: Record<string, unknown>): string {
  if (!profile || Object.keys(profile).length === 0) return '（画像为空）';
  const lines: string[] = [];
  const priority = ['target_field', 'target_degree', 'target_schools', 'advisor_candidates', 'cv', 'strengths', 'weaknesses', 'worries', 'tone_preference'];
  for (const k of priority) {
    if (profile[k] == null) continue;
    lines.push(formatField(k, profile[k]));
  }
  return lines.join('\n') || '（画像为空）';
}

function formatField(k: string, v: unknown): string {
  if (typeof v === 'string') return `- ${k}: ${v.slice(0, 300)}`;
  if (Array.isArray(v)) {
    if (v.length === 0) return `- ${k}: (空)`;
    if (typeof v[0] === 'object') return `- ${k}: ${JSON.stringify(v).slice(0, 300)}`;
    return `- ${k}: ${v.map(String).join('、')}`;
  }
  if (typeof v === 'object' && v !== null) {
    if (k === 'cv') {
      const cv = v as Record<string, unknown>;
      if (typeof cv.text === 'string') return `- cv: (已上传)${cv.text.slice(0, 250)}…`;
    }
    return `- ${k}: ${JSON.stringify(v).slice(0, 300)}`;
  }
  return `- ${k}: ${String(v)}`;
}

function excerptDialogue(messages: UIMessage[]): string {
  const rows: string[] = [];
  for (const m of messages) {
    const parts = m.parts ?? [];
    if (m.role === 'user') {
      const t = parts.map((p) => (p.type === 'text' ? (p as { text?: string }).text ?? '' : '')).join('').trim();
      if (t) rows.push(`学生：${t.slice(0, 200)}`);
      continue;
    }
    if (m.role === 'assistant') {
      const textBits: string[] = [];
      for (const p of parts) {
        if (p.type === 'text') {
          const t = ((p as { text?: string }).text ?? '').trim();
          if (t) textBits.push(t);
        } else if (typeof p.type === 'string' && p.type === 'tool-showDraft') {
          const input = ((p as unknown as { input?: { title?: string; kind?: string } }).input) ?? {};
          if (input.title) textBits.push(`[给过 draft：${input.title}]`);
        } else if (typeof p.type === 'string' && p.type === 'tool-showConsultantMove') {
          const input = ((p as unknown as { input?: { title?: string } }).input) ?? {};
          if (input.title) textBits.push(`[刚才的顾问判断：${input.title}]`);
        } else if (typeof p.type === 'string' && p.type === 'tool-showAdvisorDiscovery') {
          const input = ((p as unknown as { input?: { title?: string } }).input) ?? {};
          if (input.title) textBits.push(`[刚才的导师探索：${input.title}]`);
        } else if (typeof p.type === 'string' && p.type === 'tool-showServicePlan') {
          const input = ((p as unknown as { input?: { title?: string } }).input) ?? {};
          if (input.title) textBits.push(`[服务方案：${input.title}]`);
        } else if (typeof p.type === 'string' && p.type === 'tool-showOutreachWorkspace') {
          const input = ((p as unknown as { input?: { title?: string } }).input) ?? {};
          if (input.title) textBits.push(`[看过外联工作台：${input.title}]`);
        } else if (typeof p.type === 'string' && p.type === 'tool-askOptions') {
          const output = ((p as unknown as { output?: { labels?: string[] } }).output) ?? {};
          if (output.labels && output.labels.length > 0) textBits.push(`[学生选了：${output.labels.join('、')}]`);
        }
      }
      const t = textBits.join(' / ').trim();
      if (t) rows.push(`AI：${t.slice(0, 280)}`);
    }
  }
  return rows.slice(-10).join('\n') || '（暂无文字对话）';
}
