/**
 * Download utilities for the video import pipeline.
 *
 * Handles yt-dlp downloads, direct media file downloads, and audio preparation.
 * Extracted from route.ts to keep the route handler lean.
 */

import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import type { ReadableStream as WebReadableStream } from 'stream/web';
import {
  BILIBILI_REFERER,
  BILIBILI_USER_AGENT,
} from '@/lib/services/bilibili-import-service';
import {
  extFromContentType,
  resolveOutputPath,
  runCommand,
  safeUnlink,
  transcodeToMp3,
} from '@/lib/services/media-tooling';
import { type VideoImportMeta, ImportPipelineError } from './video-import-types';

// ---------------------------------------------------------------------------
// Environment-driven constants
// ---------------------------------------------------------------------------

const YTDLP_AVAILABILITY_TTL_MS = Number.parseInt(
  process.env.VIDEO_IMPORT_YTDLP_CACHE_MS || '300000',
  10,
);
const DIRECT_DOWNLOAD_TIMEOUT_MS = Number.parseInt(
  process.env.VIDEO_DIRECT_DOWNLOAD_TIMEOUT_MS || '120000',
  10,
);
const DIRECT_DOWNLOAD_MAX_BYTES = Number.parseInt(
  process.env.VIDEO_DIRECT_DOWNLOAD_MAX_BYTES || `${300 * 1024 * 1024}`,
  10,
);

// ---------------------------------------------------------------------------
// Module-level state (yt-dlp availability cache)
// ---------------------------------------------------------------------------

let ytDlpAvailabilityCache: { available: boolean; expiresAt: number } | null = null;

// ---------------------------------------------------------------------------
// yt-dlp utilities
// ---------------------------------------------------------------------------

function getYtDlpCommand(): string {
  return process.env.YT_DLP_BIN || 'yt-dlp';
}

