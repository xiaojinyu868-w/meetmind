/**
 * 微信媒体下载与持久化服务
 *
 * - 图片：直接下载 PicUrl（HTTP 链接，无需 access_token）
 * - 语音/视频：需要 access_token 调用临时素材接口（认证后启用）
 *
 * 文件保存到 public/wechat-media/ 目录，通过 Next.js 静态文件服务对外访问。
 */

import fs from 'fs/promises';
import path from 'path';

const WECHAT_APP_ID = process.env.WECHAT_APP_ID || '';
const WECHAT_APP_SECRET = process.env.WECHAT_APP_SECRET || '';
const MEDIA_DIR = path.join(process.cwd(), 'public', 'wechat-media');

// access_token 缓存（有效期 2 小时，提前 5 分钟刷新）
let cachedAccessToken: { token: string; expiresAt: number } | null = null;

async function ensureMediaDir(subdir?: string): Promise<string> {
  const dir = subdir ? path.join(MEDIA_DIR, subdir) : MEDIA_DIR;
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * 获取微信全局 access_token（服务端调用接口用，不是 OAuth 用的）
 */
export async function getWechatAccessToken(): Promise<string | null> {
  if (!WECHAT_APP_ID || !WECHAT_APP_SECRET) {
    return null;
  }

  const now = Date.now();
  if (cachedAccessToken && cachedAccessToken.expiresAt > now) {
    return cachedAccessToken.token;
  }

  try {
    const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${WECHAT_APP_ID}&secret=${WECHAT_APP_SECRET}`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.errcode) {
      console.error('[wechat-media] getAccessToken failed:', data);
      return null;
    }

    cachedAccessToken = {
      token: data.access_token,
      expiresAt: now + (data.expires_in - 300) * 1000, // 提前 5 分钟过期
    };

    return data.access_token;
  } catch (error) {
    console.error('[wechat-media] getAccessToken error:', error);
    return null;
  }
}

/**
 * 下载图片（直接用 PicUrl，不需要 access_token）
 *
 * @returns 本地相对 URL（如 /wechat-media/images/abc123.jpg）或 null
 */
export async function downloadWechatImage(picUrl: string, linkToken: string): Promise<string | null> {
  if (!picUrl) return null;

  try {
    const dir = await ensureMediaDir('images');
    const ext = '.jpg'; // 微信图片统一 jpg
    const filename = `${linkToken}${ext}`;
    const filepath = path.join(dir, filename);

    // 如果已下载则跳过
    try {
      await fs.access(filepath);
      return `/wechat-media/images/${filename}`;
    } catch {
      // 文件不存在，继续下载
    }

    const res = await fetch(picUrl);
    if (!res.ok) {
      console.error(`[wechat-media] download image failed: ${res.status} ${picUrl}`);
      return null;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    await fs.writeFile(filepath, buffer);
    console.log(`[wechat-media] image saved: ${filename} (${buffer.length} bytes)`);

    return `/wechat-media/images/${filename}`;
  } catch (error) {
    console.error('[wechat-media] downloadWechatImage error:', error);
    return null;
  }
}

/**
 * 通过 MediaId 下载微信临时素材（语音/视频）
 *
 * 需要 access_token（服务号认证后可用）
 *
 * @returns 本地相对 URL 或 null
 */
export async function downloadWechatMedia(
  mediaId: string,
  linkToken: string,
  type: 'voice' | 'video' = 'voice'
): Promise<string | null> {
  if (!mediaId) return null;

  const accessToken = await getWechatAccessToken();
  if (!accessToken) {
    console.log('[wechat-media] no access_token, skip media download (need certification)');
    return null;
  }

  try {
    const subdir = type === 'voice' ? 'voice' : 'video';
    const ext = type === 'voice' ? '.amr' : '.mp4';
    const dir = await ensureMediaDir(subdir);
    const filename = `${linkToken}${ext}`;
    const filepath = path.join(dir, filename);

    // 如果已下载则跳过
    try {
      await fs.access(filepath);
      return `/wechat-media/${subdir}/${filename}`;
    } catch {
      // 文件不存在，继续下载
    }

    const url = `https://api.weixin.qq.com/cgi-bin/media/get?access_token=${accessToken}&media_id=${mediaId}`;
    const res = await fetch(url);

    if (!res.ok) {
      console.error(`[wechat-media] download media failed: ${res.status}`);
      return null;
    }

    // 检查是否返回了错误 JSON 而不是二进制文件
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json') || contentType.includes('text/plain')) {
      const errorData = await res.json();
      console.error('[wechat-media] media API returned error:', errorData);
      return null;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    await fs.writeFile(filepath, buffer);
    console.log(`[wechat-media] ${type} saved: ${filename} (${buffer.length} bytes)`);

    return `/wechat-media/${subdir}/${filename}`;
  } catch (error) {
    console.error(`[wechat-media] downloadWechatMedia error:`, error);
    return null;
  }
}

export default {
  getWechatAccessToken,
  downloadWechatImage,
  downloadWechatMedia,
};
