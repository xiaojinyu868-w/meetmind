/**
 * live-model —— 舞台页的板面模型：服务端事件 → 页 / 块 / 字幕 / 提示的纯 reducer。
 *
 * 两个时间轴在这里分开：
 * - 「到达」：服务端事件按模型生成速度到（一整轮 ~10s），reducer 把它们立刻记进
 *   模型（块正文增长、页新建），但块的 segment 默认 `revealed=false`；
 * - 「演出」：Director（director.ts）按语音节奏决定何时 reveal 哪个 segment、何时
 *   触发 cue——学生看到的是老师说到哪画到哪，而不是一屏 SVG 瞬间糊上来。
 *
 * svg / draw 支持 `into="label"` 追加：追加的正文作为目标块的新 segment，独立 reveal，
 * 所以「先画三角形，讲到斜边再补斜边」是分两次长出来的（draw 的追加段与首段在同一脚本作用域里执行）。
 *
 * 历史回放（replay=true）：全部直接 revealed，Director 不参与。
 */

import type { LiveAttrs, LiveBlockKind, LiveCueName } from '@/types/teach-live';
import type { TeachStreamEvent } from '@/lib/services/teach-codex/event-bus';

export interface LiveSegment {
  id: string;
  text: string;
  complete: boolean;
  revealed: boolean;
}

export interface LiveBlock {
  id: string;
  kind: LiveBlockKind;
  attrs: LiveAttrs;
  /** 模型给的 id（供 point / highlight / into 引用） */
  label: string | null;
  pageId: string;
  segments: LiveSegment[];
  /** image 块生成完成后的 url */
  imageUrl: string | null;
  /** 该块在本轮里被 highlight 过（持久强调） */
  highlighted: boolean;
  /** 所属 turn 序号 */
  turn: number;
}

export interface LivePage {
  id: string;
  title: string;
  blockIds: string[];
}

export interface TranscriptItem {
  id: string;
  role: 'teacher' | 'student';
  text: string;
  kind?: 'say' | 'ask';
  turn: number;
}

export type LessonStatus = 'idle' | 'waiting' | 'speaking' | 'listening' | 'error';

export interface LessonState {
  threadId: string | null;
  title: string;
  topic: string;
  pages: LivePage[];
  /** 学生手动翻到的页；null = 跟随演出 */
  viewingPageId: string | null;
  /** 老师当前在写的页（到达时间轴：新块落到这里） */
  currentPageId: string;
  /** 演出时间轴上正在展示的页（Director 消费 scene 时推进） */
  stagePageId: string;
  /** 到达时每个 scene 对应的页 id，按序排队；Director 演到一个 scene 就 shift 一个 */
  sceneQueue: string[];
  /** 到达过的 scene 数（课名只跟随第一个 scene 的标题） */
  sceneCount: number;
  blocks: Record<string, LiveBlock>;
  /** label → blockId（最近一次赢） */
  labels: Record<string, string>;
  transcript: TranscriptItem[];
  /** 当前 turn 序号（学生每发一条消息 +1） */
  turn: number;
  /** 老师本轮是否还在生成（turn-complete / interrupted / error 前为 true） */
  generating: boolean;
  /** 最近一条错误（人可读） */
  error: string | null;
  /** 最近的 ask（等学生回答） */
  pendingAsk: string | null;
  /** 当前打开、未闭合的口播块（text-delta 归到它） */
  openSpeechId: string | null;
  /** 本节课累计用量（服务端 usage 事件求和） */
  usage: { turns: number; inputTokens: number; outputTokens: number; costCny: number };
}

export type LessonAction =
  | { type: 'server'; event: TeachStreamEvent; replay?: boolean }
  | { type: 'student-message'; text: string; silent?: boolean }
  | { type: 'reveal'; segmentId: string }
  | { type: 'highlight'; blockId: string }
  /** Director 演到某个 cue：scene 推进展示页 / highlight / erase（point、pause 不改模型） */
  | { type: 'stage-cue'; name: LiveCueName; args: LiveAttrs }
  | { type: 'view-page'; pageId: string | null }
  | { type: 'discard-unrevealed' }
  /** 回看被打断：没演到的全部直接揭示，舞台跳到最后一页 */
  | { type: 'reveal-all' }
  | { type: 'reset'; threadId: string | null; title: string; topic: string };

export const INITIAL_PAGE_ID = 'p_0';

