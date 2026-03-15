import type { AudioSession } from '@/lib/db';
import type { ImportedVideoSource } from '@/types';
import { parseVideoLink } from '@/lib/utils/video-link';

type StoredVideoSession = Pick<
  AudioSession,
  | 'sourceType'
  | 'mimeType'
  | 'mediaUrl'
  | 'videoUrl'
  | 'videoEmbedUrl'
  | 'videoProvider'
  | 'thumbnailUrl'
  | 'topic'
  | 'duration'
  | 'importSourceMode'
  | 'importTrace'
>;

export function isStoredVideoFileSession(session: StoredVideoSession): boolean {
  const sourceType = session.sourceType || '';
  const mimeType = (session.mimeType || '').toLowerCase();
  return sourceType === 'video-file' || (sourceType === 'upload' && mimeType.startsWith('video/'));
}

export function isStoredVideoSession(session: StoredVideoSession): boolean {
  return (session.sourceType === 'video-link' && Boolean(session.videoUrl)) || isStoredVideoFileSession(session);
}

export function buildStoredVideoSource(
  session: StoredVideoSession,
  params?: { playableUrl?: string }
): ImportedVideoSource | null {
  if (session.sourceType === 'video-link' && session.videoUrl) {
    const provider = session.videoProvider || 'bilibili';
    return {
      provider,
      providerLabel: provider === 'bilibili' ? 'Bilibili' : provider,
      originalUrl: session.videoUrl,
      resolvedUrl: session.videoUrl,
      embedUrl: session.videoEmbedUrl,
      thumbnailUrl: session.thumbnailUrl,
      title: session.topic,
      durationSec: session.duration ? session.duration / 1000 : undefined,
      sourceMode: session.importSourceMode as ImportedVideoSource['sourceMode'],
      importTrace: session.importTrace as ImportedVideoSource['importTrace'],
      bvid: session.videoUrl.match(/BV[a-zA-Z0-9]+/)?.[0],
    };
  }

  if (!isStoredVideoFileSession(session)) {
    return null;
  }

  const playableUrl = params?.playableUrl || session.mediaUrl || '';
  if (!playableUrl) {
    return null;
  }

  const detected = parseVideoLink(playableUrl);

  return {
    provider: 'direct-file',
    providerLabel: '视频文件',
    originalUrl: params?.playableUrl || session.mediaUrl || playableUrl,
    resolvedUrl: params?.playableUrl || session.mediaUrl || playableUrl,
    playableUrl,
    embedUrl: detected?.embedUrl,
    thumbnailUrl: session.thumbnailUrl,
    title: session.topic,
    durationSec: session.duration ? session.duration / 1000 : undefined,
    sourceMode: 'direct',
    importTrace: session.importTrace as ImportedVideoSource['importTrace'],
  };
}
