import type { EchoData } from './EchoCard';

function compactShareText(value: string | undefined | null): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function sanitizeFilePart(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 36);
}

function resolveEchoDateKey(echo: EchoData): string {
  const date = new Date(echo.updatedAt || echo.createdAt);
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

export function buildEchoShareText(echo: EchoData, courseName?: string): string {
  const title = compactShareText(courseName || echo.title);
  const body = compactShareText(echo.body);
  const takeaway = compactShareText(echo.takeaway);

  return [
    title ? `我用 MeetMind 整理了「${title}」里的一条课堂笔记：` : '我用 MeetMind 整理了一条课堂笔记：',
    '',
    body,
    takeaway ? `\n一句话带走：${takeaway}` : '',
    '',
    '— MeetMind',
  ].filter((part) => part !== '').join('\n');
}

export function buildEchoShareFileName(echo: EchoData, courseName?: string): string {
  const base = sanitizeFilePart(courseName || echo.title || '课堂笔记') || '课堂笔记';
  return `MeetMind-${base}-${resolveEchoDateKey(echo)}.png`;
}

export async function dataUrlToFile(dataUrl: string, fileName: string): Promise<File> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], fileName, { type: blob.type || 'image/png' });
}