export function createLessonState(params: { threadId: string | null; title: string; topic: string }): LessonState {
  return {
    threadId: params.threadId,
    title: params.title,
    topic: params.topic,
    pages: [{ id: INITIAL_PAGE_ID, title: params.title || params.topic, blockIds: [] }],
    viewingPageId: null,
    currentPageId: INITIAL_PAGE_ID,
    stagePageId: INITIAL_PAGE_ID,
    sceneQueue: [],
    sceneCount: 0,
    blocks: {},
    labels: {},
    transcript: [],
    turn: 0,
    generating: false,
    error: null,
    pendingAsk: null,
    openSpeechId: null,
    usage: { turns: 0, inputTokens: 0, outputTokens: 0, costCny: 0 },
  };
}

/** 口播类块不上板 */
export function isSpeechKind(kind: LiveBlockKind): boolean {
  return kind === 'say' || kind === 'ask';
}

export function blockBody(block: LiveBlock): string {
  return block.segments.map((s) => s.text).join('');
}

export function revealedBody(block: LiveBlock): string {
  return block.segments.filter((s) => s.revealed).map((s) => s.text).join('');
}

/** 当前应展示的页：学生手动翻的页优先，否则跟随演出 */
export function activePage(state: LessonState): LivePage {
  const id = state.viewingPageId ?? state.stagePageId;
  return state.pages.find((p) => p.id === id) ?? state.pages[state.pages.length - 1];
}

/** point/highlight 的 at="label" / "label#inner" 解析 */
export function resolveTarget(state: LessonState, at: string): { blockId: string; innerId: string | null } | null {
  const [label, inner] = at.split('#');
  const blockId = state.labels[label] ?? (state.blocks[label] ? label : undefined);
  if (!blockId) return null;
  return { blockId, innerId: inner || null };
}

let pageCounter = 0;
function nextPageId(): string {
  pageCounter += 1;
  return `p_${Date.now().toString(36)}_${pageCounter}`;
}

function upsertTranscript(items: TranscriptItem[], id: string, patch: Partial<TranscriptItem>): TranscriptItem[] {
  const idx = items.findIndex((t) => t.id === id);
  if (idx < 0) return items;
  const next = items.slice();
  next[idx] = { ...next[idx], ...patch };
  return next;
}

export function lessonReducer(state: LessonState, action: LessonAction): LessonState {
  switch (action.type) {
    case 'reset':
      return createLessonState(action);

    case 'student-message':
      return {
        ...state,
        turn: state.turn + 1,
        generating: true,
        error: null,
        pendingAsk: null,
        transcript: action.silent
          ? state.transcript
          : [
              ...state.transcript,
              { id: `stu_${state.turn + 1}_${state.transcript.length}`, role: 'student', text: action.text, turn: state.turn + 1 },
            ],
      };

    case 'reveal': {
      const block = Object.values(state.blocks).find((b) => b.segments.some((s) => s.id === action.segmentId));
      if (!block) return state;
      return {
        ...state,
        pendingAsk: block.kind === 'ask' ? blockBody(block).trim() || null : state.pendingAsk,
        blocks: {
          ...state.blocks,
          [block.id]: {
            ...block,
            segments: block.segments.map((s) => (s.id === action.segmentId ? { ...s, revealed: true } : s)),
          },
        },
      };
    }

    case 'highlight': {
      const blocks: Record<string, LiveBlock> = {};
      for (const [id, b] of Object.entries(state.blocks)) {
        const highlighted = id === action.blockId;
        blocks[id] = b.highlighted === highlighted ? b : { ...b, highlighted };
      }
      return { ...state, blocks };
    }

    case 'stage-cue':
      return applyStageCue(state, action.name, action.args);

    case 'view-page':
      return { ...state, viewingPageId: action.pageId };

    case 'reveal-all': {
      const blocks: Record<string, LiveBlock> = {};
      for (const [id, b] of Object.entries(state.blocks)) {
        blocks[id] = b.segments.every((s) => s.revealed) ? b : { ...b, segments: b.segments.map((s) => ({ ...s, revealed: true })) };
      }
      const last = state.pages[state.pages.length - 1];
      return { ...state, blocks, stagePageId: last.id, viewingPageId: null, sceneQueue: [] };
    }

    case 'discard-unrevealed': {
      // 打断：还没演到的 segment 永远不演了；一个 revealed segment 都没有的块从板上撤下
      //（口播块留着给课堂记录，但 ask 卡不再占位）
      const blocks: Record<string, LiveBlock> = {};
      const removedFromPages = new Set<string>();
      for (const [id, b] of Object.entries(state.blocks)) {
        const kept = b.segments.filter((s) => s.revealed);
        if (kept.length === 0) {
          removedFromPages.add(id);
          if (isSpeechKind(b.kind)) blocks[id] = b;
          continue;
        }
        blocks[id] = kept.length === b.segments.length ? b : { ...b, segments: kept };
      }
      const trimmedPages = state.pages.map((p) =>
        p.blockIds.some((id) => removedFromPages.has(id)) ? { ...p, blockIds: p.blockIds.filter((id) => !removedFromPages.has(id)) } : p,
      );
      // 还没演到、也没内容的页一起撤掉（老师刚说要翻页就被打断）
      const stageIdx = trimmedPages.findIndex((p) => p.id === state.stagePageId);
      const pages = trimmedPages.filter((p, i) => i <= stageIdx || p.blockIds.length > 0 || i === 0);
      const currentPageId = pages.some((p) => p.id === state.currentPageId) ? state.currentPageId : pages[pages.length - 1].id;
      return { ...state, blocks, pages, currentPageId, sceneQueue: [], generating: false };
    }

    case 'server':
      return applyServerEvent(state, action.event, action.replay ?? false);

    default:
      return state;
  }
}