async function runYtDlp(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const result = await runCommand(getYtDlpCommand(), args, { toolName: 'yt-dlp' });
  return {
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

export async function hasYtDlp(): Promise<boolean> {
  const now = Date.now();
  if (ytDlpAvailabilityCache && now < ytDlpAvailabilityCache.expiresAt) {
    return ytDlpAvailabilityCache.available;
  }

  let available = false;
  try {
    await runYtDlp(['--version']);
    available = true;
  } catch {
    available = false;
  }

  const ttlMs = Number.isFinite(YTDLP_AVAILABILITY_TTL_MS)
    ? Math.max(10000, Math.min(30 * 60 * 1000, YTDLP_AVAILABILITY_TTL_MS))
    : 300000;

  ytDlpAvailabilityCache = {
    available,
    expiresAt: now + ttlMs,
  };

  return available;
}

function parseYtDlpMetaFromStdout(stdout: string): VideoImportMeta {
  const lines = (stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line.startsWith('{') || !line.endsWith('}')) continue;
    try {
      const data = JSON.parse(line) as {
        title?: string;
        duration?: number;
        thumbnail?: string;
        webpage_url?: string;
      };
      return {
        title: typeof data.title === 'string' ? data.title : undefined,
        durationSec: Number.isFinite(data.duration) ? Number(data.duration) : undefined,
        thumbnailUrl: typeof data.thumbnail === 'string' ? data.thumbnail : undefined,
        resolvedUrl: typeof data.webpage_url === 'string' ? data.webpage_url : undefined,
      };
    } catch {
      // skip invalid json line
    }
  }

  return {};
}

async function findGeneratedAudioFile(uploadDir: string, baseName: string): Promise<string | null> {
  const files = await fsp.readdir(uploadDir);
  const matched = files
    .filter((name) => name.startsWith(baseName))
    .map((name) => path.join(uploadDir, name));

  if (matched.length === 0) return null;

  const withStat = await Promise.all(
    matched.map(async (filePath) => ({
      filePath,
      stat: await fsp.stat(filePath),
    })),
  );
  withStat.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
  return withStat[0].filePath;
}

export async function downloadAudioByYtDlp(
  videoUrl: string,
  baseName: string,
  uploadDir: string,
  options: { bilibiliHeaders?: boolean } = {},
): Promise<{ audioPath: string; meta: VideoImportMeta }> {
  const outputTemplate = path.join(uploadDir, `${baseName}.%(ext)s`);

  const args = [
    '--no-playlist',
    '--no-warnings',
    '--print-json',
    '--extract-audio',
    '--audio-format',
    'mp3',
    '--audio-quality',
    '0',
  ];

  if (options.bilibiliHeaders) {
    args.push('--add-header', `Referer: ${BILIBILI_REFERER}`);
    args.push('--add-header', `User-Agent: ${BILIBILI_USER_AGENT}`);
    if (process.env.BILIBILI_COOKIE) {
      args.push('--add-header', `Cookie: ${process.env.BILIBILI_COOKIE}`);
    }
  }

  args.push('--output', outputTemplate, videoUrl);

  const { stdout } = await runYtDlp(args);
  const meta = parseYtDlpMetaFromStdout(stdout);

  const audioPath = await findGeneratedAudioFile(uploadDir, baseName);
  if (!audioPath) {
    throw new ImportPipelineError('YTDLP_DOWNLOAD_FAILED', '已下载但未找到提取后的音频文件');
  }

  return { audioPath, meta };
}

// ---------------------------------------------------------------------------
// Direct file download
// ---------------------------------------------------------------------------

export async function downloadFile(url: string, targetPath: string): Promise<void> {
  const timeoutMs = Number.isFinite(DIRECT_DOWNLOAD_TIMEOUT_MS)
    ? Math.max(10000, Math.min(10 * 60 * 1000, DIRECT_DOWNLOAD_TIMEOUT_MS))
    : 120000;
  const maxBytes = Number.isFinite(DIRECT_DOWNLOAD_MAX_BYTES)
    ? Math.max(10 * 1024 * 1024, DIRECT_DOWNLOAD_MAX_BYTES)
    : 300 * 1024 * 1024;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
    });
  } catch (error) {
    if ((error as { name?: string })?.name === 'AbortError') {
      throw new ImportPipelineError('DIRECT_MEDIA_TIMEOUT', '直链媒体下载超时');
    }
    throw new ImportPipelineError(
      'DIRECT_MEDIA_DOWNLOAD_FAILED',
      '直链媒体下载失败',
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new ImportPipelineError('DIRECT_MEDIA_DOWNLOAD_FAILED', `下载失败 (${response.status})`);
  }

  const declaredLength = Number.parseInt(response.headers.get('content-length') || '0', 10);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new ImportPipelineError(
      'DIRECT_MEDIA_TOO_LARGE',
      '直链媒体文件过大',
      `content-length=${declaredLength}`,
    );
  }

  if (!response.body) {
    throw new ImportPipelineError('DIRECT_MEDIA_DOWNLOAD_FAILED', '下载失败：响应体为空');
  }

  let downloadedBytes = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      downloadedBytes += chunk.length;
      if (downloadedBytes > maxBytes) {
        callback(new ImportPipelineError('DIRECT_MEDIA_TOO_LARGE', '直链媒体文件过大'));
        return;
      }
      callback(null, chunk);
    },
  });

  await fsp.mkdir(path.dirname(targetPath), { recursive: true });
  try {
    await pipeline(
      Readable.fromWeb(response.body as unknown as WebReadableStream<Uint8Array>),
      limiter,
      fs.createWriteStream(targetPath),
    );
  } catch (error) {
    safeUnlink(targetPath);
    if (error instanceof ImportPipelineError) throw error;
    throw new ImportPipelineError(
      'DIRECT_MEDIA_DOWNLOAD_FAILED',
      '直链媒体下载失败',
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function prepareAudioFromDirectUrl(
  videoUrl: string,
  baseName: string,
  uploadDir: string,
): Promise<string> {
  const parsed = new URL(videoUrl);
  const rawExt = extFromContentType(null) || '.bin';
  const ext = path.extname(parsed.pathname).toLowerCase() || rawExt;
  const downloadedPath = resolveOutputPath(uploadDir, `${baseName}_raw`, ext);
  const mp3Path = resolveOutputPath(uploadDir, baseName, '.mp3');

  try {
    await downloadFile(videoUrl, downloadedPath);
    await transcodeToMp3(downloadedPath, mp3Path);
    return mp3Path;
  } catch (error) {
    safeUnlink(mp3Path);
    throw error;
  } finally {
    safeUnlink(downloadedPath);
  }
}
