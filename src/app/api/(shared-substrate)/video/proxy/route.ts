/**
 * B站视频/音频流代理 API
 *
 * 前端通过 /api/video/proxy?bvid=xxx&cid=xxx 获取可直接播放的媒体流。
 * 服务端代理 B站 CDN 的 Dash 视频/音频流，并设置正确的 CORS 和 Content-Type。
 *
 * 这样前端可以用原生 <video> 标签替代 iframe embed，获得完整的倍速/全屏/移动端体验。
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  fetchViewMeta,
  fetchPlayurlAudio,
  BILIBILI_REFERER,
  BILIBILI_USER_AGENT,
} from '@/lib/services/bilibili-import-service';
import { createLogger } from '@/lib/logger';

const log = createLogger('video/proxy');

export const runtime = 'nodejs';

// 缓存已解析的 CDN 地址，避免频繁调用 B站 API（地址有效期通常 2 小时）
const urlCache = new Map<string, { url: string; expiresAt: number }>();
const CACHE_TTL_MS = 90 * 60 * 1000; // 90 分钟

interface DashVideoItem {
  baseUrl?: string;
  base_url?: string;
  bandwidth?: number;
  width?: number;
  height?: number;
  codecid?: number;
  codecs?: string;
  mimeType?: string;
  mime_type?: string;
}

/**
 * 获取 B站 Dash 视频流地址（选择合适的清晰度）
 */
async function fetchBiliVideoStreamUrl(bvid: string, cid: number): Promise<{
  videoUrl: string;
  audioUrl: string;
  mimeType: string;
}> {
  const cookie = process.env.BILIBILI_COOKIE || '';
  const headers: Record<string, string> = {
    Referer: BILIBILI_REFERER,
    'User-Agent': BILIBILI_USER_AGENT,
  };
  if (cookie) {
    headers.Cookie = cookie;
  }

  // 请求 Dash 格式（fnval=4048 包含视频+音频的所有可用流）
  const apiController = new AbortController();
  const apiTimeout = setTimeout(() => apiController.abort(), 30_000);
  let response: Response;
  try {
    response = await fetch(
      `https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(bvid)}&cid=${cid}&fnval=4048&qn=64&fourk=0`,
      { headers, redirect: 'follow', signal: apiController.signal }
    );
  } finally {
    clearTimeout(apiTimeout);
  }

  if (!response.ok) {
    throw new Error(`B站 playurl API 失败: ${response.status}`);
  }

  const data = await response.json() as {
    code: number;
    data?: {
      dash?: {
        video?: DashVideoItem[];
        audio?: Array<{ baseUrl?: string; base_url?: string; bandwidth?: number; codecs?: string }>;
      };
      durl?: Array<{ url?: string }>;
    };
  };

  if (data.code !== 0 || !data.data) {
    throw new Error(`B站 playurl API 返回错误: ${data.code}`);
  }

  const dash = data.data.dash;

  if (dash?.video?.length) {
    // 选择 720p 或最接近的清晰度（平衡加载速度和画质）
    const sortedVideo = [...dash.video]
      .filter((v) => (v.baseUrl || v.base_url))
      .sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0));

    // 优先选 720p（width=1280 或 height=720），否则选最高画质
    const preferred = sortedVideo.find((v) =>
      (v.width === 1280 || v.height === 720)
    ) || sortedVideo.find((v) =>
      (v.bandwidth || 0) < 2_000_000 // 选低于 2Mbps 的最高画质
    ) || sortedVideo[sortedVideo.length - 1] || sortedVideo[0];

    const videoUrl = preferred.baseUrl || preferred.base_url || '';

    // 音频流
    const sortedAudio = [...(dash.audio || [])]
      .filter((a) => (a.baseUrl || a.base_url))
      .sort((a, b) => (a.bandwidth || 0) - (b.bandwidth || 0));
    const audioUrl = sortedAudio[0]?.baseUrl || sortedAudio[0]?.base_url || '';

    return {
      videoUrl,
      audioUrl,
      mimeType: preferred.mimeType || preferred.mime_type || 'video/mp4',
    };
  }

  // 回退到 durl 模式（视频+音频混合流）
  const durls = data.data.durl || [];
  if (durls.length > 0 && durls[0].url) {
    return {
      videoUrl: durls[0].url,
      audioUrl: '',
      mimeType: 'video/mp4',
    };
  }

  throw new Error('B站未返回可用视频流地址');
}

function getCacheKey(bvid: string, cid: number, type: string): string {
  return `${bvid}:${cid}:${type}`;
}

