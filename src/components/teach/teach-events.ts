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

import type { BoardAction, BoardCodeAction, BoardImageAction, BoardPage, BoardWriteRole } from '@/lib/ai-native/plugins/board-script';
import { codeTextToLines } from '@/lib/ai-native/plugins/board-script';

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
 * 引擎 elementId → 画布定位键的对应表（P1 补丁；P3 扩展到结构化块）。
 * prompt 契约鼓励模型用语义 id（title/formula/def1…），而画布元素按 write
 * 序号编号为 w1..wN（board-lecture flattenPage：每页最后一次 clear 之后从 w1 起）。
 * 逐事件跟踪 tool-call 流即可把 spotlight/laser 的语义 id 翻成 wN；
 * 直播与日志回放走同一 applyEvent 路径，无需两处维护。
 *
 * P3 结构化块（shape/table/line/code）：不占 wN，登记为 `e:<id>` 前缀值——
 * 否则自动 id a_N 会被 boardEffectOf 的 a_N→wN 兜底直译错号（a_3 是代码块
 * 时绝不能翻成 w3）。boardEffectOf 认出 e: 前缀后剥掉，target = 块的
 * elementId（渲染层 BoardFlow 按它命中块内圈注 / BoardLaser 按它 DOM 定位）。
 */
export type ElementIdResolver = {
  /** 传入 tool-call 的 name/args，返回翻译后的 args（spotlight/laser 命中对应表时改写 elementId）。 */
  trackToolCall: (name: string, args: Record<string, unknown>) => Record<string, unknown>;
  reset: () => void;
};

/** 会产生 write 上板（占用一个 wN 编号）的新引擎动作。 */
const WRITE_PRODUCING = new Set(['wb_draw_text', 'wb_draw_latex']);

/** 落结构化块（不占 wN，登记 e: 前缀）的新引擎动作。 */
const BLOCK_PRODUCING = new Set(['wb_draw_shape', 'wb_draw_table', 'wb_draw_line', 'wb_draw_code']);

export function createElementIdResolver(): ElementIdResolver {
  let writeCount = 0;
  const map = new Map<string, string>();
  return {
    trackToolCall(name, args) {
      if (name === 'wb_clear' || name === 'flip_page') {
        writeCount = 0;
        map.clear();
        return args;
      }
      if (WRITE_PRODUCING.has(name)) {
        writeCount += 1;
        const elementId = typeof args.elementId === 'string' ? args.elementId : '';
        if (elementId) map.set(elementId, `w${writeCount}`);
        return args;
      }
      if (BLOCK_PRODUCING.has(name)) {
        const elementId = typeof args.elementId === 'string' ? args.elementId : '';
        if (elementId) map.set(elementId, `e:${elementId}`);
        return args;
      }
      if (name === 'spotlight' || name === 'laser') {
        const elementId = typeof args.elementId === 'string' ? args.elementId : '';
        const resolved = map.get(elementId);
        if (resolved) return { ...args, elementId: resolved };
      }
      return args;
    },
    reset() {
      writeCount = 0;
      map.clear();
    },
  };
}

/**
 * tool-call → 画布效果（纯函数）：
 * - append：write/circle/underline/arrow/mark/new_column/image/结构化块 转成 BoardAction 追加到当前页
 * - flip：flip_page 开新页
 * - laser：瞬态特效（指向某元素的光圈，2.4s 淡出，不留永久板书；
 *   useTeachSession 只在 live 时渲染，回放跳过）
 * - edit-code：wb_edit_code 的行级编辑（applyCodeEditToBoard 按 elementId 定位更新）
 * - none：pause/ref/ask/finish 不直接产生板面动作（ask 走对话，ref 二期）
 *
 * 双词汇（P1-B）：新引擎 teach-engine 的动作名在下方独立分支映射到同一套
 * BoardAction；legacy 词表分支永久保留（旧线程日志回放依赖它）。
 */
export type BoardEffect =
  | { type: 'append'; action: BoardAction }
  | { type: 'flip' }
  | { type: 'laser'; target: string; color?: string }
  | { type: 'edit-code'; edit: CodeEdit }
  | { type: 'none' };

/** wb_edit_code 的行级编辑载荷（vendor WbEditCodeAction 同构）。 */
export interface CodeEdit {
  elementId: string;
  operation: 'insert_after' | 'insert_before' | 'delete_lines' | 'replace_lines';
  lineId?: string;
  lineIds?: string[];
  content?: string;
}

