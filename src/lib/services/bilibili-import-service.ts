import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import type { ReadableStream as WebReadableStream } from 'stream/web';
import { extFromContentType } from './media-tooling';

export const BILIBILI_REFERER = 'https://www.bilibili.com/';
export const BILIBILI_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const BILI_FETCH_TIMEOUT_MS = Number.parseInt(process.env.BILI_FETCH_TIMEOUT_MS || '12000', 10);
const BILI_FETCH_MAX_RETRIES = Number.parseInt(process.env.BILI_FETCH_MAX_RETRIES || '2', 10);
const BILI_AUDIO_DOWNLOAD_TIMEOUT_MS = Number.parseInt(process.env.BILI_AUDIO_DOWNLOAD_TIMEOUT_MS || '600000', 10); // 10 min for large audio

export type BilibiliSourceMode = 'bili-native' | 'bili-subtitle';

export interface BilibiliImportErrorShape {
  code: string;
  detail?: string;
}

export class BilibiliImportError extends Error {
  code: string;
  detail?: string;

  constructor(code: string, message: string, detail?: string) {
    super(message);
    this.name = 'BilibiliImportError';
    this.code = code;
    this.detail = detail;
  }
}

export interface BilibiliResolvedUrl {
  originalUrl: string;
  resolvedUrl: string;
  bvid: string;
  page: number;
  embedUrl: string;
}

export interface BilibiliViewMeta {
  bvid: string;
  cid: number;
  page: number;
  title?: string;
  durationSec?: number;
  thumbnailUrl?: string;
  resolvedUrl: string;
  embedUrl: string;
}

export interface BilibiliSubtitleResult {
  subtitleUrl: string;
  language?: string;
  segments: Array<{ text: string; startMs: number; endMs: number }>;
}

export interface BilibiliAudioResult {
  audioUrl: string;
  mode: 'dash' | 'durl';
  ext: string;
}

interface BiliJsonResponse<T> {
  code: number;
  message?: string;
  data?: T;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  context: string
): Promise<Response> {
  const retries = Number.isFinite(BILI_FETCH_MAX_RETRIES)
    ? Math.min(3, Math.max(0, BILI_FETCH_MAX_RETRIES))
    : 2;
  const timeoutMs = Number.isFinite(BILI_FETCH_TIMEOUT_MS)
    ? Math.min(30000, Math.max(3000, BILI_FETCH_TIMEOUT_MS))
    : 12000;

  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });

      if (!isRetryableStatus(response.status) || attempt >= retries) {
        return response;
      }

      // 消费 body，避免连接泄漏
      await response.arrayBuffer().catch(() => undefined);
    } catch (error) {
      lastError = error;
      if (attempt >= retries) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new BilibiliImportError('BILI_NETWORK_ERROR', `${context} 请求失败`, detail);
      }
    } finally {
      clearTimeout(timeoutId);
    }

    await sleep((attempt + 1) * 400);
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError || 'unknown');
  throw new BilibiliImportError('BILI_NETWORK_ERROR', `${context} 请求失败`, detail);
}

function getCommonHeaders(extraHeaders?: Record<string, string>): HeadersInit {
  const headers: Record<string, string> = {
    Referer: BILIBILI_REFERER,
    'User-Agent': BILIBILI_USER_AGENT,
  };

  // 自动携带 Cookie，让所有 B 站 API 请求都有登录态
  const cookie = process.env.BILIBILI_COOKIE;
  if (cookie) {
    headers.Cookie = cookie;
  }

  if (extraHeaders) {
    for (const [key, value] of Object.entries(extraHeaders)) {
      if (value) headers[key] = value;
    }
  }

  return headers;
}

function normalizeSubtitleUrl(urlValue: string): string {
  if (urlValue.startsWith('//')) return `https:${urlValue}`;
  if (urlValue.startsWith('/')) return `https://api.bilibili.com${urlValue}`;
  return urlValue;
}

function extractBvid(value: string): string | null {
  const match = value.match(/BV[0-9A-Za-z]{10}/);
  return match?.[0] || null;
}

function parsePage(url: URL): number {
  const raw = Number.parseInt(url.searchParams.get('p') || '1', 10);
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return raw;
}

async function fetchBiliJson<T>(url: string, extraHeaders?: Record<string, string>): Promise<T> {
  const response = await fetchWithRetry(
    url,
    {
      headers: getCommonHeaders(extraHeaders),
      redirect: 'follow',
    },
    'B站接口'
  );

  const text = await response.text();
  let parsed: BiliJsonResponse<T> | null = null;

  try {
    parsed = JSON.parse(text) as BiliJsonResponse<T>;
  } catch {
    throw new BilibiliImportError('BILI_RESPONSE_INVALID', 'B站返回格式异常', text.slice(0, 400));
  }

  if (!response.ok) {
    throw new BilibiliImportError('BILI_HTTP_ERROR', `B站接口请求失败 (${response.status})`, text.slice(0, 400));
  }

  if (parsed.code !== 0 || !parsed.data) {
    const detail = `${parsed.code}: ${parsed.message || 'unknown'}`;
    const hasCookie = Boolean(process.env.BILIBILI_COOKIE);
    if (hasCookie && (parsed.code === -352 || /登录|cookie|风控|拦截|412/i.test(parsed.message || ''))) {
      throw new BilibiliImportError('BILI_COOKIE_EXPIRED', 'B站登录状态已过期，请更新 Cookie', detail);
    }
    throw new BilibiliImportError(
      'BILI_API_ERROR',
      'B站接口返回错误',
      detail
    );
  }

  return parsed.data;
}

