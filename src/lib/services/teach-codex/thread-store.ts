/**
 * 教学线程持久化：TeachThread（prisma，对齐 ChatGPT 语义的历史课程列表）
 * + 每线程事件日志落盘（data/teach-events/<threadId>.jsonl，供重放/复习线）。
 *
 * codexThreadId 在首个 turn 拉起 codex 线程后回填；进程回收/重启后凭它
 * thread/resume 续讲。事件日志是 append-only JSONL，每行一个 TeachStreamEvent。
 */

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import type { LearnerContext } from '@/types/learner-context';
import { formatLearnerContextForPrompt, parseLearnerContext } from '@/lib/services/learner-context-service';
import path from 'node:path';
import { prisma } from '@/lib/prisma';
import { TeachConfig } from '@/lib/config/teach.config';
import type { TeachLogEvent } from './event-bus';

export interface TeachThreadRow {
  id: string;
  title: string;
  topic: string;
  model: string;
  codexThreadId: string | null;
  /** 创建时按 TEACH_ENGINE 快照的引擎归属（codex | engine）；null = 旧线程按 codex */
  engine: string | null;
  /** 开课时带来的 LearnerContext（JSON 字符串）；null = 没带。两条线在会话建立时都据此拼「关于这位学生」 */
  learnerJson: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export async function createThread(params: {
  topic: string;
  model: string;
  engine?: string;
  /** 已校验的 LearnerContext（route 层 parseLearnerContext 过） */
  learner?: LearnerContext | null;
}): Promise<TeachThreadRow> {
  const topic = params.topic.trim();
  return prisma.teachThread.create({
    data: {
      topic,
      title: topic.slice(0, 30) || '教学课',
      model: params.model,
      engine: params.engine ?? null,
      learnerJson: params.learner ? JSON.stringify(params.learner) : null,
    },
  });
}

/** 行上的切片 → 可进 prompt 的事实段落（空 / 坏 JSON 都是 ''） */
export function learnerFactsFromRow(row: Pick<TeachThreadRow, 'learnerJson'>): string {
  if (!row.learnerJson) return '';
  try {
    return formatLearnerContextForPrompt(parseLearnerContext(JSON.parse(row.learnerJson)));
  } catch {
    return '';
  }
}

export async function listThreads(limit = 50): Promise<TeachThreadRow[]> {
  return prisma.teachThread.findMany({
    where: { status: 'active' },
    orderBy: { updatedAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 200),
  });
}

export async function getThread(id: string): Promise<TeachThreadRow | null> {
  return prisma.teachThread.findUnique({ where: { id } });
}

export async function setCodexThreadId(id: string, codexThreadId: string): Promise<void> {
  await prisma.teachThread.update({ where: { id }, data: { codexThreadId } });
}

/** 触碰 updatedAt（新消息/新事件时让历史列表排序正确） */
export async function touchThread(id: string): Promise<void> {
  await prisma.teachThread.update({ where: { id }, data: {} });
}

/** 课程改名（agent 写下正式课题标题时跟随——中途换题后历史列表/页头不再停留在旧课题） */
export async function renameThread(id: string, title: string): Promise<void> {
  const clean = title.trim().slice(0, 60);
  if (!clean) return;
  await prisma.teachThread.update({ where: { id }, data: { title: clean } });
}

// ---------- 事件日志（append-only JSONL） ----------

function eventLogPath(threadId: string): string {
  // threadId 是服务端生成的 cuid，无路径分隔符；仍防一手
  const safe = threadId.replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(process.cwd(), TeachConfig.eventLogDir, `${safe}.jsonl`);
}

export async function appendThreadEvent(threadId: string, event: TeachLogEvent): Promise<void> {
  const file = eventLogPath(threadId);
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, JSON.stringify({ ts: Date.now(), ...event }) + '\n', 'utf8');
}

export async function readThreadEvents(threadId: string): Promise<TeachLogEvent[]> {
  let text: string;
  try {
    text = await readFile(eventLogPath(threadId), 'utf8');
  } catch {
    return []; // 没有日志 = 还没讲过
  }
  const events: TeachLogEvent[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as TeachLogEvent);
    } catch {
      // 跳过畸形行（进程中途被杀可能留半行）
    }
  }
  return events;
}
