/**
 * BoardEnv 按线程维护（Next 侧）+ 工具描述/执行。
 *
 * 工具 schema 的单一事实源是 teach-agent/tools.ts（createTeachTools）——
 * 本模块只做三件事，绝不复制 schema：
 *   1. listTeachToolDescriptors：z.toJSONSchema 导 MCP tools/list 描述
 *   2. executeTeachTool：内部回调入口——校验参数 → execute 就地改 BoardEnv
 *      → 返回 digest（{ok, board: "第N页 · 第M栏 · w1…"}，格式沿用 tools.ts）
 *   3. rebuildBoardEnv：Next 重启后从事件日志重放 tool-call 恢复环境
 *
 * 注意：不暴露 ask 工具（无 ask 阻塞结构，教学提问走自然轮次）。
 */

import { z } from 'zod';
import { createBoardEnv, createTeachTools, type BoardEnv } from '@/lib/services/teach-agent/tools';
import type { TeachLogEvent } from './event-bus';
import { readThreadEvents } from './thread-store';

/** 暴露给 codex 的教学工具集合（用户拍板 11 个；ask 不在其中） */
export const TEACH_CODEX_TOOL_NAMES = [
  'write',
  'circle',
  'underline',
  'arrow',
  'mark',
  'new_column',
  'flip_page',
  'image',
  'ref',
  'pause',
  'finish',
] as const;

export type TeachCodexToolName = (typeof TEACH_CODEX_TOOL_NAMES)[number];

export interface TeachToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

type ToolEntry = {
  description?: string;
  inputSchema: z.ZodTypeAny;
  execute?: (input: never) => Promise<unknown>;
};

function toolEntries(env: BoardEnv): Partial<Record<TeachCodexToolName, ToolEntry>> {
  const tools = createTeachTools(env) as unknown as Record<string, ToolEntry>;
  const out: Partial<Record<TeachCodexToolName, ToolEntry>> = {};
  for (const name of TEACH_CODEX_TOOL_NAMES) out[name] = tools[name];
  return out;
}

/** MCP tools/list 用的描述（inputSchema 已是 JSON Schema） */
export function listTeachToolDescriptors(): TeachToolDescriptor[] {
  const entries = toolEntries(createBoardEnv());
  return TEACH_CODEX_TOOL_NAMES.map((name) => {
    const entry = entries[name];
    if (!entry) throw new Error(`teach-agent/tools.ts 缺少工具: ${name}`);
    return {
      name,
      description: entry.description ?? '',
      inputSchema: z.toJSONSchema(entry.inputSchema) as Record<string, unknown>,
    };
  });
}

/** 执行一个工具：zod 校验（失败回 ok:false 让模型自纠）→ execute → digest */
export async function runTeachTool(
  env: BoardEnv,
  name: string,
  args: unknown,
): Promise<Record<string, unknown>> {
  const entry = toolEntries(env)[name as TeachCodexToolName];
  if (!entry?.execute) {
    return { ok: false, error: `未知工具: ${name}` };
  }
  const parsed = entry.inputSchema.safeParse(args ?? {});
  if (!parsed.success) {
    return { ok: false, error: `参数不合法: ${parsed.error.issues.map((i) => i.message).join('; ')}` };
  }
  const result = await entry.execute(parsed.data as never);
  return (result ?? { ok: true }) as Record<string, unknown>;
}

/** 从事件日志重放 tool-call，恢复 BoardEnv（失败的调用不改环境，重放天然一致） */
export async function rebuildBoardEnv(events: TeachLogEvent[]): Promise<BoardEnv> {
  const env = createBoardEnv();
  for (const event of events) {
    if (event.type !== 'tool-call') continue;
    await runTeachTool(env, event.name, event.args);
  }
  return env;
}

// ---------- 按线程的 env 缓存（进程内；重启后从事件日志重放） ----------

interface EnvState {
  envs: Map<string, BoardEnv>;
  pending: Map<string, Promise<BoardEnv>>;
}

const globalForEnv = globalThis as unknown as { __teachBoardEnvs?: EnvState };
const state: EnvState = globalForEnv.__teachBoardEnvs ?? { envs: new Map(), pending: new Map() };
globalForEnv.__teachBoardEnvs = state;

export async function getBoardEnv(threadId: string): Promise<BoardEnv> {
  const cached = state.envs.get(threadId);
  if (cached) return cached;
  const inflight = state.pending.get(threadId);
  if (inflight) return inflight;
  const rebuilding = (async () => {
    const env = await rebuildBoardEnv(await readThreadEvents(threadId));
    state.envs.set(threadId, env);
    state.pending.delete(threadId);
    return env;
  })();
  state.pending.set(threadId, rebuilding);
  return rebuilding;
}

/** 内部回调入口：取线程 env → 执行 → 返回 digest（env 已就地更新） */
export async function executeTeachTool(
  threadId: string,
  name: string,
  args: unknown,
): Promise<Record<string, unknown>> {
  const env = await getBoardEnv(threadId);
  return runTeachTool(env, name, args);
}