/** spotlight/laser 的 elementId → 画布 target：e: 前缀剥壳（结构化块）、
 *  a_${n} 兜底直译 wN（引擎缺省 id 约定）、其余原样透传（找不到目标 = 不画）。 */
function resolveElementTarget(elementId: string): string {
  if (elementId.startsWith('e:')) return elementId.slice(2);
  const match = /^a_(\d+)$/.exec(elementId);
  if (match) return `w${match[1]}`;
  return elementId;
}

/** 透传 args 里的字符串字段（存在才带上）。 */
function pickString(args: Record<string, unknown>, key: string): string | undefined {
  return typeof args[key] === 'string' && args[key] ? (args[key] as string) : undefined;
}

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
      // elementId 到画布 wN / 块 id 的翻译在 useTeachSession 经 createElementIdResolver
      // 完成（语义 id 已在上游翻成 wN 或 e:<id>）；这里剥 e: 壳 + 兜底 a_${n} 直译，
      // 其余原样透传（渲染层找不到目标 = 不画）
      const elementId = typeof args.elementId === 'string' ? args.elementId : '';
      return { type: 'append', action: { type: 'circle', target: resolveElementTarget(elementId) || 'w1' } };
    }
    case 'laser': {
      // P3 真渲染：瞬态光圈（BoardEffect.laser，useTeachSession 只在 live 落地，
      // 回放跳过）；target 解析与 spotlight 同规则
      const elementId = typeof args.elementId === 'string' ? args.elementId : '';
      const target = resolveElementTarget(elementId);
      if (!target) return { type: 'none' };
      const color = pickString(args, 'color');
      return { type: 'laser', target, ...(color ? { color } : {}) };
    }
    case 'wb_clear':
      return { type: 'append', action: { type: 'clear' } };
    // ── 全量词表（P3 渲染器补齐）：shape/table/line/code 成结构化块上板 ──
    case 'wb_draw_shape': {
      const shape = args.shape === 'circle' || args.shape === 'triangle' ? args.shape : 'rectangle';
      const width = Number(args.width);
      const height = Number(args.height);
      const aspect = Number.isFinite(width) && Number.isFinite(height) && height > 0 && width > 0 ? width / height : undefined;
      return {
        type: 'append',
        action: {
          type: 'shape',
          shape,
          ...(aspect ? { aspect } : {}),
          ...(pickString(args, 'fillColor') ? { fill: pickString(args, 'fillColor') } : {}),
          ...(pickString(args, 'label') ? { label: pickString(args, 'label') } : {}),
          ...(pickString(args, 'elementId') ? { elementId: pickString(args, 'elementId') } : {}),
        },
      };
    }
    case 'wb_draw_table': {
      // data = string[][]（首行表头）；逐格 String() 归一，空行/空数据不上板
      const raw = Array.isArray(args.data) ? args.data : [];
      const data = raw
        .filter((row): row is unknown[] => Array.isArray(row))
        .map((row) => row.map((cell) => String(cell ?? '')))
        .filter((row) => row.length > 0);
      if (data.length === 0) return { type: 'none' };
      return {
        type: 'append',
        action: {
          type: 'table',
          data,
          ...(pickString(args, 'elementId') ? { elementId: pickString(args, 'elementId') } : {}),
        },
      };
    }
    case 'wb_draw_line': {
      const nums = [args.startX, args.startY, args.endX, args.endY].map(Number);
      if (nums.some((n) => !Number.isFinite(n))) return { type: 'none' };
      const points = Array.isArray(args.points) ? args.points : [];
      const arrowStart = points[0] === 'arrow';
      const arrowEnd = points[1] === 'arrow';
      return {
        type: 'append',
        action: {
          type: 'line',
          start: { x: nums[0], y: nums[1] },
          end: { x: nums[2], y: nums[3] },
          ...(args.style === 'dashed' ? { dashed: true } : {}),
          ...(arrowStart || arrowEnd
            ? { arrow: arrowStart && arrowEnd ? ('both' as const) : arrowStart ? ('start' as const) : ('end' as const) }
            : {}),
          ...(pickString(args, 'elementId') ? { elementId: pickString(args, 'elementId') } : {}),
        },
      };
    }
    case 'wb_draw_code': {
      const code = typeof args.code === 'string' ? args.code.replace(/\r\n/g, '\n').replace(/\s+$/, '') : '';
      if (!code.trim()) return { type: 'none' };
      return {
        type: 'append',
        action: {
          type: 'code',
          language: pickString(args, 'language') ?? '',
          ...(pickString(args, 'fileName') ? { fileName: pickString(args, 'fileName') } : {}),
          lines: codeTextToLines(code),
          ...(pickString(args, 'elementId') ? { elementId: pickString(args, 'elementId') } : {}),
        },
      };
    }
    case 'wb_edit_code': {
      const elementId = pickString(args, 'elementId');
      const operation = pickString(args, 'operation');
      if (
        !elementId ||
        (operation !== 'insert_after' &&
          operation !== 'insert_before' &&
          operation !== 'delete_lines' &&
          operation !== 'replace_lines')
      ) {
        return { type: 'none' };
      }
      const lineIds = Array.isArray(args.lineIds) ? args.lineIds.map(String) : undefined;
      return {
        type: 'edit-code',
        edit: {
          elementId,
          operation,
          ...(pickString(args, 'lineId') ? { lineId: pickString(args, 'lineId') } : {}),
          ...(lineIds && lineIds.length > 0 ? { lineIds } : {}),
          ...(pickString(args, 'content') ? { content: pickString(args, 'content') } : {}),
        },
      };
    }
    // wb_open / wb_close / discussion / speech：none——画布常开；气泡语义在 text-delta。
    // wb_draw_chart / wb_delete / play_video / widget_*（全量词表内但无对应
    // 渲染原语）走 default 降级 none，模型在板上的该次落笔不呈现、不炸板。
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

