/**
 * teach-agent 兼容层 —— 把 AI SDK 原生 messages 机械装配成 BoardScript。
 *
 * 架构（v28 定稿）：一节课 = 一次 streamText 运行，轨迹就是框架的
 * ModelMessage[]（text part / tool-call part 按序排列），不自建轨迹格式。
 * agent 的文本输出 = 老师讲的话（逐段 TTS）；工具调用 = 板书动作。
 *
 * 本层是单向 walker，零模型智能、零猜测：
 * - 文本 run → NarrationSegment（相邻纯文本合并为一段）
 * - 板书工具（write/circle/underline/arrow/mark/pause/ref/image）→ 段内 action：
 *   文本之后的动作在讲稿末尾机械注入 [aN] 锚（"说完就写"）；页首先于任何
 *   文本的动作在段首注入（"先写课题再开口"）。锚点由 walker 生成，不靠模型
 *   标注——cue 幻觉/[aN] 外露/TTS 念标记三类老问题从根上消失
 * - ask → CheckpointSegment：紧前的纯口述段提升为提问口述（避免问话说两遍）
 * - flip_page 开新页；finish 终止；image 动作按 toolCallId 回填生成图 url
 * 整课最后过一次 sanitizeBoardScript（wN 越界/ref/cue 校验统一收口）。
 */

import type { ModelMessage } from 'ai';
import {
  MAX_SEGMENTS_PER_PAGE,
  sanitizeBoardScript,
  type BoardAction,
  type BoardScript,
  type BoardSegment,
} from '@/lib/ai-native/plugins/board-script';

/** 板书原语工具（映射成 BoardAction；ask/flip_page/finish 是控制工具） */
const BOARD_TOOLS = new Set([
  'write',
  'circle',
  'underline',
  'arrow',
  'mark',
  'pause',
  'new_column',
  'ref',
  'image',
]);

/** image 动作的图片回填表：toolCallId → 生成落盘后的本地 URL */
export type ImageUrlMap = Record<string, string>;

export interface WalkStats {
  /** 无法映射/无处安放的板书动作数（页全空无文本等边缘） */
  droppedActions: number;
  /** 单页段数达到上限时 walker 机械自动翻页的次数（防止 sanitize 静默丢段） */
  autoFlips: number;
}

interface DraftNarration {
  type: 'narration';
  narration: string;
  actions: BoardAction[];
  /** 与 actions 一一对应：'start' 锚段首、'end' 锚段尾 */
  anchors: ('start' | 'end')[];
}

type DraftSegment = DraftNarration | BoardSegment;

type BoardEvent =
  | { kind: 'text'; text: string }
  | { kind: 'action'; toolCallId: string; toolName: string; input: Record<string, unknown> };

/** 从 messages 提取有序事件流（只看 assistant 的 text / tool-call part）。 */
function extractEvents(messages: ModelMessage[]): BoardEvent[] {
  const events: BoardEvent[] = [];
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    const content = message.content;
    if (typeof content === 'string') {
      if (content.trim()) events.push({ kind: 'text', text: content });
      continue;
    }
    for (const part of content) {
      if (part.type === 'text') {
        if (part.text.trim()) events.push({ kind: 'text', text: part.text });
        continue;
      }
      if (part.type === 'tool-call') {
        events.push({
          kind: 'action',
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          input: (part.input ?? {}) as Record<string, unknown>,
        });
      }
    }
  }
  return events;
}

/** 工具入参 → BoardAction（工具侧 Zod 已校验形状，这里只做映射 + image 回填）。 */
function toBoardAction(
  event: { toolCallId: string; toolName: string; input: Record<string, unknown> },
  images: ImageUrlMap,
): BoardAction | null {
  const { toolName, input } = event;
  switch (toolName) {
    case 'write':
      return { type: 'write', text: String(input.text ?? ''), role: input.role as never };
    case 'circle':
    case 'underline':
      return { type: toolName, target: input.target as never };
    case 'arrow':
      return {
        type: 'arrow',
        from: String(input.from ?? ''),
        to: String(input.to ?? ''),
        ...(input.label ? { label: String(input.label) } : {}),
      };
    case 'mark':
      return { type: 'mark', mark: input.mark as never, target: String(input.target ?? '') };
    case 'pause':
      return { type: 'pause', ms: Number(input.ms ?? 0) };
    case 'new_column':
      return { type: 'new_column' };
    case 'ref':
      return { type: 'ref', page: Number(input.page ?? 0), target: String(input.target ?? '') };
    case 'image':
      return {
        type: 'image',
        url: images[event.toolCallId] ?? '',
        prompt: String(input.prompt ?? ''),
        ...(input.caption ? { caption: String(input.caption) } : {}),
      };
    default:
      return null;
  }
}

/** 段定稿：按 anchors 在段首/段尾机械注入 [aN] 锚（下标 = actions 下标）。 */
function finalizeNarration(draft: DraftNarration): Record<string, unknown> {
  let prefix = '';
  let suffix = '';
  draft.anchors.forEach((anchor, index) => {
    if (anchor === 'start') prefix += `[a${index}]`;
    else suffix += `[a${index}]`;
  });
  return {
    type: 'narration',
    narration: prefix + draft.narration + suffix,
    actions: draft.actions,
  };
}

/**
 * messages → BoardScript。
 * title 由调用方给（课题）；images 是 image 工具调用的生成图回填表。
 */
