/**
 * live-markup-parser —— 老师输出（标签流）的增量解析器。零 IO，可单测。
 *
 * 为什么是标签流而不是 JSON 数组（teach-engine 的做法）：
 * - 块正文（SVG / LaTeX / Markdown / 代码 / HTML）是原生文本，不需要转义，
 *   一个 `<svg>` 里的元素闭合一个就能渲染一个——「图一笔一笔长出来」靠这个；
 * - 首个 `<say>` 几个 token 就能开口，TTFT 不被 JSON 包装稀释；
 * - 截断只丢最后半个块，前面的全部有效。
 *
 * 状态机只有两态：
 * - 顶层 / 隐式 say：扫描已知标签；标签之外的裸文本视为口播（模型忘写 <say>
 *   也不丢话），遇到下一个已知标签自然收口；
 * - 原文模式（explicit 块内）：只找该块自己的闭合标签，正文原样吐出——所以
 *   <note> 里的 <b>、<widget> 里的 </svg> 都不会误伤。
 *
 * 块边界处的半截标签会被扣住等下一个 chunk（`<sv` 可能是 `<svg`），
 * 但只扣「可能是已知标签前缀」的部分——口播里的 "x<y" 不会被卡住。
 */

import {
  isLiveBlockKind,
  isLiveCueName,
  LIVE_BLOCK_KINDS,
  LIVE_CUE_NAMES,
  type LiveAttrs,
  type LiveBlockKind,
  type LiveEvent,
} from '@/types/teach-live';

const KNOWN_NAMES: readonly string[] = [...LIVE_BLOCK_KINDS, ...LIVE_CUE_NAMES];

