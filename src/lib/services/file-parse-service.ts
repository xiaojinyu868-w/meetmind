/**
 * file-parse-service — 把一个 File 解析成纯文本，给「聊聊你想要的」/ 全局对话注入 context 用。
 *
 * 职责（**只做这一件事**）：
 *   File（pdf / docx / ppt / 图片 / 音视频 / 纯文本） → { text, title, kind }
 *
 * 不做的事（避免把这个 helper 变成第二个 useSourceImport）：
 *   ✗ 不写 IndexedDB
 *   ✗ 不动 collection / workspace
 *   ✗ 不做去重 / 缓存 / 历史记录
 *   ✗ 不和 SourceItem 模型耦合
 *
 * 内部按 MIME / 后缀分流到现有 API：
 *   · 文档（pdf/docx/ppt/pptx）+ 纯文本（txt/md/csv/json/html） → /api/sources/ingest
 *   · 图片（png/jpg/webp/gif/bmp/heic/heif）                  → /api/sources/ingest-image
 *   · 音频（mp3/wav/m4a/ogg） + 视频（mp4/webm/mov）           → /api/transcribe
 *
 * 调用方负责：
 *   · 鉴权（带 Authorization: Bearer <token> header，下面参数可传）
 *   · 文件大小预检（这里只兜底报错，不挡）
 *   · 错误对用户的展示
 */

import type { TranscriptSegment } from '@/types';

export type FileParseKind = 'document' | 'text' | 'image' | 'audio' | 'video';

export interface FileParseResult {
  /** 解析后的纯文本（已经合并 segments / sentences），保证非空字符串。 */
  text: string;
  /** 文件展示标题（去掉扩展名） */
  title: string;
  /** 内部分类，用于 UI 展示 / 调用方判断要不要继续走特定路径 */
  kind: FileParseKind;
  /** 字符数（前端可用来做"太大了，截断到前 N 字"提示） */
  characterCount: number;
}

export interface FileParseError extends Error {
  code?: string;
}

const DOC_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'csv',
  'json',
  'html',
  'htm',
  'pdf',
  'docx',
  'ppt',
  'pptx',
]);
const IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'bmp',
  'heic',
  'heif',
]);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'opus']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi']);

function getExtension(name: string): string {
  const idx = name.lastIndexOf('.');
  if (idx <= 0) return '';
  return name.slice(idx + 1).toLowerCase();
}

function trimTitle(file: File): string {
  return file.name.replace(/\.[^.]+$/, '').trim() || '上传内容';
}

function classify(file: File): FileParseKind | null {
  const ext = getExtension(file.name);
  if (DOC_EXTENSIONS.has(ext)) {
    return ext === 'txt' || ext === 'md' || ext === 'markdown' || ext === 'csv' || ext === 'json' || ext === 'html' || ext === 'htm'
      ? 'text'
      : 'document';
  }
  if (IMAGE_EXTENSIONS.has(ext) || file.type.startsWith('image/')) {
    return 'image';
  }
  if (AUDIO_EXTENSIONS.has(ext) || file.type.startsWith('audio/')) {
    return 'audio';
  }
  if (VIDEO_EXTENSIONS.has(ext) || file.type.startsWith('video/')) {
    return 'video';
  }
  return null;
}

function buildHeaders(authToken?: string): Record<string, string> {
  if (!authToken) return {};
  return { Authorization: `Bearer ${authToken}` };
}

function makeError(message: string, code?: string): FileParseError {
  const err = new Error(message) as FileParseError;
  if (code) err.code = code;
  return err;
}

