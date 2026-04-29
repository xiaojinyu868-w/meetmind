export function normalizeCompanionMarkdown(text: string): string {
  // 形如 [MM:SS] 或 [MM:SS-MM:SS] 或 [引用 MM:SS]
  const tsRegex = /\[(?:引用\s*)?\d{1,2}:\d{2}(?:-\d{1,2}:\d{2})?\]/g;
  return text
    .replace(tsRegex, '')
    .split('\n')
    .map((line) => line.replace(/[\t ]{2,}/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