export function messagesToBoardScript(
  messages: ModelMessage[],
  options: { title: string; images?: ImageUrlMap },
): { script: BoardScript; stats: WalkStats } {
  const images = options.images ?? {};
  const stats: WalkStats = { droppedActions: 0, autoFlips: 0 };

  const pages: DraftSegment[][] = [[]];
  /** 页首孤儿动作：先于本页任何文本出现，锚到下一段开头 */
  let orphans: BoardAction[] = [];
  let finished = false;

  const currentPage = () => pages[pages.length - 1];
  /** 翻页前给当页收尾：末段有板书动作时补一拍停顿（1200ms）——真人老师写完
   *  最后一步会停一下让学生看清成品页再翻页；尾锚动作说完即写、写完即翻，
   *  不补这一拍学生根本来不及看（2026-08-20 实拍：末笔与翻页同帧） */
  const closePageWithBreath = () => {
    const page = currentPage();
    const last = page[page.length - 1];
    if (!last || last.type !== 'narration') return;
    const draft = last as DraftNarration;
    if (draft.actions.length === 0) return;
    if (draft.actions[draft.actions.length - 1].type === 'pause') return;
    draft.actions.push({ type: 'pause', ms: 1200 });
    draft.anchors.push('end');
  };
  /** 新段上板前保证容量：满页机械自动翻页（内容保全优先于 agent 的分页意图） */
  const ensureCapacity = () => {
    if (currentPage().length >= MAX_SEGMENTS_PER_PAGE) {
      stats.autoFlips += 1;
      closePageWithBreath();
      pages.push([]);
    }
  };
  const lastDraft = (): DraftNarration | null => {
    const page = currentPage();
    const last = page[page.length - 1];
    return last && last.type === 'narration' ? (last as DraftNarration) : null;
  };

  for (const event of extractEvents(messages)) {
    if (finished) break;

    if (event.kind === 'text') {
      const text = event.text.trim();
      const existing = lastDraft();
      if (existing && existing.actions.length === 0 && orphans.length === 0) {
        // 相邻纯口述合并成一段（TTS 按段请求，合并减少接缝）
        existing.narration = `${existing.narration} ${text}`;
        continue;
      }
      const draft: DraftNarration = { type: 'narration', narration: text, actions: [], anchors: [] };
      for (const action of orphans) {
        draft.actions.push(action);
        draft.anchors.push('start');
      }
      orphans = [];
      ensureCapacity();
      currentPage().push(draft);
      continue;
    }

    const { toolName } = event;

    if (toolName === 'finish') {
      finished = true;
      continue;
    }

    if (toolName === 'flip_page') {
      if (currentPage().length > 0) {
        if (orphans.length > 0) stats.droppedActions += orphans.length;
        orphans = [];
        closePageWithBreath();
        pages.push([]);
      }
      continue;
    }

    if (toolName === 'ask') {
      const input = event.input;
      // 紧前的纯口述段提升为提问口述（checkpoint 自己会朗读，不说两遍）
      let narration = '';
      const page = currentPage();
      const last = page[page.length - 1];
      if (last && last.type === 'narration' && (last as DraftNarration).actions.length === 0) {
        narration = (last as DraftNarration).narration;
        page.pop();
      }
      const questionText = String(input.question ?? '');
      // 模型自我修正会连发两次同题 ask（kimi-k3 实测：第一次 hints 不合格立刻重发）：
      // 后者覆盖前者，但保住前者的提问口述
      const prev = currentPage()[currentPage().length - 1];
      if (
        prev &&
        prev.type === 'checkpoint' &&
        (prev as { question?: { text?: string } }).question?.text === questionText
      ) {
        if (!narration) narration = (prev as { narration?: string }).narration ?? '';
        currentPage().pop();
      }
      const checkpoint = {
        type: 'checkpoint',
        narration: narration || questionText,
        question: { text: questionText, role: input.role === 'term' ? 'term' : 'step' },
        hints: Array.isArray(input.hints) ? input.hints : [],
        answer: String(input.answer ?? ''),
        demoActions: Array.isArray(input.demoActions) ? input.demoActions : [],
      } as unknown as BoardSegment;
      ensureCapacity();
      currentPage().push(checkpoint);
      continue;
    }

    if (BOARD_TOOLS.has(toolName)) {
      const action = toBoardAction(event, images);
      if (!action) {
        stats.droppedActions += 1;
        continue;
      }
      const draft = lastDraft();
      if (draft) {
        draft.actions.push(action);
        draft.anchors.push('end');
      } else {
        orphans.push(action);
      }
    }
  }

  if (orphans.length > 0) stats.droppedActions += orphans.length;

  const finalPages = pages
    .map((page) => ({
      segments: page.map((segment) =>
        segment.type === 'narration' && 'anchors' in segment
          ? (finalizeNarration(segment as DraftNarration) as unknown as BoardSegment)
          : (segment as BoardSegment),
      ),
    }))
    .filter((page) => page.segments.length > 0);

  const { script } = sanitizeBoardScript({
    title: options.title,
    pages: finalPages,
    quotes: [],
  });
  return { script, stats };
}

/** 收集 messages 里所有 image 工具调用（图片生成任务的输入）。 */
export function collectImageJobs(messages: ModelMessage[]): { toolCallId: string; prompt: string }[] {
  const jobs: { toolCallId: string; prompt: string }[] = [];
  for (const event of extractEvents(messages)) {
    if (event.kind === 'action' && event.toolName === 'image') {
      const prompt = String(event.input.prompt ?? '').trim();
      if (prompt) jobs.push({ toolCallId: event.toolCallId, prompt });
    }
  }
  return jobs;
}
