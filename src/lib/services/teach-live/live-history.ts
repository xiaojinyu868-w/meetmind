/**
 * live-history —— 事件日志 ⇄ 模型对话历史的换算（纯函数，可单测）。
 *
 * 老师的一轮输出（标签流）就是 assistant 消息本体；学生消息就是 user 消息。
 * Next 重启后从 data/teach-events/<id>.jsonl 重建历史：把块事件拼回标签，
 * 体积大的块正文（svg / anim / widget / code / diagram / plot）用占位注释代替——
 * 模型只需要知道「板上有一张叫 tri 的图」，不需要再读一遍 2k token 的路径数据。
 * 这也是每轮 input 便宜的原因：历史里的图只剩标题。
 */

import type { TeachLogEvent } from '../teach-codex/event-bus';
import { LIVE_SPEECH_KINDS, type LiveAttrs, type LiveBlockKind } from '@/types/teach-live';

export interface ChatTurnMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * 正文超过这个长度的「重块」在历史里压成占位。
 * svg 放宽到 3000：老师后面要 `into` 追加标注、要 point 到里面的 id，得记得自己画过什么、画在哪；
 * anim / widget / code / diagram 极少被回头引用，320 以上就压。
 */
const HEAVY_BODY_LIMITS: Partial<Record<LiveBlockKind, number>> = {
  svg: 3000,
  plot: 1200,
  anim: 320,
  widget: 320,
  code: 600,
  diagram: 600,
};
const HEAVY_KINDS = new Set<LiveBlockKind>(Object.keys(HEAVY_BODY_LIMITS) as LiveBlockKind[]);
function heavyLimit(kind: string): number {
  return HEAVY_BODY_LIMITS[kind as LiveBlockKind] ?? Number.POSITIVE_INFINITY;
}

function attrsToString(attrs: LiveAttrs): string {
  const parts = Object.entries(attrs)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}="${String(v).replace(/"/g, '&quot;')}"`);
  return parts.length ? ' ' + parts.join(' ') : '';
}

export function renderBlockMarkup(kind: LiveBlockKind, attrs: LiveAttrs, body: string, complete = true): string {
  const attrText = attrsToString(attrs);
  if (kind === 'image') return `<image${attrText}/>`;
  const trimmed = body.trim();
  if (HEAVY_KINDS.has(kind) && trimmed.length > heavyLimit(kind)) {
    return `<${kind}${attrText}><!-- 已在板上，正文省略（${trimmed.length} 字） --></${kind}>`;
  }
  const tail = complete ? '' : '<!-- 此处被打断 -->';
  return `<${kind}${attrText}>${trimmed}${tail}</${kind}>`;
}

/**
 * 压缩一轮原始输出用于历史：重块正文换占位（与 renderBlockMarkup 同一规则）。
 * 正则只匹配已闭合的重块；截断的尾块原样保留（它本来就短）。
 */
export function compactMarkupForHistory(raw: string): string {
  return raw.replace(
    /<(svg|anim|widget|code|diagram|plot)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi,
    (whole, kind: string, attrText: string, body: string) => {
      if (body.trim().length <= heavyLimit(kind.toLowerCase())) return whole;
      return `<${kind.toLowerCase()}${attrText}><!-- 已在板上，正文省略（${body.trim().length} 字） --></${kind.toLowerCase()}>`;
    },
  );
}

/** 事件日志 → 对话历史（assistant 轮以 turn-complete / interrupted / 下一条学生消息为界） */
export function eventsToHistory(events: TeachLogEvent[]): ChatTurnMessage[] {
  const messages: ChatTurnMessage[] = [];
  let assistant = '';
  const openBlocks = new Map<string, { kind: LiveBlockKind; attrs: LiveAttrs; body: string }>();
  let speechBlockId: string | null = null;

  const flushAssistant = (interrupted: boolean) => {
    // 未闭合的块（进程中途死掉）也收进去
    for (const [, block] of openBlocks) assistant += renderBlockMarkup(block.kind, block.attrs, block.body, false);
    openBlocks.clear();
    speechBlockId = null;
    const text = assistant.trim();
    if (text) messages.push({ role: 'assistant', content: interrupted ? `${text}\n<!-- 被学生打断 -->` : text });
    assistant = '';
  };

  for (const ev of events) {
    switch (ev.type) {
      case 'student-message':
        flushAssistant(false);
        messages.push({ role: 'user', content: ev.text });
        break;
      case 'block-open':
        openBlocks.set(ev.id, { kind: ev.kind, attrs: ev.attrs, body: '' });
        if (LIVE_SPEECH_KINDS.has(ev.kind)) speechBlockId = ev.id;
        break;
      case 'block-delta': {
        const block = openBlocks.get(ev.id);
        if (block) block.body += ev.text;
        break;
      }
      case 'text-delta': {
        // 口播正文经 text-delta 落盘（兼容老消费方）；归到当前口播块
        const block = speechBlockId ? openBlocks.get(speechBlockId) : undefined;
        if (block) block.body += ev.text;
        else assistant += ev.text;
        break;
      }
      case 'block-close': {
        const block = openBlocks.get(ev.id);
        if (block) {
          assistant += renderBlockMarkup(block.kind, block.attrs, block.body, ev.complete) + '\n';
          openBlocks.delete(ev.id);
          if (speechBlockId === ev.id) speechBlockId = null;
        }
        break;
      }
      case 'cue':
        assistant += `<${ev.name}${attrsToString(ev.args)}/>\n`;
        break;
      case 'turn-complete':
        flushAssistant(false);
        break;
      case 'interrupted':
        flushAssistant(true);
        break;
      default:
        break;
    }
  }
  flushAssistant(false);
  return mergeAdjacentRoles(messages);
}

/** 连续同角色消息合并（打断续讲会产生两条相邻 user；模型接口要求交替） */
function mergeAdjacentRoles(messages: ChatTurnMessage[]): ChatTurnMessage[] {
  const out: ChatTurnMessage[] = [];
  for (const m of messages) {
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content = `${last.content}\n${m.content}`;
    else out.push({ ...m });
  }
  return out;
}

/** 历史预算：保留最近 N 条（system 另算）。开头若是 assistant 就再砍一条保证以 user 起头。 */
export function trimHistory(messages: ChatTurnMessage[], keep = 16): ChatTurnMessage[] {
  let out = messages.length > keep ? messages.slice(messages.length - keep) : [...messages];
  while (out.length && out[0].role !== 'user') out = out.slice(1);
  return out;
}
