// 从转写文本中抽取英文片段（M7.9 翻译前置步骤）
//
// 目标：检测"一整段英文"（≥2 个英文词 + 至少一个实词 ≥ 4 字母），
// 不提取 "I am" 这种功能词集合——翻译价值为零、白花 API 费用。

const ENGLISH_RUN = /[A-Za-z]+(?:[ '\-./,:;!?&"]+[A-Za-z]+){1,}/g;

function hasContentWord(run: string): boolean {
  // 至少一个 ≥4 字母的实词（简单但有效的启发）
  return /\b[A-Za-z]{4,}\b/.test(run);
}

export function extractEnglishRuns(text: string): string[] {
  const hits = text.match(ENGLISH_RUN);
  if (!hits) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of hits) {
    const trimmed = raw.replace(/^[\s,.:;!?&"'-]+|[\s,.:;!?&"'-]+$/g, '').trim();
    const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
    if (wordCount < 2) continue;
    if (!hasContentWord(trimmed)) continue;
    if (seen.has(trimmed.toLowerCase())) continue;
    seen.add(trimmed.toLowerCase());
    out.push(trimmed);
  }
  return out;
}

/**
 * 一段文本有没有"值得翻译的英文"。
 * UI 可以用这个决定是否渲染翻译气泡的位置。
 */
export function hasTranslatableEnglish(text: string): boolean {
  return extractEnglishRuns(text).length > 0;
}

/**
 * 从转写文本中抽取适合中译英的中文片段。
 * 这里不做复杂分词：实时课堂顶部只需要把当前短句整体翻译出来。
 */
export function extractChineseRuns(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!/[\u4E00-\u9FFF]/.test(normalized)) return [];
  if (normalized.length < 2) return [];
  return [normalized.slice(0, 160)];
}