function applyServerEvent(state: LessonState, ev: TeachStreamEvent, replay: boolean): LessonState {
  switch (ev.type) {
    case 'block-open':
      return openBlock(state, ev, replay);

    case 'block-delta': {
      const owner = findSegmentOwner(state, ev.id);
      if (!owner) return state;
      return {
        ...state,
        blocks: {
          ...state.blocks,
          [owner.id]: {
            ...owner,
            segments: owner.segments.map((s) => (s.id === ev.id ? { ...s, text: s.text + ev.text } : s)),
          },
        },
      };
    }

    case 'text-delta': {
      // 归到当前打开、未闭合的口播块
      const block = state.openSpeechId ? state.blocks[state.openSpeechId] : undefined;
      if (!block) return state;
      const nextText = block.segments[0].text + ev.text;
      return {
        ...state,
        blocks: {
          ...state.blocks,
          [block.id]: { ...block, segments: [{ ...block.segments[0], text: nextText }] },
        },
        transcript: upsertTranscript(state.transcript, block.id, { text: nextText }),
      };
    }

    case 'block-close': {
      const owner = findSegmentOwner(state, ev.id);
      if (!owner) return state;
      const next: LessonState = {
        ...state,
        blocks: {
          ...state.blocks,
          [owner.id]: {
            ...owner,
            segments: owner.segments.map((s) => (s.id === ev.id ? { ...s, complete: true } : s)),
          },
        },
      };
      if (owner.kind === 'ask' && replay) next.pendingAsk = blockBody(owner).trim() || null;
      if (state.openSpeechId === ev.id) next.openSpeechId = null;
      return next;
    }

    case 'cue':
      return applyCue(state, ev.name, ev.args, replay);

    case 'image-ready': {
      const block = state.blocks[ev.id];
      if (!block) return state;
      return { ...state, blocks: { ...state.blocks, [ev.id]: { ...block, imageUrl: ev.url } } };
    }

    case 'usage':
      return {
        ...state,
        usage: {
          turns: state.usage.turns + 1,
          inputTokens: state.usage.inputTokens + ev.inputTokens,
          outputTokens: state.usage.outputTokens + ev.outputTokens,
          costCny: state.usage.costCny + ev.costCny,
        },
      };

    case 'turn-complete':
      return { ...state, generating: false };

    case 'interrupted':
      return { ...state, generating: false };

    case 'error':
      return { ...state, generating: false, error: ev.message };

    default:
      return state;
  }
}

function applyCue(state: LessonState, name: LiveCueName, args: LiveAttrs, replay: boolean): LessonState {
  if (name !== 'scene') {
    // highlight / erase / point / pause 都是演出效果：到达时不改模型，Director 演到再 stage-cue
    return replay ? applyStageCue(state, name, args) : state;
  }
  const title = (args.title ?? '').trim() || `第 ${state.pages.length + 1} 页`;
  const current = state.pages.find((p) => p.id === state.currentPageId);
  // 课名只跟第一个 scene（服务端 followTitle 同一规则）
  const lessonTitle = state.sceneCount === 0 && state.title === state.topic ? title : state.title;
  // 首页还空着就直接改名复用，别留一页空白（但 scene 仍要排队，演出时消费）
  if (current && current.blockIds.length === 0 && state.pages.length === 1) {
    return {
      ...state,
      pages: [{ ...current, title }],
      title: lessonTitle,
      sceneCount: state.sceneCount + 1,
      sceneQueue: replay ? state.sceneQueue : [...state.sceneQueue, current.id],
    };
  }
  const page: LivePage = { id: nextPageId(), title, blockIds: [] };
  return {
    ...state,
    pages: [...state.pages, page],
    currentPageId: page.id,
    stagePageId: replay ? page.id : state.stagePageId,
    sceneCount: state.sceneCount + 1,
    sceneQueue: replay ? state.sceneQueue : [...state.sceneQueue, page.id],
    title: lessonTitle,
  };
}

