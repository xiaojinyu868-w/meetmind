/**
 * Recent-focus extraction (M8-D3).
 *
 * 从一组转录段落中取"最近 N 毫秒"的文本作为 companion 的隐式聚焦上下文。
 * 分离到单独文件有三个好处：
 *   1. 可在 node 测试环境里单测，不用 mock React hooks
 *   2. 将来 mobile companion / review-mode companion 需要同样的"刚才讲到"
 *      逻辑时，直接 import 这一个地方的真理
 *   3. 如果后端也要做"根据最后一句 final segment 判断讨论点"，
 *      TypeScript 端可以和 Next.js API 复用同一个算法
 */

export interface RecentFocusInput {
  startMs?: number;
  endMs?: number;
  text?: string;
}

export interface RecentFocusOptions {
  /** 时间窗口（ms）。默认 30s */
  windowMs?: number;
  /** 文本上限。默认 600 字 */
  maxChars?: number;
}

const DEFAULT_WINDOW_MS = 30_000;
const DEFAULT_MAX_CHARS = 600;

export function extractRecentFocus(
  segments: RecentFocusInput[],
  options: RecentFocusOptions = {},
): string {
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;

  if (segments.length === 0) return '';
  const latestEnd = segments[segments.length - 1].endMs ?? 0;
  if (latestEnd <= 0) return '';

  const cutoff = Math.max(0, latestEnd - windowMs);
  const recent = segments.filter((s) => {
    const t = s.endMs ?? s.startMs ?? 0;
    return t >= cutoff;
  });
  if (recent.length === 0) return '';

  const text = recent
    .map((s) => (s.text ?? '').trim())
    .filter(Boolean)
    .join(' ')
    .trim();

  if (text.length <= maxChars) return text;
  // 保留"刚刚说的"那尾段——超长时丢弃 30s 窗口内较早的部分
  return text.slice(text.length - maxChars);
}
