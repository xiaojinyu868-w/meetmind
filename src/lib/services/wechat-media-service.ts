import fs from 'fs/promises';
import path from 'path';
import { safeUnlink, transcodeToMp3 } from '@/lib/services/media-tooling';
import {
  isWechatPlayableAudioUrl,
  normalizeWechatMediaPublicPath,
} from '@/lib/services/wechat-voice-utils';
import { createLogger } from '@/lib/logger';
const log = createLogger('wechat-media');


const WECHAT_APP_ID = process.env.WECHAT_APP_ID || '';
const WECHAT_APP_SECRET = process.env.WECHAT_APP_SECRET || '';
const MEDIA_DIR = path.join(process.cwd(), 'public', 'wechat-media');

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

async function ensureMediaDir(subdir?: string): Promise<string> {
  const dir = subdir ? path.join(MEDIA_DIR, subdir) : MEDIA_DIR;
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function resolveLocalWechatMediaPath(value?: string | null): string | null {
  const normalized = normalizeWechatMediaPublicPath(value);
  if (!normalized) return null;

  const pathname = normalized.split('?')[0] || '';
  if (!pathname.startsWith('/wechat-media/')) return null;
  return path.join(process.cwd(), 'public', pathname.replace(/^\//, ''));
}

export async function getWechatAccessToken(forceRefresh = false): Promise<string | null> {
  if (!WECHAT_APP_ID || !WECHAT_APP_SECRET) {
    return null;
  }

  const now = Date.now();
  if (!forceRefresh && cachedAccessToken && cachedAccessToken.expiresAt > now) {
    return cachedAccessToken.token;
  }

  try {
    const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${WECHAT_APP_ID}&secret=${WECHAT_APP_SECRET}`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.errcode) {
      log.error('[wechat-media] getAccessToken failed:', data);
      return null;
    }

    cachedAccessToken = {
      token: data.access_token,
      expiresAt: now + (data.expires_in - 300) * 1000,
    };

    return data.access_token;
  } catch (error) {
    log.error('[wechat-media] getAccessToken error:', error);
    return null;
  }
}

export async function downloadWechatImage(picUrl: string, linkToken: string): Promise<string | null> {
  if (!picUrl) return null;

  try {
    const dir = await ensureMediaDir('images');
    const filename = `${linkToken}.jpg`;
    const filepath = path.join(dir, filename);

    try {
      await fs.access(filepath);
      return `/wechat-media/images/${filename}`;
    } catch {
      // continue download
    }

    const res = await fetch(picUrl);
    if (!res.ok) {
      log.error(`[wechat-media] download image failed: ${res.status} ${picUrl}`);
      return null;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    await fs.writeFile(filepath, buffer);

    return `/wechat-media/images/${filename}`;
  } catch (error) {
    log.error('[wechat-media] downloadWechatImage error:', error);
    return null;
  }
}

export async function downloadWechatMedia(
  mediaId: string,
  linkToken: string,
  type: 'voice' | 'video' = 'voice'
): Promise<string | null> {
  if (!mediaId) return null;

  const accessToken = await getWechatAccessToken();
  if (!accessToken) {
    return null;
  }

  try {
    const subdir = type === 'voice' ? 'voice' : 'video';
    const dir = await ensureMediaDir(subdir);
    const publicExt = type === 'voice' ? '.mp3' : '.mp4';
    const publicFilename = `${linkToken}${publicExt}`;
    const publicFilepath = path.join(dir, publicFilename);

    try {
      await fs.access(publicFilepath);
      return `/wechat-media/${subdir}/${publicFilename}`;
    } catch {
      // continue download
    }

    const url = `https://api.weixin.qq.com/cgi-bin/media/get?access_token=${accessToken}&media_id=${mediaId}`;
    const res = await fetch(url);

    if (!res.ok) {
      log.error(`[wechat-media] download media failed: ${res.status}`);
      return null;
    }

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json') || contentType.includes('text/plain')) {
      const errorData = await res.json();
      log.error('[wechat-media] media API returned error:', errorData);
      return null;
    }

    const buffer = Buffer.from(await res.arrayBuffer());

    if (type === 'voice') {
      const rawFilepath = path.join(dir, `${linkToken}.download`);
      const fallbackFilepath = path.join(dir, `${linkToken}.amr`);

      try {
        await fs.writeFile(rawFilepath, buffer);
        await transcodeToMp3(rawFilepath, publicFilepath);
        return `/wechat-media/${subdir}/${publicFilename}`;
      } catch (error) {
        log.error('[wechat-media] voice transcode failed, fallback to original format:', error);
        await fs.writeFile(fallbackFilepath, buffer);
        return `/wechat-media/${subdir}/${linkToken}.amr`;
      } finally {
        safeUnlink(rawFilepath);
      }
    }

    await fs.writeFile(publicFilepath, buffer);
    return `/wechat-media/${subdir}/${publicFilename}`;
  } catch (error) {
    log.error('[wechat-media] downloadWechatMedia error:', error);
    return null;
  }
}

export async function ensureWechatVoicePlaybackUrl(params: {
  linkToken: string;
  mediaUrl?: string | null;
  mediaId?: string | null;
}): Promise<string | null> {
  const normalized = normalizeWechatMediaPublicPath(params.mediaUrl);

  if (normalized && isWechatPlayableAudioUrl(normalized)) {
    const localPath = resolveLocalWechatMediaPath(normalized);
    if (localPath) {
      try {
        await fs.access(localPath);
        return normalized.split('?')[0];
      } catch {
        // continue
      }
    }
  }

  const targetDir = await ensureMediaDir('voice');
  const targetFilename = `${params.linkToken}.mp3`;
  const targetFilepath = path.join(targetDir, targetFilename);

  try {
    await fs.access(targetFilepath);
    return `/wechat-media/voice/${targetFilename}`;
  } catch {
    // continue
  }

  const localSourcePath = resolveLocalWechatMediaPath(normalized);
  if (localSourcePath) {
    try {
      await fs.access(localSourcePath);
      await transcodeToMp3(localSourcePath, targetFilepath);
      return `/wechat-media/voice/${targetFilename}`;
    } catch (error) {
      log.error('[wechat-media] ensureWechatVoicePlaybackUrl local transcode failed:', error);
    }
  }

  if (params.mediaId) {
    return downloadWechatMedia(params.mediaId, params.linkToken, 'voice');
  }

  return normalized || null;
}

export function resolveWechatMediaFilePath(value?: string | null): string | null {
  return resolveLocalWechatMediaPath(value);
}

const wechatMediaService = {
  getWechatAccessToken,
  downloadWechatImage,
  downloadWechatMedia,
  ensureWechatVoicePlaybackUrl,
  resolveWechatMediaFilePath,
};

export default wechatMediaService;
