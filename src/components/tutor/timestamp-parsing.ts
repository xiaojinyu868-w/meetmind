// Tutor 消息里的 [t=MM:SS] 时间戳解析 + 可点击渲染（M7-fix1）
//
// 抽成纯函数，AITutor.tsx（老 SSE 路径）和 TutorAgentPanel.tsx（新 agent 路径）共用。
// 之所以有多套正则：prompt 让模型用 [t=MM:SS]，但实际模型会漂移写成 [02:15] / 02:15 / [t=2:15]，
// 都得兼容。
//
// 纯函数 → 可 vitest 测，不碰 React 渲染。

export interface TimestampMatch {
  /** 匹配到的完整字符串，如 "[t=02:15]" */
  raw: string;
  /** 显示给用户的字符串，如 "02:15" 或 "02:15-03:00" */
  display: string;
  /** 起始毫秒 */
  startMs: number;
  /** 在原文中的起止 offset */
  start: number;
  end: number;
}

/**
 * 从文本里找出所有时间戳匹配。
 *
 * 支持格式：
 *   [t=MM:SS]         — prompt 期望格式
 *   [t=HH:MM:SS]      — 长视频
 *   [MM:SS]           — 模型漂移
 *   [MM:SS-MM:SS]     — 范围引用
 *   MM:SS             — 裸时间（保守：只匹配单个 \b 边界的）
 *
 * 不会误匹配：
 *   价格 "99:99"（非单/双位数 minute + 59 秒内的）
 *   日期 "2026:05"（分隔的是 :，但小时数字不在 0-59）
 */
const TIMESTAMP_RE =
  /\[(?:t=)?(\d{1,2}(?::\d{2}){1,2}(?:-\d{1,2}(?::\d{2}){1,2})?)\]/g;

export function parseTimestamp(time: string): number | null {
  try {
    const startPiece = time.split('-')[0].trim();
    const parts = startPiece.split(':').map((p) => parseInt(p.trim(), 10));
    if (parts.some((n) => Number.isNaN(n) || n < 0)) return null;

    let h = 0;
    let m = 0;
    let s = 0;
    if (parts.length === 2) {
      [m, s] = parts;
    } else if (parts.length === 3) {
      [h, m, s] = parts;
    } else {
      return null;
    }
    if (s >= 60 || m >= 60) return null;
    return ((h * 60 + m) * 60 + s) * 1000;
  } catch {
    return null;
  }
}

export function findTimestamps(text: string): TimestampMatch[] {
  const out: TimestampMatch[] = [];
  // reset lastIndex in case the global regex has state from prior call
  TIMESTAMP_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TIMESTAMP_RE.exec(text)) !== null) {
    const display = m[1];
    const startMs = parseTimestamp(display);
    if (startMs === null) continue;
    out.push({
      raw: m[0],
      display,
      startMs,
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return out;
}

/**
 * 一键复制场景：把 [MM:SS] / [t=MM:SS] / [MM:SS-MM:SS] 标记从文本里抹掉。
 * 只抹能通过 parseTimestamp 校验的标记，[99:99] 这类误匹配原样保留。
 * 顺带清理标记走后留下的空位（标点前的空格、连续空格、行尾空格）。
 */
export function stripTimestamps(text: string): string {
  TIMESTAMP_RE.lastIndex = 0;
  return text
    .replace(TIMESTAMP_RE, (raw, display: string) => (parseTimestamp(display) === null ? raw : ''))
    .replace(/[ \t]+([，。、；：？！,.!?;:])/g, '$1')
    .replace(/([，。、；：？！])[ \t]+/g, '$1')
    .replace(/([（(「『【])[ \t]+/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

/**
 * 把文本切成 [text, ts, text, ts, ...] 段，方便 React map 渲染。
 * 返回 TextPart（纯文本）和 TimestampPart（可点击）两种节点。
 */
export type TextSpan =
  | { kind: 'text'; text: string }
  | { kind: 'timestamp'; display: string; startMs: number };

export function splitByTimestamp(text: string): TextSpan[] {
  const matches = findTimestamps(text);
  if (matches.length === 0) return [{ kind: 'text', text }];

  const parts: TextSpan[] = [];
  let cursor = 0;
  for (const m of matches) {
    if (m.start > cursor) {
      parts.push({ kind: 'text', text: text.slice(cursor, m.start) });
    }
    parts.push({ kind: 'timestamp', display: m.display, startMs: m.startMs });
    cursor = m.end;
  }
  if (cursor < text.length) {
    parts.push({ kind: 'text', text: text.slice(cursor) });
  }
  return parts;
}
