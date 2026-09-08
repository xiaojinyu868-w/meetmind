/**
 * Stateless structured-output parser（vendor 自 OpenMAIC lib/orchestration/stateless-generate.ts）
 *
 * 只保留 Structured Output Parser 段（createParserState / parseStructuredChunk /
 * finalizeParser / looksLikeStructuredFragment / extractCleanStructuredText）——
 * 下方原有的 statelessGenerate()（LangGraph director 编排）被砍掉：spike 的 loop
 * 由 pi-agent-core 承担，不需要 director-graph。被砍部分在本文件原第 383-509 行。
 *
 * ⚠️ 上游 bug 修复（本 vendor 副本已修，将来提 PR 回上游）：
 * 原 Step 2 用 `trimmed.endsWith(']')` 判定顶层数组关闭。当动作参数含嵌套数组
 * （wb_draw_table 的 data、wb_draw_shape 的 points）时，SSE 流恰在嵌套 `]` 处
 * 停顿会提前判结，后续 text 对象被静默吞掉（teach-harness-ab REPORT §5 实证
 * 4/54 turn 中招，全部 kimi）。修复：改为括号深度扫描，只在**顶层** `]` 处判结。
 * 见 `findTopLevelArrayCloseIndex`。
 */

import { parse as parsePartialJson, Allow } from 'partial-json';
import { jsonrepair } from 'jsonrepair';
import { createLogger } from '@/lib/logger';

const log = createLogger('StatelessGenerate');

// ==================== Structured Output Parser ====================

/**
 * Parser state for incremental JSON Array parsing.
 *
 * Accumulates raw text from the LLM stream. Once the opening `[` is found,
 * uses `partial-json` to incrementally parse the growing array. Emits new
 * complete items as they appear, and streams partial text content deltas
 * for the last (potentially incomplete) text item.
 */
interface ParserState {
  /** Accumulated raw text from the LLM */
  buffer: string;
  /** Whether we've found the opening `[` */
  jsonStarted: boolean;
  /** Number of fully processed (emitted) items */
  lastParsedItemCount: number;
  /** Length of text content already emitted for the trailing partial text item */
  lastPartialTextLength: number;
  /** Whether parsing is complete (closing `]` found) */
  isDone: boolean;
}

/**
 * Create initial parser state
 */
export function createParserState(): ParserState {
  return {
    buffer: '',
    jsonStarted: false,
    lastParsedItemCount: 0,
    lastPartialTextLength: 0,
    isDone: false,
  };
}

/** Parsed action, mirroring OpenMAIC's lib/types/chat ParsedAction shape. */
export interface ParsedAction {
  actionId: string;
  actionName: string;
  params: Record<string, unknown>;
}

/**
 * Result from parsing a chunk
 */
export interface ParseResult {
  textChunks: string[];
  actions: ParsedAction[];
  isDone: boolean;
  /** Ordered sequence recording original interleaving of text and action segments */
  ordered: Array<{ type: 'text'; index: number } | { type: 'action'; index: number }>;
}

/**
 * Emit a single parsed item into the result, returning updated segment indices.
 */
function emitItem(
  item: Record<string, unknown>,
  result: ParseResult,
  textSegmentIndex: number,
  actionSegmentIndex: number,
): { textSegmentIndex: number; actionSegmentIndex: number } {
  if (item.type === 'text') {
    const content = (item.content as string) || '';
    if (content) {
      result.textChunks.push(content);
      // Use per-call array index (not cumulative segment index) so that
      // director-graph can read result.textChunks[entry.index] correctly.
      result.ordered.push({
        type: 'text',
        index: result.textChunks.length - 1,
      });
      return { textSegmentIndex: textSegmentIndex + 1, actionSegmentIndex };
    }
  } else if (item.type === 'action') {
    // Support both new format (name/params) and legacy format (tool_name/parameters)
    const action: ParsedAction = {
      actionId:
        (item.action_id as string) || `action-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      actionName: (item.name || item.tool_name) as string,
      params: (item.params || item.parameters || {}) as Record<string, unknown>,
    };
    result.actions.push(action);
    // Use per-call array index (not cumulative segment index) so that
    // director-graph can read result.actions[entry.index] correctly.
    result.ordered.push({ type: 'action', index: result.actions.length - 1 });
    return { textSegmentIndex, actionSegmentIndex: actionSegmentIndex + 1 };
  }
  return { textSegmentIndex, actionSegmentIndex };
}

/**
 * [FIX vs upstream] 在 buffer 中找顶层 JSON 数组的关闭 `]` 的下标。
 *
 * 从第一个 `[` 开始扫描，同时统计 `[]`/`{}` 深度，跳过字符串字面量（含转义）。
 * 深度归零时的那个 `]` 就是顶层关闭符。返回其在 buffer 中的下标；未关闭返回 -1。
 *
 * 上游用 `trimmed.endsWith(']')` 判定：嵌套数组参数（如 wb_draw_table 的
 * `data: [[...]]`）的中间 `]` 会让流在停顿点提前判结。深度扫描只看顶层。
 */
export function findTopLevelArrayCloseIndex(buffer: string): number {
  const open = buffer.indexOf('[');
  if (open === -1) return -1;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = open; i < buffer.length; i++) {
    const ch = buffer[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '[' || ch === '{') {
      depth++;
    } else if (ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) return i;
      if (depth < 0) return -1; // 结构性破损，交给 partial-json 兜底
    }
  }
  return -1;
}

/**
 * 顶层数组已关闭且尾部只有空白 → 判结。
 * 额外要求关闭符之后不再有非空白字符（防御 `]}` 之类尾巴，虽然合同里不该出现）。
 */
function isTopLevelArrayClosed(buffer: string): boolean {
  const closeIdx = findTopLevelArrayCloseIndex(buffer);
  if (closeIdx === -1) return false;
  return buffer.slice(closeIdx + 1).trim() === '';
}

/**
 * Parse streaming chunks of structured JSON Array output.
 *
 * The LLM is expected to produce a JSON array like:
 * [{"type":"action","name":"spotlight","params":{"elementId":"img_1"}},
 *  {"type":"text","content":"Hello students..."},...]
 *
 * This parser:
 * 1. Accumulates chunks into a buffer
 * 2. Skips any prefix before `[` (e.g. ```json\n, explanatory text)
 * 3. Uses partial-json to incrementally parse the growing array
 * 4. Emits new complete items (action→toolCall, text→textChunk)
 * 5. For the trailing incomplete text item, emits content deltas for streaming
 * 6. Marks done when the buffer contains the closing `]`
 *
 * @param chunk - New chunk of text to parse
 * @param state - Current parser state (mutated in place)
 * @returns Parsed text chunks and tool calls from this chunk
 */