/**
 * wb_edit_code 落板（纯函数）：按 elementId 找到画布上的 code 块动作，行级
 * 编辑（vendor executeWbEditCode 同规则：insert_after/before 按 lineId 定位、
 * delete/replace 按 lineIds；新插入行分配新 id——模型拿不到新 id，与 vendor
 * 引擎侧行为一致）。返回新 pages（不可变更新）；找不到目标 / 定位行不存在
 * 返回 null（引擎侧同参数也会 no-op，两侧同步降级）。
 */
export function applyCodeEditToBoard(pages: BoardPage[], edit: CodeEdit): BoardPage[] | null {
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const segment = pages[pageIndex].segments[0];
    if (!segment || segment.type !== 'narration') continue;
    const actionIndex = segment.actions.findIndex(
      (action) => action.type === 'code' && action.elementId === edit.elementId,
    );
    if (actionIndex < 0) continue;
    const action = segment.actions[actionIndex];
    if (action.type !== 'code') continue;
    const nextLines = applyCodeEdit(action.lines, edit, `${pageIndex}_${actionIndex}`);
    if (!nextLines) return null;
    const nextActions = [...segment.actions];
    nextActions[actionIndex] = { ...action, lines: nextLines };
    const nextPages = [...pages];
    nextPages[pageIndex] = { ...pages[pageIndex], segments: [{ ...segment, actions: nextActions }] };
    return nextPages;
  }
  return null;
}

/** 行级编辑核心（vendor executeWbEditCode 的纯函数镜像）；定位失败返回 null。 */
function applyCodeEdit(
  lines: BoardCodeAction['lines'],
  edit: CodeEdit,
  scope: string,
): BoardCodeAction['lines'] | null {
  const newLines = (edit.content ?? '').replace(/\r\n/g, '\n').split('\n').map((content, index) => ({
    // 新行 id：块内唯一即可（模型侧拿不到插入行 id，与 vendor 一致）
    id: `e_${scope}_${index}_${Date.now().toString(36)}`,
    content,
  }));
  const withContent = edit.content !== undefined && edit.content !== '' ? newLines : [];
  switch (edit.operation) {
    case 'insert_after':
    case 'insert_before': {
      const index = lines.findIndex((line) => line.id === edit.lineId);
      if (index < 0 || withContent.length === 0) return null;
      const at = edit.operation === 'insert_after' ? index + 1 : index;
      return [...lines.slice(0, at), ...withContent, ...lines.slice(at)];
    }
    case 'delete_lines': {
      if (!edit.lineIds?.length) return null;
      const drop = new Set(edit.lineIds);
      return lines.filter((line) => !drop.has(line.id));
    }
    case 'replace_lines': {
      if (!edit.lineIds?.length) return null;
      const firstIndex = lines.findIndex((line) => line.id === edit.lineIds![0]);
      if (firstIndex < 0) return null;
      const drop = new Set(edit.lineIds);
      const rest = lines.filter((line) => !drop.has(line.id));
      // 替换行沿用被替换行 id（模型后续引用不失效），多出的新行用新 id
      const replacement = withContent.map((line, index) =>
        index < edit.lineIds!.length ? { id: edit.lineIds![index], content: line.content } : line,
      );
      return [...rest.slice(0, firstIndex), ...replacement, ...rest.slice(firstIndex)];
    }
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