async function resolveShortUrl(rawUrl: string): Promise<string> {
  const parsed = new URL(rawUrl);
  if (parsed.hostname !== 'b23.tv') return rawUrl;

  const response = await fetchWithRetry(
    rawUrl,
    {
      method: 'GET',
      redirect: 'follow',
      headers: getCommonHeaders(),
    },
    'B站短链解析'
  );

  return response.url || rawUrl;
}

export async function resolveBilibiliUrl(rawUrl: string): Promise<BilibiliResolvedUrl> {
  const resolvedUrl = await resolveShortUrl(rawUrl.trim());

  let parsed: URL;
  try {
    parsed = new URL(resolvedUrl);
  } catch {
    throw new BilibiliImportError('BILI_URL_PARSE_FAILED', '无法解析 B站链接');
  }

  const bvid = extractBvid(`${parsed.pathname}${parsed.search}${parsed.hash}`) || extractBvid(resolvedUrl);
  if (!bvid) {
    throw new BilibiliImportError('BILI_URL_PARSE_FAILED', '无法从链接提取 BV 号');
  }

  const page = parsePage(parsed);

  return {
    originalUrl: rawUrl,
    resolvedUrl,
    bvid,
    page,
    embedUrl: `https://player.bilibili.com/player.html?bvid=${encodeURIComponent(bvid)}&page=${page}`,
  };
}

