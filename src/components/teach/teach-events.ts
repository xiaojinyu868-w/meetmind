/**
 * teach-events — v32 讲课 SSE 事件契约（前端侧纯类型 + 纯函数，可单测）。
 *
 * 契约（与后端 Codex 会话层已定稿，不要改形状）：
 *   {type:'thread',threadId} / {type:'text-delta',text} /
 *   {type:'tool-call',id,name,args} / {type:'tool-result',id,result} /
 *   {type:'turn-complete'} / {type:'interrupted'} / {type:'error',message}
 * 路由（消息/打断后端在定，先按此写，收口在 teach-client.ts）：
 *   GET  /api/teach/threads                       历史列表
 *   POST /api/teach/threads                       新建（body 含 topic）
 *   POST /api/teach/threads/[id]/messages         发消息（SSE 回事件流）
 *   POST /api/teach/threads/[id]/interrupt        打断
 */

import type { BoardAction, BoardWriteRole } from '@/lib/ai-native/plugins/board-script';

export type TeachEvent =
  | { type: 'thread'; threadId: string }
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'tool-result'; id: string; result?: unknown }
  | { type: 'turn-complete' }
  | { type: 'interrupted' }
  | { type: 'error'; message: string }
  // 只出现在事件日志回放（GET .../events），SSE 订阅不会收到：学生消息记录
  | { type: 'student-message'; text: string };

/**
 * 划线引用的线格式（messages 路由定稿只收 text）：quote 拼进 text 发送，
 * 回放时按同一格式拆回引用块展示。后端后续若原生收 quote 字段，改这里一处。
 *
 * 措辞必须是完整意图（"学生指着讲义上的…问"），不能只是裸引用——
 * 裸「引用：X」模型读不懂语义，会把引用内容当新板书再写一遍（2026-08-21 实测）。
 */
export function buildWireText(text: string, quote?: string): string {
  return quote ? `学生指着讲义上的「${quote}」问：${text}` : text;
}

export function parseWireText(wire: string): { text: string; quote?: string } {
  const match = /^学生指着讲义上的「([^\n]+)」问：([\s\S]*)$/.exec(wire);
  if (!match) return { text: wire };
  return { quote: match[1], text: match[2] };
}

/** 右栏对话消息（assistant 气泡上方的工具 chip 随流追加） */
export interface TeachChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** tool-call 芯片（按到达顺序） */
  chips: Array<{ id: string; name: string }>;
  /** 划线引用提问的引用块（user 消息） */
  quote?: string;
}

/** 布局/控制类工具：不上板、不挂 chip（翻页由 hook 单独处理） */
const SILENT_TOOLS = new Set(['pause', 'new_column', 'ref', 'finish', 'flip_page']);

/** 该 tool-call 是否要在 assistant 气泡上方挂 chip */
export function isVisibleTool(name: string): boolean {
  return !SILENT_TOOLS.has(name);
}

/**
 * tool-call → 画布效果（纯函数）：
 * - append：write/circle/underline/arrow/mark/new_column/image 转成 BoardAction 追加到当前页
 * - flip：flip_page 开新页
 * - none：pause/ref/ask/finish 不直接产生板面动作（ask 走对话，ref 二期）
 */
export type BoardEffect =
  | { type: 'append'; action: BoardAction }
  | { type: 'flip' }
  | { type: 'none' };

const WRITE_ROLES: ReadonlySet<string> = new Set(['title', 'term', 'step', 'note', 'formula']);

export function boardEffectOf(name: string, args: Record<string, unknown>): BoardEffect {
  switch (name) {
    case 'write': {
      const text = typeof args.text === 'string' ? args.text : '';
      if (!text) return { type: 'none' };
      const role = WRITE_ROLES.has(String(args.role)) ? (args.role as BoardWriteRole) : 'step';
      return { type: 'append', action: { type: 'write', text, role } };
    }
    case 'circle':
      return { type: 'append', action: { type: 'circle', target: (args.target as string | string[]) ?? 'w1' } };
    case 'underline':
      return { type: 'append', action: { type: 'underline', target: (args.target as string | string[]) ?? 'w1' } };
    case 'arrow':
      return {
        type: 'append',
        action: {
          type: 'arrow',
          from: String(args.from ?? 'w1'),
          to: String(args.to ?? 'w1'),
          ...(typeof args.label === 'string' ? { label: args.label } : {}),
        },
      };
    case 'mark':
      return {
        type: 'append',
        action: {
          type: 'mark',
          mark: args.mark === 'cross' ? 'cross' : 'check',
          target: String(args.target ?? 'w1'),
        },
      };
    case 'new_column':
      return { type: 'append', action: { type: 'new_column' } };
    case 'image':
      return {
        type: 'append',
        action: {
          type: 'image',
          url: typeof args.url === 'string' ? args.url : '',
          ...(typeof args.prompt === 'string' ? { prompt: args.prompt } : {}),
          ...(typeof args.caption === 'string' ? { caption: args.caption } : {}),
        },
      };
    case 'flip_page':
      return { type: 'flip' };
    default:
      return { type: 'none' };
  }
}

/** tool-call（name+args）→ BoardAction（mock 把 BoardScript 动作翻译成事件时用） */
export function boardActionToToolCall(
  action: BoardAction,
  id: string,
): Extract<TeachEvent, { type: 'tool-call' }> {
  const { type, ...rest } = action;
  return { type: 'tool-call', id, name: type, args: rest };
}
