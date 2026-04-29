/**
 * consult-icebreaker-service —— 给机构顾问生成开场白
 *
 * 场景：
 *   一条 ConsultLead 到手，顾问要加学生微信，第一句不能问"在吗"。
 *   用 (lead.reason + profileSnapshot + session 最后 N 轮对话) 给 Qwen，
 *   让它产出 2-3 条候选开场白（~30-60 字），每条对应一种策略。
 *
 * 输出纪律：
 *   - 必须指向学生对话里出现过的**具体事实**（上传过的 CV / 提过的学校 / 选过的方向）
 *   - 不要"您好，我是 xxx 机构的顾问" —— 换成价值先发（"你 CV 里那个 CMU 的 RA 经历…"）
 *   - 每条有一行 strategy tag：温暖型 / 专业型 / 稀缺型
 *   - 返回 strict JSON 方便前端展示
 *
 * 成本控制：
 *   - 对话只截取最后 ~6 条有实质内容的 message
 *   - maxTokens 400
 *   - 模型用 qwen3.6-plus（主模型，不走 max）
 */

import type { UIMessage } from 'ai';
import { chat, type ChatMessage } from './llm-service';
import { prisma } from '@/lib/prisma';
import { getSessionMessages } from './consult-session-service';

export interface IcebreakerDraft {
  strategy: string; // "温暖型" / "专业型" / "稀缺型" 之一，或 LLM 自拟
  text: string; // 开场白正文，30-60 字
  rationale?: string; // 为什么这么写（内部可见，供顾问理解）
}

export interface GenerateIcebreakersInput {
  orgId: string;
  leadId: string;
}

export async function generateIcebreakers(
  input: GenerateIcebreakersInput,
): Promise<{ drafts: IcebreakerDraft[]; ms: number }> {
  const t0 = Date.now();
  const lead = await prisma.consultLead.findUnique({ where: { id: input.leadId } });
  if (!lead || lead.orgId !== input.orgId) {
    throw new Error('线索不存在或跨机构');
  }

  // 1. 取画像快照 + lead reason
  const profile = safeParse(lead.profileSnapshot);
  const profileSummary = summarizeProfile(profile);

  // 2. 取对话最后 N 条有价值的 turns
  let dialogueExcerpt = '(无归档对话)';
  if (lead.sessionId) {
    const sess = await getSessionMessages(lead.sessionId);
    if (sess && sess.messages.length > 0) {
      dialogueExcerpt = excerptDialogue(sess.messages);
    }
  } else {
    // 兼容老数据（M.8 之前的 lead 可能 sessionId 为空）
    const sess = await prisma.consultSession.findUnique({
      where: {
        orgId_studentKey: {
          orgId: lead.orgId,
          studentKey: lead.studentKey,
        },
      },
      select: { id: true },
    });
    if (sess) {
      const bundle = await getSessionMessages(sess.id);
      if (bundle) dialogueExcerpt = excerptDialogue(bundle.messages);
    }
  }

  const system: ChatMessage = {
    role: 'system',
    content: [
      '你是留学机构顾问的"开场白教练"。机构顾问要加学生微信，你给他 3 条候选开场白。',
      '',
      '硬规则：',
      '1. 绝对不能用"您好，我是 xxx 机构的顾问 / 请问方便聊吗"这种空话。',
      '2. 每条开场白必须指向学生在 AI 对话里**真实出现过的**细节（具体学校、具体项目、他选的方向、他上传的 CV 里的一个点）。',
      '3. 每条 30-60 字，口语，像顾问真人在发微信。',
      '4. 三条策略差异化：',
      '   - 温暖型：从学生焦虑点切入，表达理解',
      '   - 专业型：抛一个**只有顾问能给**的洞察/比较点',
      '   - 稀缺型：点名一个资源（认识某位教授 / 改过类似 CV / 有直通项目）',
      '5. 不要写结尾"期待你的回复"，开放式结尾或带一个温和的问题即可。',
      '',
      '输出严格 JSON：',
      '{"drafts":[{"strategy":"温暖型","text":"...","rationale":"..."},{"strategy":"专业型","text":"...","rationale":"..."},{"strategy":"稀缺型","text":"...","rationale":"..."}]}',
      '不要输出 JSON 之外任何东西，不要 markdown 代码块。',
    ].join('\n'),
  };

  const user: ChatMessage = {
    role: 'user',
    content: [
      `学生产生线索时的场景：${lead.scenarioName}`,
      '',
      `AI 给顾问写的"为什么值得聊"：${lead.reason || '（空）'}`,
      lead.headline ? `CTA 标题：${lead.headline}` : '',
      lead.consultantHint ? `顾问提示：${lead.consultantHint}` : '',
      '',
      '学生画像摘要：',
      profileSummary,
      '',
      '学生跟 AI 对话节选（最近 6 轮）：',
      dialogueExcerpt,
      '',
      '请产出 3 条开场白 JSON。',
    ].filter(Boolean).join('\n'),
  };

  const res = await chat([system, user], 'qwen3.6-plus', {
    temperature: 0.7,
    maxTokens: 600,
    responseFormat: 'json_object',
  });

  const text = res.content ?? '';
  const parsed = parseIcebreakerJson(text);
  return { drafts: parsed, ms: Date.now() - t0 };
}

