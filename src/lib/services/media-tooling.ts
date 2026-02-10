import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface CommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface PublicBaseUrlResult {
  ok: boolean;
  baseUrl?: string;
  error?: string;
}

export class MediaToolError extends Error {
  code: string;
  detail?: string;

  constructor(code: string, message: string, detail?: string) {
    super(message);
    this.name = 'MediaToolError';
    this.code = code;
    this.detail = detail;
  }
}

function normalizeCodePrefix(toolName: string): string {
  return toolName.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

function sanitizeHost(host: string): string {
  return host.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

export function resolvePublicBaseUrl(): PublicBaseUrlResult {
  const hostValue = (process.env.PUBLIC_DOMAIN || process.env.PUBLIC_HOST || '').trim();
  if (!hostValue) {
    return {
      ok: false,
      error: 'PUBLIC_DOMAIN 或 PUBLIC_HOST 未配置',
    };
  }

  const protocolValue = (process.env.PUBLIC_PROTOCOL || 'https').trim().toLowerCase();
  const protocol = protocolValue === 'http' || protocolValue === 'https' ? protocolValue : 'https';
  const host = sanitizeHost(hostValue);

  if (!host) {
    return {
      ok: false,
      error: 'PUBLIC_DOMAIN 或 PUBLIC_HOST 格式无效',
    };
  }

  return {
    ok: true,
    baseUrl: `${protocol}://${host}`,
  };
}

export function resolveFfmpegPath(): string {
  const envPath = (process.env.FFMPEG_BIN || '').trim();
  if (envPath) {
    return envPath;
  }

  // 优先使用系统安装的 ffmpeg（更稳定），ffmpeg-static 包可能二进制不兼容
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { execFileSync } = require('child_process');
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore', timeout: 3000 });
    return 'ffmpeg';
  } catch {
    // 系统 ffmpeg 不可用，尝试 ffmpeg-static
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ffmpegStatic = require('ffmpeg-static') as string | null;
    if (ffmpegStatic && fs.existsSync(ffmpegStatic)) {
      return ffmpegStatic;
    }
  } catch {
    // ignore optional dependency resolution errors
  }

  const localCandidates = [
    path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg.exe'),
    path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg'),
  ];

  for (const candidate of localCandidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return 'ffmpeg';
}

export function resolveFfprobePath(ffmpegPath: string): string {
  const envPath = (process.env.FFPROBE_BIN || '').trim();
  if (envPath) {
    return envPath;
  }

  if (/ffmpeg(\.exe)?$/i.test(ffmpegPath)) {
    const ffprobePath = ffmpegPath.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1');
    if (fs.existsSync(ffprobePath)) {
      return ffprobePath;
    }
  }

  return 'ffprobe';
}

export async function runCommand(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    toolName?: string;
  } = {}
): Promise<CommandResult> {
  const toolName = options.toolName || 'command';
  const codePrefix = normalizeCodePrefix(toolName);

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      cwd: options.cwd,
      // 限制子进程内存，防止 OOM killer 杀掉主进程
      ...(options.toolName === 'ffmpeg' ? { env: { ...process.env, MALLOC_ARENA_MAX: '2' } } : {}),
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        reject(
          new MediaToolError(
            `${codePrefix}_NOT_FOUND`,
            `${toolName} 不存在或不可执行`,
            error.message
          )
        );
        return;
      }

      reject(
        new MediaToolError(
          `${codePrefix}_EXEC_ERROR`,
          `${toolName} 执行异常`,
          error.message
        )
      );
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr, code: 0 });
        return;
      }

      reject(
        new MediaToolError(
          `${codePrefix}_FAILED`,
          `${toolName} 执行失败`,
          (stderr || stdout || `${toolName} exited with code ${code}`).trim()
        )
      );
    });
  });
}

export async function transcodeToMp3(inputPath: string, outputPath: string): Promise<void> {
  const ffmpegPath = resolveFfmpegPath();
  await runCommand(
    ffmpegPath,
    [
      '-y',
      '-threads', '1',           // 限制线程数，减少内存占用
      '-i', inputPath,
      '-ar', '16000',
      '-ac', '1',
      '-b:a', '64k',
      '-max_muxing_queue_size', '128',  // 限制 muxing 缓冲区
      outputPath,
    ],
    { toolName: 'ffmpeg' }
  );
}

export function isToolNotFoundError(error: unknown, toolName?: string): boolean {
  if (!(error instanceof MediaToolError)) return false;

  if (toolName) {
    const prefix = normalizeCodePrefix(toolName);
    return error.code === `${prefix}_NOT_FOUND`;
  }

  return error.code.endsWith('_NOT_FOUND');
}

export function safeUnlink(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // ignore cleanup failures
  }
}

export function extFromContentType(contentType: string | null | undefined): string {
  const normalized = (contentType || '').toLowerCase();
  if (normalized.includes('mpeg')) return '.mp3';
  if (normalized.includes('mp4')) return '.m4a';
  if (normalized.includes('aac')) return '.aac';
  if (normalized.includes('ogg')) return '.ogg';
  if (normalized.includes('wav')) return '.wav';
  if (normalized.includes('flac')) return '.flac';
  return '.bin';
}

export function normalizeFileExt(value: string): string {
  if (!value) return '.bin';
  if (value.startsWith('.')) return value.toLowerCase();
  return `.${value.toLowerCase()}`;
}

export function resolveOutputPath(baseDir: string, baseName: string, ext: string): string {
  return path.join(baseDir, `${baseName}${normalizeFileExt(ext)}`);
}
