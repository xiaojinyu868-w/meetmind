/**
 * teach-events — v32 讲课 SSE 事件契约（前端侧纯类型 + 纯函数，可单测）。
 *
 * 契约（与后端 Codex 会话层已定稿，不要改形状）：
 *   {type:'thread',threadId} / {type:'text-delta',text} /
 *   {type:'tool-call',id,name,args} / {type:'tool-result',id,result} /
 *   {type:'turn-complete'} / {type:'interrupted'} / {type:'error',message} /
 *   {type:'image-ready',id,url}（插图回填完成：id = image tool-call 的 id）
 * 路由（消息/打断后端在定，先按此写，收口在 teach-client.ts）：
 *   GET  /api/teach/threads                       历史列表
 *   POST /api/teach/threads                       新建（body 含 topic）
 *   POST /api/teach/threads/[id]/messages         发消息（SSE 回事件流）
 *   POST /api/teach/threads/[id]/interrupt        打断
 */

import type { BoardAction, BoardImageAction, BoardPage, BoardWriteRole } from '@/lib/ai-native/plugins/board-script';

export type TeachEvent =
  | { type: 'thread'; threadId: string }
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'tool-result'; id: string; result?: unknown }
  | { type: 'turn-complete' }
  | { type: 'interrupted' }
  | { type: 'image-ready'; id: string; url: string }
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

/** 布局/控制类工具：不上板、不挂 chip（翻页由 hook 单独处理）。
 *  含新引擎（teach-engine）词表的静默动作：speech 是口播（文本走 text-delta）、
 *  discussion 语义同样在 text-delta、wb_open/wb_close 对常开画布无 UI 意义。 */
const SILENT_TOOLS = new Set([
  'pause',
  'new_column',
  'ref',
  'finish',
  'flip_page',
  'speech',
  'discussion',
  'wb_open',
  'wb_close',
]);

/** 该 tool-call 是否要在 assistant 气泡上方挂 chip */
export function isVisibleTool(name: string): boolean {
  return !SILENT_TOOLS.has(name);
}

/**
 * 新引擎（teach-engine）标题跟随：prompt 约定首条 wb_draw_text 内容为课题标题
 * （对应旧线 write role=title；useTeachSession 按线程记「首条已消费」后调用）。
 * 命中返回剥签后的标题 + 注入 role:'title' 的 args（boardEffectOf 据它上 title 字阶）。
 */
export function engineTitleFollow(
  name: string,
  args: Record<string, unknown>,
): { title: string; args: Record<string, unknown> } | null {
  if (name !== 'wb_draw_text') return null;
  const content =
    typeof args.content === 'string' ? args.content.replace(/<[^>]+>/g, '').trim() : '';
  if (!content) return null;
  return { title: content, args: { ...args, role: 'title' } };
}

/**
 * tool-call → 画布效果（纯函数）：
 * - append：write/circle/underline/arrow/mark/new_column/image 转成 BoardAction 追加到当前页
 * - flip：flip_page 开新页
 * - none：pause/ref/ask/finish 不直接产生板面动作（ask 走对话，ref 二期）
 *
 * 双词汇（P1-B）：新引擎 teach-engine 的动作名（wb_draw_text/wb_draw_latex/
 * spotlight/laser/wb_clear/wb_open/wb_close/discussion/speech）在下方独立分支
 * 映射到同一套 BoardAction；legacy 词表分支永久保留（旧线程日志回放依赖它）。
 */
export type BoardEffect =
  | { type: 'append'; action: BoardAction }
  | { type: 'flip' }
  | { type: 'none' };

const WRITE_ROLES: ReadonlySet<string> = new Set(['title', 'term', 'step', 'note', 'formula']);

export function boardEffectOf(name: string, args: Record<string, unknown>, callId?: string): BoardEffect {
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
          // 回填定位键：image-ready 事件按它找到这个占位动作
          ...(callId ? { callId } : {}),
        },
      };
    case 'flip_page':
      return { type: 'flip' };
    // ── 新引擎（teach-engine）动作词表（P1-B；与 legacy 词表永久并存——
    //    15 个 legacy 线程的事件日志靠旧分支回放）─────────────────────
    case 'wb_draw_text': {
      // content 可能带 vendor 富文本标签，上板/标题前剥掉（与服务端 digest 同规则）
      const content =
        typeof args.content === 'string' ? args.content.replace(/<[^>]+>/g, '').trim() : '';
      if (!content) return { type: 'none' };
      // 词表无 role：首条 = 课题标题（useTeachSession 注入 role:'title'，prompt 契约），其余正文 step
      const role: BoardWriteRole = args.role === 'title' ? 'title' : 'step';
      return { type: 'append', action: { type: 'write', text: content, role } };
    }
    case 'wb_draw_latex': {
      const latex = typeof args.latex === 'string' ? args.latex.trim() : '';
      if (!latex) return { type: 'none' };
      return { type: 'append', action: { type: 'write', text: latex, role: 'formula' } };
    }
    case 'spotlight': {
      // 引擎元素 id 约定 a_${n}（单写者，action-map.ts ensureElementId），
      // 映射到画布 wN 引用；自定义 id 无法对号时原样透传（渲染层找不到目标 = 不画）
      const elementId = typeof args.elementId === 'string' ? args.elementId : '';
      const match = /^a_(\d+)$/.exec(elementId);
      return { type: 'append', action: { type: 'circle', target: match ? `w${match[1]}` : elementId || 'w1' } };
    }
    case 'laser':
      // P1 降级：画布无激光笔渲染原语，先不上板（P3 vendor UI 接入时换真渲染）
      return { type: 'none' };
    case 'wb_clear':
      return { type: 'append', action: { type: 'clear' } };
    // wb_open / wb_close / discussion：none——画布常开；气泡语义在 text-delta。
    // v1 词表外动作（wb_draw_shape/table/line/code、wb_edit_code 等，仅
    // TEACH_ACTIONS_FULL=1 时出现）走 default 降级 none，渲染器留待后续期。
    default:
      return { type: 'none' };
  }
}

/**
 * image-ready 回填（纯函数）：把 callId 对应的占位 image 动作的 url 填上。
 * 返回新 pages（不可变更新）；找不到匹配动作（或已有 url）返回 null。
 */
export function applyImageUrlToBoard(pages: BoardPage[], callId: string, url: string): BoardPage[] | null {
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const segment = pages[pageIndex].segments[0];
    if (!segment || segment.type !== 'narration') continue;
    const actionIndex = segment.actions.findIndex(
      (action) => action.type === 'image' && action.callId === callId && !action.url,
    );
    if (actionIndex < 0) continue;
    const action = segment.actions[actionIndex] as BoardImageAction;
    const nextActions = [...segment.actions];
    nextActions[actionIndex] = { ...action, url };
    const nextPages = [...pages];
    nextPages[pageIndex] = { ...pages[pageIndex], segments: [{ ...segment, actions: nextActions }] };
    return nextPages;
  }
  return null;
}

/** tool-call（name+args）→ BoardAction（mock 把 BoardScript 动作翻译成事件时用） */
export function boardActionToToolCall(
  action: BoardAction,
  id: string,
): Extract<TeachEvent, { type: 'tool-call' }> {
  const { type, ...rest } = action;
  return { type: 'tool-call', id, name: type, args: rest };
}
