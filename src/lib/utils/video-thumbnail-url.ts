export function resolveVideoThumbnailUrl(url: string | null | undefined): string | null {
  const value = url?.trim();
  if (!value) return null;

  try {
    const parsed = new URL(value);
    const isBilibiliImage = parsed.hostname.endsWith('hdslb.com') && parsed.pathname.startsWith('/bfs/');
    if (isBilibiliImage) {
      return `/api/video/image?url=${encodeURIComponent(parsed.toString())}`;
    }
  } catch {
    return value;
  }

  return value;
}
