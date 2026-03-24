/**
 * 小宇宙播客导入服务
 *
 * 实现流程：
 * 1. 抓取小宇宙 episode 页面 HTML
 * 2. 从 __NEXT_DATA__ JSON 中解析播客元数据
 * 3. 提取 enclosure.url（m4a 音频地址）
 * 4. 下载音频文件
 *
 * 小宇宙页面是 Next.js SSR，__NEXT_DATA__ 包含完整 episode 数据。
 */

import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import type { ReadableStream as WebReadableStream } from 'stream/web';

const XIAOYUZHOU_FETCH_TIMEOUT_MS = Number.parseInt(
  process.env.XIAOYUZHOU_FETCH_TIMEOUT_MS || '15000',
  10
);
const XIAOYUZHOU_AUDIO_DOWNLOAD_TIMEOUT_MS = Number.parseInt(
  process.env.XIAOYUZHOU_AUDIO_DOWNLOAD_TIMEOUT_MS || '600000',
  10
);
const XIAOYUZHOU_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

export class XiaoyuzhouImportError extends Error {
  code: string;
  detail?: string;

  constructor(code: string, message: string, detail?: string) {
    super(message);
    this.name = 'XiaoyuzhouImportError';
    this.code = code;
    this.detail = detail;
  }
}

export interface XiaoyuzhouEpisodeMeta {
  title: string;
  podcastTitle?: string;
  description?: string;
  durationSec: number;
  audioUrl: string;
  coverUrl?: string;
  episodeUrl: string;
}

/**
 * 从 __NEXT_DATA__ JSON 中解析 episode 数据。
 *
 * 小宇宙页面结构（验证过）：
 * - pageProps.episode.title
 * - pageProps.episode.duration（秒）
 * - pageProps.episode.enclosure.url（音频 m4a 地址）
 * - pageProps.episode.podcast.title
 * - pageProps.episode.description
 * - pageProps.episode.image.picUrl（封面）
 */
function parseNextDataEpisode(
  nextDataJson: string,
  episodeUrl: string
): XiaoyuzhouEpisodeMeta {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(nextDataJson);
  } catch {
    throw new XiaoyuzhouImportError(
      'XIAOYUZHOU_PARSE_FAILED',
      '小宇宙页面数据解析失败',
      'Invalid __NEXT_DATA__ JSON'
    );
  }

  const props = parsed.props as Record<string, unknown> | undefined;
  const pageProps = props?.pageProps as Record<string, unknown> | undefined;
  const episode = pageProps?.episode as Record<string, unknown> | undefined;

  if (!episode) {
    throw new XiaoyuzhouImportError(
      'XIAOYUZHOU_PARSE_FAILED',
      '小宇宙页面中未找到 episode 数据',
      `keys: ${Object.keys(pageProps || {}).join(', ')}`
    );
  }

  const enclosure = episode.enclosure as Record<string, unknown> | undefined;
  const audioUrl = (enclosure?.url as string) || '';
  if (!audioUrl) {
    throw new XiaoyuzhouImportError(
      'XIAOYUZHOU_NO_AUDIO',
      '小宇宙 episode 中未找到音频地址',
      `enclosure: ${JSON.stringify(enclosure || {}).slice(0, 200)}`
    );
  }

  const title = (episode.title as string) || '未知标题';
  const duration = Number(episode.duration);
  const durationSec = Number.isFinite(duration) && duration > 0 ? duration : 0;

  const podcast = episode.podcast as Record<string, unknown> | undefined;
  const podcastTitle = (podcast?.title as string) || undefined;

  const description = (episode.description as string) || undefined;

  const image = episode.image as Record<string, unknown> | undefined;
  const coverUrl =
    (image?.picUrl as string) ||
    (image?.largePicUrl as string) ||
    (episode.coverUrl as string) ||
    undefined;

  return {
    title,
    podcastTitle,
    description,
    durationSec,
    audioUrl,
    coverUrl,
    episodeUrl,
  };
}

/**
 * 抓取小宇宙 episode 页面，解析 __NEXT_DATA__ 获取元数据和音频地址。
 */