// ───────────── helpers ─────────────

function safeParse(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' ? v as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function summarizeProfile(profile: Record<string, unknown>): string {
  if (!profile || Object.keys(profile).length === 0) return '（空）';
  const lines: string[] = [];
  // 按优先级展示
  const priority = ['target_field', 'target_degree', 'target_schools', 'advisor_candidates', 'cv', 'strengths', 'weaknesses'];
  for (const k of priority) {
    if (profile[k] == null) continue;
    lines.push(formatField(k, profile[k]));
  }
  for (const [k, v] of Object.entries(profile)) {
    if (priority.includes(k) || v == null) continue;
    lines.push(formatField(k, v));
  }
  return lines.join('\n');
}

function formatField(k: string, v: unknown): string {
  if (typeof v === 'string') return `- ${k}: ${v.slice(0, 400)}`;
  if (Array.isArray(v)) {
    if (v.length === 0) return `- ${k}: (空)`;
    // advisor_candidates 这种对象数组
    if (typeof v[0] === 'object') return `- ${k}: ${JSON.stringify(v).slice(0, 400)}`;
    return `- ${k}: ${v.map(String).join('、')}`;
  }
  if (typeof v === 'object') {
    if (k === 'cv') {
      const cv = v as Record<string, unknown>;
      if (typeof cv.text === 'string') return `- cv: (已上传 CV，节选)${cv.text.slice(0, 300)}…`;
    }
    return `- ${k}: ${JSON.stringify(v).slice(0, 400)}`;
  }
  return `- ${k}: ${String(v)}`;
}

/**
 * 从 UIMessage[] 中抽出最后 ~6 轮有实质内容的对话
 * 只保留 user.text / assistant.text / assistant 的关键 UI 产出标题
 */
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
          if (input.title) textBits.push(`[AI 产出：${input.kind ?? 'draft'}] ${input.title}`);
        } else if (typeof p.type === 'string' && p.type === 'tool-showConsultantMove') {
          const input = ((p as unknown as { input?: { title?: string } }).input) ?? {};
          if (input.title) textBits.push(`[AI 判断] ${input.title}`);
        } else if (typeof p.type === 'string' && p.type === 'tool-showAdvisorDiscovery') {
          const input = ((p as unknown as { input?: { title?: string } }).input) ?? {};
          if (input.title) textBits.push(`[AI 导师探索] ${input.title}`);
        } else if (typeof p.type === 'string' && p.type === 'tool-showServicePlan') {
          const input = ((p as unknown as { input?: { title?: string } }).input) ?? {};
          if (input.title) textBits.push(`[AI 服务方案] ${input.title}`);
        } else if (typeof p.type === 'string' && p.type === 'tool-showOutreachWorkspace') {
          const input = ((p as unknown as { input?: { title?: string } }).input) ?? {};
          if (input.title) textBits.push(`[AI 工作台] ${input.title}`);
        } else if (typeof p.type === 'string' && p.type === 'tool-askOptions') {
          const input = ((p as unknown as { input?: { prompt?: string } }).input) ?? {};
          if (input.prompt) textBits.push(`[AI 问] ${input.prompt}`);
        }
      }
      const t = textBits.join(' / ').trim();
      if (t) rows.push(`AI：${t.slice(0, 300)}`);
    }
  }
  // 只取最后 12 条（含 user + assistant），大约 6 轮
  const tail = rows.slice(-12);
  return tail.length ? tail.join('\n') : '（无实质对话）';
}

function parseIcebreakerJson(text: string): IcebreakerDraft[] {
  if (!text) return [];
  // 剥离潜在的 ``` 包裹
  let s = text.trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```[a-zA-Z]*\n?/, '').replace(/```\s*$/, '').trim();
  }
  try {
    const v = JSON.parse(s);
    const drafts = Array.isArray(v?.drafts) ? (v.drafts as Array<Partial<IcebreakerDraft>>) : [];
    return drafts
      .map((d) => ({
        strategy: String(d.strategy ?? '通用'),
        text: String(d.text ?? '').trim(),
        rationale: d.rationale ? String(d.rationale) : undefined,
      }))
      .filter((d) => d.text.length > 0)
      .slice(0, 4);
  } catch {
    return [];
  }
}
