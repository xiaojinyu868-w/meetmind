const DIRECT_MEDIA_EXTENSIONS = [
  '.mp4',
  '.mov',
  '.webm',
  '.mkv',
  '.m4v',
  '.m3u8',
  '.mp3',
  '.m4a',
  '.wav',
  '.aac',
  '.flac',
  '.ogg',
];

export type VideoProvider =
  | 'youtube'
  | 'bilibili'
  | 'douyin'
  | 'direct-file'
  | 'generic';

export interface ParsedVideoLink {
  provider: VideoProvider;
  providerLabel: string;
  originalUrl: string;
  playableUrl?: string;
  embedUrl?: string;
  videoId?: string;
}

function normalizeHost(hostname: string): string {
  return hostname.replace(/^www\./i, '').toLowerCase();
}

function stripHashAndQuery(url: string): string {
  const hashIndex = url.indexOf('#');
  const queryIndex = url.indexOf('?');
  const cut = [hashIndex, queryIndex].filter((v) => v >= 0);
  if (cut.length === 0) return url;
  return url.slice(0, Math.min(...cut));
}

function isDirectMediaPath(pathname: string): boolean {
  const lowered = pathname.toLowerCase();
  return DIRECT_MEDIA_EXTENSIONS.some((ext) => lowered.endsWith(ext));
}

function extractYouTubeVideoId(url: URL): string | null {
  const host = normalizeHost(url.hostname);
  if (host === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0];
    return id || null;
  }

  if (host.endsWith('youtube.com')) {
    const v = url.searchParams.get('v');
    if (v) return v;

    const pathParts = url.pathname.split('/').filter(Boolean);
    if (pathParts[0] === 'shorts' && pathParts[1]) return pathParts[1];
    if (pathParts[0] === 'embed' && pathParts[1]) return pathParts[1];
  }

  return null;
}

function extractBilibiliVideoId(url: URL): string | null {
  const match = url.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/);
  return match?.[1] || null;
}

export function isLikelyDirectMediaUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return isDirectMediaPath(stripHashAndQuery(url.pathname));
  } catch {
    return false;
  }
}

export function parseVideoLink(rawUrl: string): ParsedVideoLink | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null;
  }

  const host = normalizeHost(url.hostname);
  const cleaned = stripHashAndQuery(url.pathname);

  const youtubeId = extractYouTubeVideoId(url);
  if (youtubeId) {
    return {
      provider: 'youtube',
      providerLabel: 'YouTube',
      originalUrl: trimmed,
      videoId: youtubeId,
      embedUrl: `https://www.youtube.com/embed/${youtubeId}`,
      playableUrl: trimmed,
    };
  }

  if (host.endsWith('bilibili.com') || host === 'b23.tv') {
    const bvid = extractBilibiliVideoId(url);
    return {
      provider: 'bilibili',
      providerLabel: 'Bilibili',
      originalUrl: trimmed,
      videoId: bvid || undefined,
      embedUrl: bvid
        ? `https://player.bilibili.com/player.html?bvid=${bvid}&page=1`
        : undefined,
      playableUrl: trimmed,
    };
  }

  if (host.endsWith('douyin.com')) {
    return {
      provider: 'douyin',
      providerLabel: 'Douyin',
      originalUrl: trimmed,
      playableUrl: trimmed,
    };
  }

  if (isDirectMediaPath(cleaned)) {
    return {
      provider: 'direct-file',
      providerLabel: 'Direct Media',
      originalUrl: trimmed,
      playableUrl: trimmed,
    };
  }

  return {
    provider: 'generic',
    providerLabel: 'Web Video',
    originalUrl: trimmed,
    playableUrl: trimmed,
  };
}