export function parseStructuredChunk(chunk: string, state: ParserState): ParseResult {
  const result: ParseResult = {
    textChunks: [],
    actions: [],
    isDone: false,
    ordered: [],
  };

  if (state.isDone) {
    return result;
  }

  state.buffer += chunk;

  // Step 1: Find the opening `[` if not yet found
  if (!state.jsonStarted) {
    const bracketIndex = state.buffer.indexOf('[');
    if (bracketIndex === -1) {
      return result;
    }
    // Trim everything before `[` (markdown fences, explanatory text, etc.)
    state.buffer = state.buffer.slice(bracketIndex);
    state.jsonStarted = true;
  }

  // Step 2: Check if the array is complete (closing `]` found)
  // [FIX vs upstream] 原为 `trimmed.endsWith(']') && trimmed.length > 1`，
  // 嵌套数组参数会让流在嵌套 `]` 处提前判结。改为顶层深度扫描。
  const isArrayClosed = isTopLevelArrayClosed(state.buffer);

  // Step 3: Try incremental parse — jsonrepair first (fixes unescaped quotes), fallback to partial-json
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- partial-json returns any[]
  let parsed: any[];
  try {
    const repaired = jsonrepair(state.buffer);
    parsed = JSON.parse(repaired);
  } catch {
    try {
      parsed = parsePartialJson(
        state.buffer,
        Allow.ARR | Allow.OBJ | Allow.STR | Allow.NUM | Allow.BOOL | Allow.NULL,
      );
    } catch {
      return result;
    }
  }

  if (!Array.isArray(parsed)) {
    return result;
  }

  // Step 4: Determine how many items are fully complete
  // When the array is closed, all items are complete.
  // When still streaming, items [0..N-2] are complete; item [N-1] may be partial.
  const completeUpTo = isArrayClosed ? parsed.length : Math.max(0, parsed.length - 1);

  // Count segment indices for items already emitted
  let textSegmentIndex = 0;
  let actionSegmentIndex = 0;
  for (let i = 0; i < state.lastParsedItemCount && i < parsed.length; i++) {
    const item = parsed[i];
    if (item?.type === 'text') textSegmentIndex++;
    else if (item?.type === 'action') actionSegmentIndex++;
  }

  // Step 5: Emit newly completed items
  for (let i = state.lastParsedItemCount; i < completeUpTo; i++) {
    const item = parsed[i];
    if (!item || typeof item !== 'object') continue;

    // If this item was previously the trailing partial text item, we've already
    // streamed its content incrementally. Only emit the remaining delta, not the full content.
    if (
      i === state.lastParsedItemCount &&
      state.lastPartialTextLength > 0 &&
      item.type === 'text'
    ) {
      const content = item.content || '';
      const remaining = content.slice(state.lastPartialTextLength);
      if (remaining) {
        result.textChunks.push(remaining);
        // Only push ordered entry when there is actual content to emit
        result.ordered.push({
          type: 'text',
          index: result.textChunks.length - 1,
        });
      }
      textSegmentIndex++;
      state.lastPartialTextLength = 0;
      continue;
    }

    const indices = emitItem(item, result, textSegmentIndex, actionSegmentIndex);
    textSegmentIndex = indices.textSegmentIndex;
    actionSegmentIndex = indices.actionSegmentIndex;
  }

  state.lastParsedItemCount = completeUpTo;

  // Step 6: Stream partial text delta for the trailing item
  if (!isArrayClosed && parsed.length > completeUpTo) {
    const lastItem = parsed[parsed.length - 1];
    if (lastItem && typeof lastItem === 'object' && lastItem.type === 'text') {
      const content = lastItem.content || '';
      if (content.length > state.lastPartialTextLength) {
        result.textChunks.push(content.slice(state.lastPartialTextLength));
        state.lastPartialTextLength = content.length;
      }
    }
  }

  // Step 7: Mark done if array is closed
  if (isArrayClosed) {
    state.isDone = true;
    result.isDone = true;
    state.lastParsedItemCount = parsed.length;
    state.lastPartialTextLength = 0;
  }

  return result;
}

