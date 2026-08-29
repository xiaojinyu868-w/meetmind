/**
 * 分身持久化：FenshenEgo（prisma，分身架列表）
 * + 每分身事件日志落盘（data/fenshen-events/<egoId>.jsonl，供重放）。
 *
 * distillThreadId / chatThreadId 在对应 codex 线程拉起后回填；进程回收/重启
 * 后凭它们 thread/resume 续跑。事件日志是 append-only JSONL，每行一个
 * FenshenLogEvent（蒸馏与对话事件共一条流）。
 */

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@/lib/prisma';
import { FenshenConfig } from './fenshen-config';
import type { FenshenLogEvent } from './event-bus';

export type FenshenSourceType = 'hall' | 'bilibili' | 'upload';
export type FenshenEgoStatus = 'learning' | 'ready' | 'failed';

/** 服务层错误（code + HTTP status），路由薄壳据此映射响应 */
export class FenshenServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface FenshenEgoRow {
  id: string;
  name: string;
  sourceType: string;
  sourceRef: string;
  status: string;
  skillPath: string | null;
  distillThreadId: string | null;
  chatThreadId: string | null;
  model: string;
  failReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function createEgo(params: {
  name: string;
  sourceType: FenshenSourceType;
  sourceRef?: string;
  model: string;
}): Promise<FenshenEgoRow> {
  const name = params.name.trim();
  return prisma.fenshenEgo.create({
    data: {
      name,
      sourceType: params.sourceType,
      sourceRef: (params.sourceRef ?? '').trim(),
      model: params.model,
    },
  });
}

export async function listEgos(limit = 50): Promise<FenshenEgoRow[]> {
  return prisma.fenshenEgo.findMany({
    orderBy: { updatedAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 200),
  });
}

export async function getEgo(id: string): Promise<FenshenEgoRow | null> {
  return prisma.fenshenEgo.findUnique({ where: { id } });
}

export async function setDistillThreadId(id: string, distillThreadId: string): Promise<void> {
  await prisma.fenshenEgo.update({ where: { id }, data: { distillThreadId } });
}

export async function setChatThreadId(id: string, chatThreadId: string): Promise<void> {
  await prisma.fenshenEgo.update({ where: { id }, data: { chatThreadId } });
}

/** 状态流转（learning → ready / failed）；ready 时回填 skillPath，failed 时记人可读原因 */
export async function setEgoStatus(
  id: string,
  status: FenshenEgoStatus,
  extra?: { skillPath?: string; failReason?: string },
): Promise<void> {
  await prisma.fenshenEgo.update({
    where: { id },
    data: {
      status,
      ...(extra?.skillPath !== undefined ? { skillPath: extra.skillPath } : {}),
      ...(extra?.failReason !== undefined ? { failReason: extra.failReason } : {}),
      ...(status === 'ready' ? { failReason: null } : {}),
    },
  });
}

/** 触碰 updatedAt（新消息/新事件时让分身架排序正确） */
export async function touchEgo(id: string): Promise<void> {
  await prisma.fenshenEgo.update({ where: { id }, data: {} });
}

// ---------- 事件日志（append-only JSONL） ----------

function eventLogPath(egoId: string): string {
  // egoId 是服务端生成的 cuid，无路径分隔符；仍防一手
  const safe = egoId.replace(/[^a-zA-Z0-9_-]/g, '');
  // resolve：eventLogDir 相对则拼 cwd，绝对（测试注入临时目录）则原样用
  return path.join(path.resolve(process.cwd(), FenshenConfig.eventLogDir), `${safe}.jsonl`);
}

export async function appendEgoEvent(egoId: string, event: FenshenLogEvent): Promise<void> {
  const file = eventLogPath(egoId);
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, JSON.stringify({ ts: Date.now(), ...event }) + '\n', 'utf8');
}

export async function readEgoEvents(egoId: string): Promise<FenshenLogEvent[]> {
  let text: string;
  try {
    text = await readFile(eventLogPath(egoId), 'utf8');
  } catch {
    return []; // 没有日志 = 还没开始
  }
  const events: FenshenLogEvent[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as FenshenLogEvent);
    } catch {
      // 跳过畸形行（进程中途被杀可能留半行）
    }
  }
  return events;
}