async function readJsonSafe(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const raw = await response.text();
    if (!raw.trim()) return null;
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function joinSegmentsText(segments: TranscriptSegment[] | undefined): string {
  if (!segments || segments.length === 0) return '';
  return segments
    .map((s) => (s.text || '').trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * 把 ingest-style 响应 (`{ success, segments }`) 转成纯文本。
 */
function extractDocumentText(data: Record<string, unknown> | null): string {
  if (!data) return '';
  if (Array.isArray(data.segments)) {
    return joinSegmentsText(data.segments as TranscriptSegment[]);
  }
  return '';
}

async function parseDocument(file: File, headers: Record<string, string>): Promise<FileParseResult> {
  const formData = new FormData();
  formData.append('file', file, file.name);
  const response = await fetch('/api/sources/ingest', {
    method: 'POST',
    headers, // 不要手动设 Content-Type，浏览器会带 boundary
    body: formData,
  });
  const data = await readJsonSafe(response);
  if (!response.ok || !data || data.success !== true) {
    const message = (data?.error as string) || `文档解析失败（${response.status}）`;
    throw makeError(message, (data?.code as string) || 'DOC_INGEST_FAILED');
  }
  const text = extractDocumentText(data);
  if (!text) throw makeError('没有从这份文件里识别到可用内容', 'EMPTY_TEXT');
  const title = (data.title as string)?.trim() || trimTitle(file);
  return { text, title, kind: 'document', characterCount: text.length };
}

async function parseImage(file: File, headers: Record<string, string>): Promise<FileParseResult> {
  const formData = new FormData();
  formData.append('file', file, file.name);
  const response = await fetch('/api/sources/ingest-image', {
    method: 'POST',
    headers,
    body: formData,
  });
  const data = await readJsonSafe(response);
  if (!response.ok || !data || data.success !== true) {
    const message = (data?.error as string) || `图片解析失败（${response.status}）`;
    throw makeError(message, (data?.code as string) || 'IMAGE_INGEST_FAILED');
  }
  const text = extractDocumentText(data);
  if (!text) throw makeError('没有从这张图片里识别到可用内容', 'EMPTY_TEXT');
  const title = (data.title as string)?.trim() || trimTitle(file);
  return { text, title, kind: 'image', characterCount: text.length };
}

async function parseAudioOrVideo(
  file: File,
  kind: 'audio' | 'video',
  headers: Record<string, string>,
): Promise<FileParseResult> {
  const formData = new FormData();
  formData.append('audio', file, file.name);
  formData.append('language', 'auto');
  const response = await fetch('/api/transcribe', {
    method: 'POST',
    headers,
    body: formData,
  });
  const data = await readJsonSafe(response);
  if (!response.ok || !data || data.success !== true) {
    const message = (data?.error as string) || `音频转写失败（${response.status}）`;
    throw makeError(message, (data?.code as string) || 'TRANSCRIBE_FAILED');
  }
  const text =
    (typeof data.text === 'string' && data.text.trim())
      ? (data.text as string).trim()
      : Array.isArray(data.sentences)
        ? (data.sentences as Array<{ text?: string }>).map((s) => s.text?.trim() || '').filter(Boolean).join('\n')
        : '';
  if (!text) throw makeError('音频里没有识别到内容', 'EMPTY_TEXT');
  const title = trimTitle(file);
  return { text, title, kind, characterCount: text.length };
}

/**
 * 解析一个 File 成纯文本。失败抛出 FileParseError（带 code 字段）。
 *
 * 用法：
 * ```ts
 * try {
 *   const result = await parseFileForChat(file, { authToken });
 *   // result.text 注入到对话 context.supportMaterials
 * } catch (err) {
 *   const message = err instanceof Error ? err.message : '解析失败';
 *   showToast(message);
 * }
 * ```
 */
export async function parseFileForChat(
  file: File,
  options: { authToken?: string; maxBytes?: number } = {},
): Promise<FileParseResult> {
  const maxBytes = options.maxBytes ?? 50 * 1024 * 1024; // 50MB 兜底，具体文件类型 API 会再 check
  if (file.size <= 0) throw makeError('上传文件为空', 'FILE_EMPTY');
  if (file.size > maxBytes) throw makeError('文件过大', 'FILE_TOO_LARGE');

  const kind = classify(file);
  if (!kind) {
    throw makeError(
      '暂不支持这种文件。常见格式：pdf / docx / ppt / 图片 / 音频 / 视频 / 纯文本',
      'FILE_UNSUPPORTED',
    );
  }

  const headers = buildHeaders(options.authToken);

  switch (kind) {
    case 'document':
    case 'text':
      return parseDocument(file, headers);
    case 'image':
      return parseImage(file, headers);
    case 'audio':
    case 'video':
      return parseAudioOrVideo(file, kind, headers);
  }
}

/**
 * 多个文件并发解析。错误不阻断其他文件——失败的会变成 rejected promise，调用方自己挑。
 */
export async function parseFilesForChat(
  files: File[],
  options: { authToken?: string; maxBytes?: number } = {},
): Promise<Array<PromiseSettledResult<FileParseResult>>> {
  return Promise.allSettled(files.map((f) => parseFileForChat(f, options)));
}
