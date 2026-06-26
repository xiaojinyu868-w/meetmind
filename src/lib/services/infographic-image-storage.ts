import * as fs from 'fs';
import * as path from 'path';

const BASE_DIR = path.join(process.cwd(), 'public', 'uploads', 'infographic');

/**
 * 把信息图 base64 图片写到服务端文件，返回可访问的 HTTP URL。
 *
 * 不用 base64 data URL：base64 太大（几百 KB - 1MB），进 localStorage 会被
 * useAppExecution 的 stripLargeInlineData 剥空，进 SharedAgent.snapshotJson 也不可靠
 * （分享页读不到图）。HTTP URL 小，localStorage / snapshotJson 都能存，
 * 跨 tab/会话/设备可读。
 *
 * 被 studio-workshop.plugin（/api/apps/execute）和 generate-image route 共用。
 */
export function persistInfographicImage(
  base64: string,
  mimeType: string,
  fallbackName: string,
): string {
  const ext = mimeType === 'image/jpeg' ? 'jpg' : 'png';
  const filename = `${fallbackName || 'infographic'}-${Date.now()}.${ext}`;
  fs.mkdirSync(BASE_DIR, { recursive: true });
  fs.writeFileSync(path.join(BASE_DIR, filename), Buffer.from(base64, 'base64'));
  return `/api/infographic/image/${filename}`;
}
