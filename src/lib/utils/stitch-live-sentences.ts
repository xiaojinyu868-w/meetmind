/**
 * stitch-live-sentences
 *
 * 把 ASR 物理切片（按 600ms-2s 时间窗口切，常常在词中间断开）缝合成
 * **自然句子流**，让课堂阅读视图像连续字幕而不是 debug 日志。
 *
 * 用户痛点：
 *   - "look" + "s and appearances..." → 应该愈合成 "looks and appearances..."
 *   - "a" + "bility" → 愈合成 "ability"
 *   - "ev" + "eryone" → 愈合成 "everyone"
 *   - 每 2 秒一个时间戳块视觉跳跃严重，没法跟读
 *
 * 算法：
 *   1. 顺序消费 rows，缓冲累积当前句
 *   2. 词中切检测：上片末尾 [A-Za-z] + 本片开头 [a-z] → 无缝拼接（无空格）
 *   3. 中文相邻 → 不加空格；其它 → 加空格
 *   4. 遇到句尾符 .!?。！？ 立即 flush
 *   5. 缓冲超 100 字且遇到 , ; ， ； 也 flush（防无标点长讲变一坨）
 *   6. interim 行单独成句，标 isInterim
 *
 * 翻译合并：同一句包含的多 row 的 translations 用 ' / ' 拼起来（去重）。
 *
 * 这是纯客户端 stitching；不动 ASR 链路，不动后端。
 */

export interface LiveSentenceInput {
  id: string;
  text: string;
  startMs: number;
  isInterim: boolean;
  translation?: string;
}

export interface StitchedSentence {
  id: string;
  startMs: number;
  text: string;
  translation: string | undefined;
  isInterim: boolean;
}

const MAX_BUFFER_CHARS = 110;
const SENTENCE_END_RE = /[.!?。！？]\s*$/;
const SOFT_BREAK_RE = /[,;，；]\s*$/;
const CJK_RE = /[\u4e00-\u9fff]/;

export function stitchLiveSentences(rows: LiveSentenceInput[]): StitchedSentence[] {
  const out: StitchedSentence[] = [];

  type Buffer = {
    startMs: number;
    rowIds: string[];
    chars: string;
    translations: string[];
  };
  let buf: Buffer | null = null;

  const flush = () => {
    if (!buf) return;
    const text = buf.chars.trim();
    if (!text) {
      buf = null;
      return;
    }
    out.push({
      id: buf.rowIds.join('+'),
      startMs: buf.startMs,
      text,
      translation: buf.translations.length > 0 ? buf.translations.join(' / ') : undefined,
      isInterim: false,
    });
    buf = null;
  };

  for (const row of rows) {
    if (row.isInterim) {
      // interim 单独成句，先把已有 buf flush（保持时序）
      flush();
      const text = row.text.trim();
      if (text) {
        out.push({
          id: row.id,
          startMs: row.startMs,
          text,
          translation: undefined,
          isInterim: true,
        });
      }
      continue;
    }

    if (!buf) {
      buf = { startMs: row.startMs, rowIds: [], chars: '', translations: [] };
    }

    const incoming = row.text;
    if (buf.chars === '') {
      // 第一片：去掉 leading whitespace 但保留内部
      buf.chars = incoming.replace(/^\s+/, '');
    } else {
      // M14.5.6: 基于 ASR 空格信号判断词中切（不再用启发式猜测）。
      //
      // ASR 在词边界切片时通常给 trailing space ("beauty " + "are...")；
      // 在词中切时不给空格 ("look" + "s and...")。
      // 这是唯一可靠的区分信号。之前用 [a-zA-Z]+[a-z] 启发式会把
      // "beauty"+"are" 误识别为词中切→"beautyare"。
      const prevHasTrailingSpace = /\s$/.test(buf.chars);
      const curHasLeadingSpace = /^\s/.test(incoming);
      const hasExplicitBoundary = prevHasTrailingSpace || curHasLeadingSpace;

      const prevEnd = buf.chars.replace(/\s+$/, '').slice(-1);
      const curStart = incoming.replace(/^\s+/, '').charAt(0);
      const cjkAdjacent = CJK_RE.test(prevEnd) || CJK_RE.test(curStart);
      const endsWithPunct = /[.,!?;:。，！？；：、—)\]]$/.test(prevEnd);
      const startsWithPunct = /^[.,!?;:。，！？；：、—)\]]/.test(curStart);

      if (hasExplicitBoundary) {
        // ASR 已经给了空格 → 信任 ASR，直接拼（不重复加空格、不无缝）
        buf.chars += incoming;
      } else if (cjkAdjacent || endsWithPunct || startsWithPunct) {
        // 中文相邻 / 标点边界 → 不加空格直接拼
        buf.chars += incoming;
      } else {
        // 双方都是字母都没空格 → ASR 词中切信号 → 无缝愈合
        // ("look" + "s and..." → "looks and...")
        // ("a" + "bility..." → "ability...")
        buf.chars += incoming;
      }
    }

    buf.rowIds.push(row.id);
    if (row.translation) {
      const tr = row.translation.trim();
      if (tr && !buf.translations.includes(tr)) {
        buf.translations.push(tr);
      }
    }

    // 触发 flush 的两个条件：
    //   1. 句尾符（最自然）
    //   2. 缓冲超长 + 遇软标点（无标点长讲的兜底）
    const trimmedChars = buf.chars.trim();
    if (SENTENCE_END_RE.test(trimmedChars)) {
      flush();
    } else if (buf.chars.length >= MAX_BUFFER_CHARS && SOFT_BREAK_RE.test(trimmedChars)) {
      flush();
    } else if (buf.chars.length >= MAX_BUFFER_CHARS * 1.6) {
      // 极端长无标点 → 强制 flush 防出现 200+ 字一段
      flush();
    }
  }

  flush();
  return out;
}