/** Director 演到的 cue（或回放时的即时效果） */
function applyStageCue(state: LessonState, name: LiveCueName, args: LiveAttrs): LessonState {
  switch (name) {
    case 'scene': {
      // 到达时排好的页按 FIFO 消费：这个 scene 演到了，就把舞台翻到它对应的那页
      const [pageId, ...rest] = state.sceneQueue;
      if (!pageId || !state.pages.some((p) => p.id === pageId)) {
        return state.viewingPageId === null && !pageId ? state : { ...state, viewingPageId: null, sceneQueue: rest };
      }
      return { ...state, stagePageId: pageId, viewingPageId: null, sceneQueue: rest };
    }
    case 'highlight': {
      const target = resolveTarget(state, args.at ?? '');
      if (!target) return state;
      return lessonReducer(state, { type: 'highlight', blockId: target.blockId });
    }
    case 'erase': {
      const target = resolveTarget(state, args.id ?? args.at ?? '');
      if (!target) return state;
      const { [target.blockId]: _removed, ...blocks } = state.blocks;
      void _removed;
      return {
        ...state,
        blocks,
        pages: state.pages.map((p) =>
          p.blockIds.includes(target.blockId) ? { ...p, blockIds: p.blockIds.filter((id) => id !== target.blockId) } : p,
        ),
      };
    }
    default:
      return state;
  }
}

function findSegmentOwner(state: LessonState, segmentId: string): LiveBlock | null {
  const direct = state.blocks[segmentId];
  if (direct) return direct;
  for (const block of Object.values(state.blocks)) {
    if (block.segments.some((s) => s.id === segmentId)) return block;
  }
  return null;
}


function openBlock(state: LessonState, ev: Extract<TeachStreamEvent, { type: 'block-open' }>, replay: boolean): LessonState {
  const id = ev.id;
  if (isSpeechKind(ev.kind)) {
    // 口播块：进字幕稿（正文经 text-delta 追加）；ask 同时作为提问卡上板
    const item: TranscriptItem = { id, role: 'teacher', text: '', kind: ev.kind as 'say' | 'ask', turn: state.turn };
    const pages =
      ev.kind === 'ask'
        ? state.pages.map((p) => (p.id === state.currentPageId ? { ...p, blockIds: [...p.blockIds, id] } : p))
        : state.pages;
    return {
      ...state,
      openSpeechId: id,
      pages,
      transcript: [...state.transcript, item],
      blocks: {
        ...state.blocks,
        [id]: {
          id,
          kind: ev.kind,
          attrs: ev.attrs,
          label: ev.attrs.id ?? null,
          pageId: state.currentPageId,
          segments: [{ id, text: '', complete: false, revealed: replay }],
          imageUrl: null,
          highlighted: false,
          turn: state.turn,
        },
      },
    };
  }

  let attrs = ev.attrs;
  // svg / draw 的 into="label"：作为同类目标块的新 segment（目标不存在则降级成一张新图）
  if ((ev.kind === 'svg' || ev.kind === 'draw') && attrs.into) {
    const into = attrs.into;
    const targetId = state.labels[into] ?? (state.blocks[into] ? into : undefined);
    const target = targetId ? state.blocks[targetId] : undefined;
    if (target && target.kind === ev.kind) {
      return {
        ...state,
        blocks: {
          ...state.blocks,
          [target.id]: { ...target, segments: [...target.segments, { id, text: '', complete: false, revealed: replay }] },
        },
      };
    }
    const { into: _dropped, ...rest } = attrs;
    void _dropped;
    attrs = rest;
  }

  const block: LiveBlock = {
    id,
    kind: ev.kind,
    attrs,
    label: attrs.id ?? null,
    pageId: state.currentPageId,
    segments: [{ id, text: '', complete: false, revealed: replay }],
    imageUrl: null,
    highlighted: false,
    turn: state.turn,
  };
  return {
    ...state,
    pages: state.pages.map((p) => (p.id === state.currentPageId ? { ...p, blockIds: [...p.blockIds, id] } : p)),
    labels: block.label ? { ...state.labels, [block.label]: id } : state.labels,
    blocks: { ...state.blocks, [id]: block },
  };
}