/** 完整开标签：<name attrs> / <name attrs/>（属性值可带引号，引号内允许 >） */
const OPEN_TAG_RE =
  /^<([a-zA-Z][\w-]*)((?:\s+[^\s=<>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s<>"']+))?)*)\s*(\/?)\s*>/;
const CLOSE_TAG_RE = /^<\/([a-zA-Z][\w-]*)\s*>/;
const ATTR_RE = /([^\s=<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s<>"']+)))?/g;

interface OpenBlock {
  id: string;
  kind: LiveBlockKind;
  /** 小写闭合标签（explicit 块） */
  closeTag: string;
  /** 隐式 say：由裸文本打开，遇下一个已知标签收口 */
  implicit: boolean;
}

export function parseLiveAttrs(raw: string): LiveAttrs {
  const attrs: LiveAttrs = {};
  if (!raw) return attrs;
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(raw))) {
    const key = m[1];
    if (!key || key === '/') continue;
    attrs[key.toLowerCase()] = (m[2] ?? m[3] ?? m[4] ?? '').trim();
  }
  return attrs;
}

/** buf 的尾部有多长可能是 closeTag 的前缀（需扣住等下一个 chunk） */
function partialSuffixLen(buf: string, closeTag: string): number {
  const max = Math.min(buf.length, closeTag.length - 1);
  for (let k = max; k >= 1; k--) {
    if (closeTag.startsWith(buf.slice(buf.length - k).toLowerCase())) return k;
  }
  return 0;
}

/** `<sa` / `<say` / `<say title="…`（尚无 >）——名字是已知标签的前缀就值得等 */
function looksLikeKnownTagPrefix(rest: string): boolean {
  const m = /^<\/?([a-zA-Z][\w-]*)?/.exec(rest);
  if (!m) return false;
  const name = (m[1] ?? '').toLowerCase();
  if (!name) return true; // 只有 "<" 或 "</"
  return KNOWN_NAMES.some((k) => k.startsWith(name));
}

export class LiveMarkupParser {
  private buf = '';
  private open: OpenBlock | null = null;
  private counter = 0;
  private readonly makeId: () => string;

  constructor(makeId?: () => string) {
    this.makeId = makeId ?? (() => `lb_${++this.counter}`);
  }

  /** 喂一段模型增量，返回本次解析出的事件 */
  push(chunk: string): LiveEvent[] {
    if (!chunk) return [];
    const out: LiveEvent[] = [];
    this.buf += chunk;
    this.drain(out, false);
    return out;
  }

  /** 流结束（正常 / 截断 / 打断）：把扣住的尾巴放出来并收口所有块 */
  finish(): LiveEvent[] {
    const out: LiveEvent[] = [];
    this.drain(out, true);
    if (this.open) {
      if (this.buf) out.push({ type: 'block-delta', id: this.open.id, text: this.buf });
      out.push({ type: 'block-close', id: this.open.id, complete: this.open.implicit });
      this.open = null;
    } else if (this.buf.trim()) {
      this.emitText(out, this.buf);
      this.closeImplicit(out);
    }
    this.buf = '';
    return out;
  }

  get currentBlock(): { id: string; kind: LiveBlockKind } | null {
    return this.open ? { id: this.open.id, kind: this.open.kind } : null;
  }

  // ---------- 内部 ----------

  private drain(out: LiveEvent[], final: boolean): void {
    for (;;) {
      if (this.open && !this.open.implicit) {
        if (!this.drainRaw(out, final)) return;
        continue;
      }
      if (!this.drainTop(out, final)) return;
    }
  }

  /** 原文模式：返回 true 表示块已闭合、需要继续扫描；false 表示等更多输入 */
  private drainRaw(out: LiveEvent[], final: boolean): boolean {
    const block = this.open!;
    const idx = this.buf.toLowerCase().indexOf(block.closeTag);
    if (idx >= 0) {
      const body = this.buf.slice(0, idx);
      if (body) out.push({ type: 'block-delta', id: block.id, text: body });
      this.buf = this.buf.slice(idx + block.closeTag.length);
      out.push({ type: 'block-close', id: block.id, complete: true });
      this.open = null;
      return true;
    }
    const hold = final ? 0 : partialSuffixLen(this.buf, block.closeTag);
    const safe = this.buf.slice(0, this.buf.length - hold);
    if (safe) {
      out.push({ type: 'block-delta', id: block.id, text: safe });
      this.buf = this.buf.slice(safe.length);
    }
    return false;
  }

  /** 顶层 / 隐式 say：返回 true 表示消费了输入、继续；false 表示等更多输入 */
  private drainTop(out: LiveEvent[], final: boolean): boolean {
    if (!this.buf) return false;

    // markdown 代码围栏（模型偶发把整段输出包进 ```xml）：整行丢掉
    if (!this.open) {
      const trimmed = this.buf.replace(/^\s+/, '');
      if (trimmed.startsWith('```')) {
        const nl = trimmed.indexOf('\n');
        if (nl < 0) {
          if (!final) return false;
          this.buf = '';
          return false;
        }
        this.buf = trimmed.slice(nl + 1);
        return true;
      }
      if (/^`{1,2}$/.test(trimmed) && !final) return false;
    }

    const lt = this.buf.indexOf('<');
    if (lt < 0) {
      this.emitText(out, this.buf);
      this.buf = '';
      return false;
    }

    const before = this.buf.slice(0, lt);
    const rest = this.buf.slice(lt);

    // 闭合标签落在顶层：已知块名的（模型多写 / 错位）静默丢弃，其他当文本
    const close = CLOSE_TAG_RE.exec(rest);
    if (close) {
      const name = close[1].toLowerCase();
      this.emitText(out, before);
      if (isLiveBlockKind(name) || isLiveCueName(name)) {
        this.closeImplicit(out);
      } else {
        this.emitText(out, close[0]);
      }
      this.buf = rest.slice(close[0].length);
      return true;
    }

    const m = OPEN_TAG_RE.exec(rest);
    if (!m) {
      // 还没等到 >：是已知标签的前缀就扣住，否则 "<" 只是口播里的小于号
      if (!rest.includes('>') && looksLikeKnownTagPrefix(rest)) {
        if (final) {
          this.emitText(out, this.buf);
          this.buf = '';
          return false;
        }
        this.emitText(out, before);
        this.buf = rest;
        return false;
      }
      this.emitText(out, before + '<');
      this.buf = rest.slice(1);
      return true;
    }

    const name = m[1].toLowerCase();
    const attrs = parseLiveAttrs(m[2]);
    const selfClosing = m[3] === '/';
    this.buf = rest.slice(m[0].length);

    if (isLiveCueName(name)) {
      this.emitText(out, before);
      this.closeImplicit(out);
      out.push({ type: 'cue', name, args: attrs });
      return true;
    }
    if (isLiveBlockKind(name)) {
      this.emitText(out, before);
      this.closeImplicit(out);
      const id = this.makeId();
      out.push({ type: 'block-open', id, kind: name, attrs });
      if (selfClosing) {
        out.push({ type: 'block-close', id, complete: true });
      } else {
        this.open = { id, kind: name, closeTag: `</${name}>`, implicit: false };
      }
      return true;
    }
    // 未知标签（<br> / <b> 之类落在顶层）：当口播文本
    this.emitText(out, before + m[0]);
    return true;
  }

  /** 裸文本进隐式 say（纯空白不开新块） */
  private emitText(out: LiveEvent[], text: string): void {
    if (!text) return;
    if (!this.open) {
      if (!text.trim()) return;
      const id = this.makeId();
      this.open = { id, kind: 'say', closeTag: '', implicit: true };
      out.push({ type: 'block-open', id, kind: 'say', attrs: {} });
      text = text.replace(/^\s+/, '');
    }
    out.push({ type: 'block-delta', id: this.open.id, text });
  }

  private closeImplicit(out: LiveEvent[]): void {
    if (this.open?.implicit) {
      out.push({ type: 'block-close', id: this.open.id, complete: true });
      this.open = null;
    }
  }
}

/** 把一串事件还原成块正文（测试与历史重建共用） */
export function collectBlockBodies(events: LiveEvent[]): Map<string, string> {
  const bodies = new Map<string, string>();
  for (const ev of events) {
    if (ev.type === 'block-open') bodies.set(ev.id, '');
    else if (ev.type === 'block-delta') bodies.set(ev.id, (bodies.get(ev.id) ?? '') + ev.text);
  }
  return bodies;
}
