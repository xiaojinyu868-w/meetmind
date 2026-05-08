/**
 * companion-markdown-utils — 把 AI 同学的消息流里零散嵌入的时间戳引用
 * （[MM:SS] / [MM:SS-MM:SS] / [引用 MM:SS]）抽出来，变成结构化的
 * citation 数据 + 干净的正文。
 *
 * 为什么要抽：
 *   - 让正文保持"朋友说话"的口吻，不被内嵌的时间戳打断（内嵌的 hyper-
 *     链接样式太"工程感"，不适合 K12 同学对话）
 *   - 抽出来的 citations 作为一排小 chip 挂在气泡下方，用户点了才跳转
 *   - 同时保留历史行为：不点 chip 就看不到任何时间戳，视觉上不吵
 *
 * 输出契约：
 *   extractCitationsFromMarkdown(text) →
 *     { content: string; citations: Array<{ startMs, endMs, label }> }
 *   - `content` 是去掉所有时间戳标记后的 markdown，直接喂 ReactMarkdown
 *   - `citations` 按出现顺序、去重、最多保留 6 条
 */

export interface CompanionCitation {
  /** 跳转起点（毫秒） */
  startMs: number;
  /** 跳转终点（毫秒）。没区间时 = startMs + 2000，方便高亮时显示一小段 */
  endMs: number;
  /** 展示给用户的短标签，如 "01:23" 或 "01:23-01:45" */
  label: string;
}

const CITATION_REGEX = /\[(?:引用\s*)?(\d{1,2}):(\d{2})(?:-(\d{1,2}):(\d{2}))?\]/g;

function toMs(minutes: number, seconds: number): number {
  return (minutes * 60 + seconds) * 1000;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * 解析 AI 文本里的所有时间戳引用，返回 citations + 去掉标记后的正文。
 */
export function extractCitationsFromMarkdown(text: string): {
  content: string;
  citations: CompanionCitation[];
} {
  if (!text) return { content: '', citations: [] };

  const seen = new Set<string>();
  const citations: CompanionCitation[] = [];

  const strippedRaw = text.replace(CITATION_REGEX, (_full, mm, ss, mm2, ss2) => {
    const startMinutes = Number(mm);
    const startSeconds = Number(ss);
    if (!Number.isFinite(startMinutes) || !Number.isFinite(startSeconds)) return '';

    const startMs = toMs(startMinutes, startSeconds);
    const hasRange = typeof mm2 === 'string' && typeof ss2 === 'string';
    const endMs = hasRange
      ? toMs(Number(mm2), Number(ss2))
      : startMs + 2000;

    const label = hasRange
      ? `${pad(startMinutes)}:${pad(startSeconds)}-${pad(Number(mm2))}:${pad(Number(ss2))}`
      : `${pad(startMinutes)}:${pad(startSeconds)}`;

    const key = `${startMs}-${endMs}`;
    if (!seen.has(key) && citations.length < 6) {
      seen.add(key);
      citations.push({ startMs, endMs, label });
    }
    return '';
  });

  // 正文清洗：去除连续空格、空行，去掉由于摘掉标记留下的"孤立空括号"
  const content = strippedRaw
    .replace(/\s+([。，！？；：、])/g, '$1')
    .split('\n')
    .map((line) => line.replace(/[\t ]{2,}/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { content, citations };
}

/**
 * 保留旧函数名做向后兼容——单测有引用 normalizeCompanionMarkdown 的地方
 * 继续得到"干净正文"（丢掉 citation 数组）。
 */
export function normalizeCompanionMarkdown(text: string): string {
  return extractCitationsFromMarkdown(text).content;
}