/**
 * Detect a leftover buffer that is structured-output residue rather than
 * natural speech — a bare object/array, or a brace-less fragment like
 * `type":"text","content":"..."` left behind when the model's JSON is
 * truncated. Used as a fail-safe so such residue is suppressed, never shown
 * as visible speech.
 */
export function looksLikeStructuredFragment(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  // The structured-output schema signature: a `type` discriminator, or one of
  // the well-known keys as a JSON property, appearing at the START of the
  // buffer. Anchoring to the start is deliberate: it still catches residue and
  // brace-less truncated tails like `type":"text","content":"...`, but does NOT
  // fire on natural speech that merely mentions a JSON example mid-sentence,
  // e.g. `我们用对象 {"name":"树"} 表示一棵树。` — which must stay visible.
  const hasSchemaKey =
    /^"?type"?\s*:\s*"(text|action)"/.test(trimmed) ||
    /^"(content|name|params|action_id)"\s*:/.test(trimmed);
  if (hasSchemaKey) return true;
  // A bare `{`/`[` opener counts only when it is immediately structural
  // (another opener, a quoted key, a closer, or end-of-string) — NOT any
  // sentence that merely starts with a bracket, e.g. "[重点] ..." or set
  // notation "{x | x > 0}".
  return /^[[{]\s*([[{"\]}]|$)/.test(trimmed);
}

/**
 * When the model emits a bare structured object/array instead of the required
 * top-level array, extract visible text from well-formed `{type:'text'}` items.
 * Requires a strict parse: a malformed object (one that would need repair), or
 * an action/unknown-typed object, yields no text so the caller suppresses it
 * rather than leaking raw JSON.
 */
function extractCleanStructuredText(raw: string): { matched: boolean; texts: string[] } {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return { matched: false, texts: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { matched: false, texts: [] };
  }
  const items = Array.isArray(parsed) ? parsed : [parsed];
  const allTyped = items.every(
    (item) => item && typeof item === 'object' && 'type' in (item as object),
  );
  if (!allTyped) {
    return { matched: false, texts: [] };
  }
  const texts: string[] = [];
  for (const item of items) {
    const obj = item as Record<string, unknown>;
    if (obj.type === 'text' && typeof obj.content === 'string' && obj.content.trim()) {
      texts.push(obj.content);
    }
  }
  return { matched: true, texts };
}

/**
 * Finalize parsing after the stream ends.
 *
 * Handles the case where the model never produced a valid JSON array. Rather
 * than dumping the raw buffer (which leaks `{"type":"text",...}` into the
 * chat bubble), we structurally recover visible text where possible and
 * suppress anything that is still structured-output residue.
 */
export function finalizeParser(state: ParserState): ParseResult {
  const result: ParseResult = {
    textChunks: [],
    actions: [],
    isDone: true,
    ordered: [],
  };

  if (state.isDone) {
    return result;
  }

  const content = state.buffer.trim();
  if (!content) {
    state.isDone = true;
    return result;
  }

  const pushText = (value: string) => {
    if (!value) return;
    result.textChunks.push(value);
    result.ordered.push({ type: 'text', index: result.textChunks.length - 1 });
  };

  if (!state.jsonStarted) {
    // Model never emitted the required top-level `[`. It may have produced a
    // bare structured object, a truncated JSON fragment, or genuine prose.
    const structured = extractCleanStructuredText(content);
    if (structured.matched) {
      // Bare `{type:'text'}` (or array of them) → show content; action/unknown → suppress.
      structured.texts.forEach(pushText);
    } else if (!looksLikeStructuredFragment(content)) {
      // Genuine plain prose — display it.
      pushText(content);
    } else {
      // JSON-ish fragment that did not parse cleanly → suppress (never leak raw
      // JSON). Log so this path stays observable instead of silently dropping.
      log.debug(
        `[finalizeParser] Suppressed structured-output residue (${content.length} chars): ${content.slice(0, 80)}`,
      );
    }
  } else {
    // JSON array started but never closed — flush whatever the incremental
    // parser can still recover. Intentionally NO raw-buffer fallback:
    // suppressing a truncated structured tail is safer than leaking
    // `{"type":"text",...` as visible speech.
    const finalChunk = parseStructuredChunk('', state);
    result.textChunks.push(...finalChunk.textChunks);
    result.actions.push(...finalChunk.actions);
    result.ordered.push(...finalChunk.ordered);
  }

  state.isDone = true;
  return result;
}
