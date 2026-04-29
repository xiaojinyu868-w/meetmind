/**
 * consult-session-service —— 学生端对话归档（M.8 去场景化版）
 *
 * 对话归档的单元不再是"一个场景"，而是"一个学生对这个机构的一次连续对话"。
 * 即便 agent 中途从"套磁起草"跳到"CV 诊断"再跳回"选校"，都是同一条 session。
 *
 * 唯一键：(orgId, studentKey)
 * 变化字段：
 *   - activeScenarioName  记录 agent 最近一次 useSkill 的剧本名（用于机构"当下在谈什么"）
 *   - visitedScenarios    逗号拼接历史激活过的剧本，机构端可看到"这个学生跟 AI 聊过哪些事"
 *
 * 归档 callback（onFinish）里无需提交 scenarioName；激活 skill 时由 useSkill tool
 * 独立调 `markSessionScenario` 推进 active/visited 状态。
 */

import { prisma } from '@/lib/prisma';
import type { UIMessage } from 'ai';

export interface UpsertSessionInput {
  orgId: string;
  studentKey: string;
  runtime?: string;
  messages: UIMessage[];
}

/**
 * 每轮对话收尾时调：覆盖 messagesJson。
 * 不会碰 activeScenarioName/visitedScenarios — 那两个由 useSkill 专门推进。
 * 返回 sessionId。
 */
export async function upsertSession(input: UpsertSessionInput): Promise<string> {
  const { orgId, studentKey, runtime = 'aisdk', messages } = input;

  if (!Array.isArray(messages) || messages.length === 0) {
    const existing = await prisma.consultSession.findUnique({
      where: { orgId_studentKey: { orgId, studentKey } },
      select: { id: true },
    });
    return existing?.id ?? '';
  }

  const json = safeStringify(messages);
  const rec = await prisma.consultSession.upsert({
    where: { orgId_studentKey: { orgId, studentKey } },
    update: { messagesJson: json, messageCount: messages.length, runtime },
    create: {
      orgId, studentKey, runtime,
      messagesJson: json,
      messageCount: messages.length,
    },
  });
  return rec.id;
}

/**
 * 当 agent 调用 useSkill 时推进 session 状态：
 *   - activeScenarioName 置为新 skill
 *   - visitedScenarios 去重追加
 * 如果 session 还不存在（极少数：useSkill 是会话第一个动作，尚未 upsertSession 过），
 * 就创建一条空 session 先占位。
 */
export async function markSessionScenario(
  orgId: string,
  studentKey: string,
  scenarioName: string,
): Promise<void> {
  const existing = await prisma.consultSession.findUnique({
    where: { orgId_studentKey: { orgId, studentKey } },
    select: { id: true, visitedScenarios: true },
  });
  const nextVisited = appendUnique(existing?.visitedScenarios ?? '', scenarioName);
  if (existing) {
    await prisma.consultSession.update({
      where: { id: existing.id },
      data: {
        activeScenarioName: scenarioName,
        visitedScenarios: nextVisited,
      },
    });
  } else {
    await prisma.consultSession.create({
      data: {
        orgId, studentKey,
        activeScenarioName: scenarioName,
        visitedScenarios: nextVisited,
      },
    });
  }
}

export async function getActiveScenario(orgId: string, studentKey: string): Promise<string | null> {
  const s = await prisma.consultSession.findUnique({
    where: { orgId_studentKey: { orgId, studentKey } },
    select: { activeScenarioName: true },
  });
  return s?.activeScenarioName ?? null;
}

/**
 * createLead 时用：找到当前 session id（不区分场景）
 */
export async function findSessionIdByStudent(orgId: string, studentKey: string): Promise<string | null> {
  const s = await prisma.consultSession.findUnique({
    where: { orgId_studentKey: { orgId, studentKey } },
    select: { id: true },
  });
  return s?.id ?? null;
}

/**
 * 机构详情页用：读完整对话
 */
export async function getSessionMessages(sessionId: string): Promise<{
  messages: UIMessage[];
  activeScenarioName: string | null;
  visitedScenarios: string[];
  runtime: string;
  messageCount: number;
  startedAt: Date;
  updatedAt: Date;
} | null> {
  const s = await prisma.consultSession.findUnique({ where: { id: sessionId } });
  if (!s) return null;
  let parsed: UIMessage[] = [];
  try { parsed = JSON.parse(s.messagesJson) as UIMessage[]; } catch { parsed = []; }
  return {
    messages: parsed,
    activeScenarioName: s.activeScenarioName,
    visitedScenarios: parseVisited(s.visitedScenarios),
    runtime: s.runtime,
    messageCount: s.messageCount,
    startedAt: s.startedAt,
    updatedAt: s.updatedAt,
  };
}

// ─────────────── helpers ───────────────

function safeStringify(v: unknown): string {
  try { return JSON.stringify(v); } catch { return '[]'; }
}

function parseVisited(raw: string): string[] {
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function appendUnique(raw: string, name: string): string {
  const parts = parseVisited(raw);
  if (parts.includes(name)) return raw;
  parts.push(name);
  return parts.join(',');
}