async function resolveStreamUrl(bvid: string, cid: number, type: 'video' | 'audio'): Promise<string> {
  const key = getCacheKey(bvid, cid, type);
  const cached = urlCache.get(key);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.url;
  }

  const result = await fetchBiliVideoStreamUrl(bvid, cid);
  const url = type === 'audio' ? result.audioUrl : result.videoUrl;

  if (url) {
    // 缓存视频和音频 URL
    urlCache.set(getCacheKey(bvid, cid, 'video'), {
      url: result.videoUrl,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
    if (result.audioUrl) {
      urlCache.set(getCacheKey(bvid, cid, 'audio'), {
        url: result.audioUrl,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
    }
  }

  return url;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const bvid = searchParams.get('bvid') || '';
  const cidStr = searchParams.get('cid') || '';
  const type = (searchParams.get('type') || 'audio') as 'video' | 'audio';

  if (!bvid) {
    return NextResponse.json({ error: 'Missing bvid parameter' }, { status: 400 });
  }

  let cid = Number.parseInt(cidStr, 10);

  try {
    // 如果没有 cid，先通过 viewMeta 获取
    if (!Number.isFinite(cid) || cid <= 0) {
      const meta = await fetchViewMeta(bvid, 1);
      cid = meta.cid;
    }

    const streamUrl = await resolveStreamUrl(bvid, cid, type);

    if (!streamUrl) {
      return NextResponse.json(
        { error: `No ${type} stream available` },
        { status: 404 }
      );
    }

    // 代理请求 B站 CDN（需要带 Referer 和 UA）
    const cookie = process.env.BILIBILI_COOKIE || '';
    const proxyHeaders: Record<string, string> = {
      Referer: BILIBILI_REFERER,
      'User-Agent': BILIBILI_USER_AGENT,
    };
    if (cookie) {
      proxyHeaders.Cookie = cookie;
    }

    // 支持 Range 请求（视频 seek 需要）
    const rangeHeader = request.headers.get('Range');
    if (rangeHeader) {
      proxyHeaders.Range = rangeHeader;
    }

    const cdnController = new AbortController();
    const cdnTimeout = setTimeout(() => cdnController.abort(), 30_000);
    let upstreamResponse: Response;
    try {
      upstreamResponse = await fetch(streamUrl, {
        headers: proxyHeaders,
        redirect: 'follow',
        signal: cdnController.signal,
      });
    } finally {
      clearTimeout(cdnTimeout);
    }

    if (!upstreamResponse.ok && upstreamResponse.status !== 206) {
      // CDN URL 可能已过期，清缓存重试
      urlCache.delete(getCacheKey(bvid, cid, type));
      const freshUrl = await resolveStreamUrl(bvid, cid, type);
      if (!freshUrl) {
        return NextResponse.json({ error: 'Stream URL expired' }, { status: 502 });
      }

      const retryController = new AbortController();
      const retryTimeout = setTimeout(() => retryController.abort(), 30_000);
      let retryResponse: Response;
      try {
        retryResponse = await fetch(freshUrl, {
          headers: proxyHeaders,
          redirect: 'follow',
          signal: retryController.signal,
        });
      } finally {
        clearTimeout(retryTimeout);
      }

      if (!retryResponse.ok && retryResponse.status !== 206) {
        return NextResponse.json(
          { error: `Upstream returned ${retryResponse.status}` },
          { status: 502 }
        );
      }

      return buildProxyResponse(retryResponse, type);
    }

    return buildProxyResponse(upstreamResponse, type);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    log.error(`[video/proxy] Failed for bvid=${bvid} cid=${cid} type=${type}: ${detail}`);
    return NextResponse.json(
      { error: 'Failed to proxy video stream', detail },
      { status: 500 }
    );
  }
}

function buildProxyResponse(upstream: Response, type: 'video' | 'audio'): Response {
  const headers = new Headers();

  // 转发关键头
  const contentType = upstream.headers.get('content-type');
  const contentLength = upstream.headers.get('content-length');
  const contentRange = upstream.headers.get('content-range');
  const acceptRanges = upstream.headers.get('accept-ranges');

  headers.set('Content-Type', contentType || (type === 'audio' ? 'audio/mp4' : 'video/mp4'));
  if (contentLength) headers.set('Content-Length', contentLength);
  if (contentRange) headers.set('Content-Range', contentRange);
  headers.set('Accept-Ranges', acceptRanges || 'bytes');

  // CORS
  headers.set('Access-Control-Allow-Origin', '*');

  // 缓存
  headers.set('Cache-Control', 'public, max-age=3600');

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}