export async function fetchViewMeta(bvid: string, page: number): Promise<BilibiliViewMeta> {
  type PageItem = { page: number; cid: number; duration?: number; part?: string };
  type ViewData = {
    title?: string;
    duration?: number;
    pic?: string;
    cid?: number;
    pages?: PageItem[];
  };

  const data = await fetchBiliJson<ViewData>(
    `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`
  );

  const pages = Array.isArray(data.pages) ? data.pages : [];
  const pageItem = pages.find((item) => item.page === page) || pages[Math.max(0, page - 1)] || pages[0];
  const cid = pageItem?.cid || data.cid;

  if (!cid || !Number.isFinite(cid)) {
    throw new BilibiliImportError('BILI_VIEW_META_FAILED', 'B站视频缺少可用 cid');
  }

  // 多分 P 视频：优先使用分 P 自身的 duration，合集 data.duration 是所有分 P 之和
  const pageDuration = pageItem?.duration;
  const effectiveDuration = Number.isFinite(pageDuration) && pageDuration! > 0
    ? pageDuration!
    : (Number.isFinite(data.duration) ? Number(data.duration) : undefined);

  // 多分 P 视频：标题拼接 — "合集名 - 分 P 名"
  const baseTitle = typeof data.title === 'string' ? data.title : undefined;
  const partName = pageItem?.part && typeof pageItem.part === 'string' ? pageItem.part : undefined;
  const isMultiPage = pages.length > 1;
  const title = isMultiPage && baseTitle && partName
    ? `${baseTitle} - ${partName}`
    : baseTitle;

  return {
    bvid,
    cid,
    page,
    title,
    durationSec: effectiveDuration,
    thumbnailUrl: typeof data.pic === 'string' ? data.pic.replace(/^http:\/\//i, 'https://') : undefined,
    resolvedUrl: `https://www.bilibili.com/video/${bvid}?p=${page}`,
    embedUrl: `https://player.bilibili.com/player.html?bvid=${encodeURIComponent(bvid)}&page=${page}`,
  };
}

export async function fetchPlayerSubtitle(bvid: string, cid: number): Promise<BilibiliSubtitleResult | null> {
  type SubtitleItem = { lan?: string; subtitle_url?: string };
  type PlayerData = { subtitle?: { subtitles?: SubtitleItem[] } };

  const data = await fetchBiliJson<PlayerData>(
    `https://api.bilibili.com/x/player/v2?bvid=${encodeURIComponent(bvid)}&cid=${cid}`
  );

  const subtitles = data.subtitle?.subtitles;
  if (!Array.isArray(subtitles) || subtitles.length === 0) return null;

  const preferred = subtitles.find((item) => (item.lan || '').startsWith('zh')) || subtitles[0];
  if (!preferred?.subtitle_url) return null;

  const subtitleUrl = normalizeSubtitleUrl(preferred.subtitle_url);
  const subtitleResponse = await fetchWithRetry(
    subtitleUrl,
    {
      headers: getCommonHeaders(),
    },
    'B站字幕下载'
  );

  if (!subtitleResponse.ok) {
    throw new BilibiliImportError(
      'BILI_SUBTITLE_FETCH_FAILED',
      '官方字幕下载失败',
      `${subtitleResponse.status}`
    );
  }

  const subtitleJson = (await subtitleResponse.json()) as {
    body?: Array<{ from?: number; to?: number; content?: string }>;
  };

  const body = Array.isArray(subtitleJson.body) ? subtitleJson.body : [];
  const segments = body
    .map((item) => ({
      text: String(item.content || '').trim(),
      startMs: Math.max(0, Math.round((item.from || 0) * 1000)),
      endMs: Math.max(0, Math.round((item.to || 0) * 1000)),
    }))
    .filter((item) => item.text && item.endMs > item.startMs);

  if (segments.length === 0) return null;

  return {
    subtitleUrl,
    language: preferred.lan,
    segments,
  };
}

function inferExtFromAudioUrl(audioUrl: string): string {
  const clean = audioUrl.split('?')[0] || '';
  const ext = path.extname(clean).toLowerCase();
  return ext || '.m4s';
}

export async function fetchPlayurlAudio(bvid: string, cid: number): Promise<BilibiliAudioResult> {
  type DashAudioItem = {
    baseUrl?: string;
    base_url?: string;
    bandwidth?: number;
    codecs?: string;
  };

  type PlayurlData = {
    dash?: { audio?: DashAudioItem[] };
    durl?: Array<{ url?: string }>;
  };

  const dashData = await fetchBiliJson<PlayurlData>(
    `https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(bvid)}&cid=${cid}&fnval=16&qn=64&fourk=1`
  );

  const dashAudio = Array.isArray(dashData.dash?.audio) ? dashData.dash.audio : [];
  if (dashAudio.length > 0) {
    // 选最低码率音频：ASR 只需语音内容，低码率省带宽、省内存、减少 OOM 风险
    const sorted = [...dashAudio].sort((a, b) => (a.bandwidth || 0) - (b.bandwidth || 0));
    const selected = sorted[0];
    const audioUrl = selected.baseUrl || selected.base_url;
    if (audioUrl) {
      return {
        audioUrl,
        mode: 'dash',
        ext: inferExtFromAudioUrl(audioUrl),
      };
    }
  }

  const durlData = await fetchBiliJson<PlayurlData>(
    `https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(bvid)}&cid=${cid}&fnval=0&qn=64&fourk=1`
  );

  const durl = Array.isArray(durlData.durl) ? durlData.durl : [];
  const audioUrl = durl[0]?.url;

  if (!audioUrl) {
    throw new BilibiliImportError('BILI_PLAYURL_FAILED', 'B站未返回可用音频地址');
  }

  return {
    audioUrl,
    mode: 'durl',
    ext: inferExtFromAudioUrl(audioUrl),
  };
}

export async function downloadBiliAudio(
  audioUrl: string,
  outputPath: string,
  options: {
    cookie?: string;
    extraHeaders?: Record<string, string>;
  } = {}
): Promise<{ outputPath: string; ext: string }> {
  const headers: Record<string, string> = {
    Referer: BILIBILI_REFERER,
    'User-Agent': BILIBILI_USER_AGENT,
    ...(options.extraHeaders || {}),
  };

  if (options.cookie) {
    headers.Cookie = options.cookie;
  } else if (process.env.BILIBILI_COOKIE) {
    headers.Cookie = process.env.BILIBILI_COOKIE;
  }

  const controller = new AbortController();
  const downloadTimeout = setTimeout(() => controller.abort(), BILI_AUDIO_DOWNLOAD_TIMEOUT_MS);

  try {
    const response = await fetchWithRetry(
      audioUrl,
      {
        headers,
        redirect: 'follow',
        signal: controller.signal,
      },
      'B站音频下载'
    );

    const hasCookie = Boolean(options.cookie || process.env.BILIBILI_COOKIE);
    if (response.status === 401 || response.status === 403 || response.status === 412) {
      if (hasCookie) {
        throw new BilibiliImportError(
          'BILI_COOKIE_EXPIRED',
          'B站登录状态已过期，请更新 Cookie',
          `HTTP ${response.status}`
        );
      }
      throw new BilibiliImportError(
        'BILI_AUDIO_DOWNLOAD_FORBIDDEN',
        'B站音频下载被拒绝',
        `HTTP ${response.status}`
      );
    }

    if (!response.ok || !response.body) {
      throw new BilibiliImportError(
        'BILI_AUDIO_DOWNLOAD_FAILED',
        'B站音频下载失败',
        `HTTP ${response.status}`
      );
    }

    await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
    const writable = fs.createWriteStream(outputPath);
    await pipeline(
      Readable.fromWeb(response.body as unknown as WebReadableStream<Uint8Array>),
      writable
    );

    return {
      outputPath,
      ext: extFromContentType(response.headers.get('content-type')),
    };
  } finally {
    clearTimeout(downloadTimeout);
  }
}

export function normalizeBiliAudioExt(rawExt: string): string {
  if (!rawExt) return '.m4s';
  const ext = rawExt.startsWith('.') ? rawExt.toLowerCase() : `.${rawExt.toLowerCase()}`;
  return ext;
}