export async function fetchXiaoyuzhouEpisode(
  episodeUrl: string
): Promise<XiaoyuzhouEpisodeMeta> {
  const timeoutMs = Number.isFinite(XIAOYUZHOU_FETCH_TIMEOUT_MS)
    ? Math.max(5000, Math.min(30000, XIAOYUZHOU_FETCH_TIMEOUT_MS))
    : 15000;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let html: string;
  try {
    const response = await fetch(episodeUrl, {
      headers: {
        'User-Agent': XIAOYUZHOU_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      redirect: 'follow',
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new XiaoyuzhouImportError(
        'XIAOYUZHOU_FETCH_FAILED',
        `小宇宙页面请求失败 (${response.status})`,
        `url: ${episodeUrl}`
      );
    }

    html = await response.text();
  } catch (error) {
    if (error instanceof XiaoyuzhouImportError) throw error;
    if ((error as { name?: string })?.name === 'AbortError') {
      throw new XiaoyuzhouImportError(
        'XIAOYUZHOU_FETCH_TIMEOUT',
        '小宇宙页面请求超时',
        `timeout: ${timeoutMs}ms`
      );
    }
    throw new XiaoyuzhouImportError(
      'XIAOYUZHOU_FETCH_FAILED',
      '小宇宙页面请求失败',
      error instanceof Error ? error.message : String(error)
    );
  } finally {
    clearTimeout(timeoutId);
  }

  // 提取 <script id="__NEXT_DATA__" type="application/json">...</script>
  const nextDataMatch = html.match(
    /<script\s+id="__NEXT_DATA__"\s+type="application\/json"[^>]*>([\s\S]*?)<\/script>/
  );

  if (!nextDataMatch?.[1]) {
    throw new XiaoyuzhouImportError(
      'XIAOYUZHOU_PARSE_FAILED',
      '小宇宙页面中未找到 __NEXT_DATA__',
      `html length: ${html.length}`
    );
  }

  return parseNextDataEpisode(nextDataMatch[1], episodeUrl);
}

/**
 * 下载小宇宙音频文件（m4a）到指定路径。
 */
export async function downloadXiaoyuzhouAudio(
  audioUrl: string,
  outputPath: string
): Promise<{ outputPath: string; contentType: string }> {
  const downloadTimeoutMs = Number.isFinite(XIAOYUZHOU_AUDIO_DOWNLOAD_TIMEOUT_MS)
    ? Math.max(30000, Math.min(30 * 60 * 1000, XIAOYUZHOU_AUDIO_DOWNLOAD_TIMEOUT_MS))
    : 600000;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), downloadTimeoutMs);

  try {
    const response = await fetch(audioUrl, {
      headers: {
        'User-Agent': XIAOYUZHOU_USER_AGENT,
        Accept: '*/*',
      },
      redirect: 'follow',
      signal: controller.signal,
    });

    if (!response.ok || !response.body) {
      throw new XiaoyuzhouImportError(
        'XIAOYUZHOU_AUDIO_DOWNLOAD_FAILED',
        `小宇宙音频下载失败 (${response.status})`,
        `url: ${audioUrl}`
      );
    }

    const contentType = response.headers.get('content-type') || 'audio/mp4';

    await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
    const writable = fs.createWriteStream(outputPath);
    await pipeline(
      Readable.fromWeb(response.body as unknown as WebReadableStream<Uint8Array>),
      writable
    );

    return { outputPath, contentType };
  } catch (error) {
    if (error instanceof XiaoyuzhouImportError) throw error;
    if ((error as { name?: string })?.name === 'AbortError') {
      throw new XiaoyuzhouImportError(
        'XIAOYUZHOU_AUDIO_DOWNLOAD_TIMEOUT',
        '小宇宙音频下载超时',
        `timeout: ${downloadTimeoutMs}ms`
      );
    }
    throw new XiaoyuzhouImportError(
      'XIAOYUZHOU_AUDIO_DOWNLOAD_FAILED',
      '小宇宙音频下载失败',
      error instanceof Error ? error.message : String(error)
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
