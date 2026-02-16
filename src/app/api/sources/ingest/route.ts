import { NextRequest, NextResponse } from 'next/server';
import mammoth from 'mammoth';
import type { TranscriptSegment } from '@/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const DEFAULT_DASHSCOPE_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DEFAULT_DASHSCOPE_DOC_MODEL = 'qwen-doc-turbo';

const SUPPORTED_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'csv',
  'json',
  'html',
  'htm',
  'pdf',
  'docx',
]);

type SourceKind = 'text' | 'document';

interface DashScopeDocConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  retryCount: number;
  maxTokens: number;
  fileReadyMaxWaitMs: number;
  fileReadyPollIntervalMs: number;
}

interface DashScopeFileUploadResponse {
  id?: string;
  status?: string;
}

interface DashScopeChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
}

function parseNumberEnv(
  name: string,
  fallback: number,
  min: number,
  max: number
): number {
  const raw = process.env[name];
  const parsed = Number.parseInt(raw || '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function getDashScopeDocConfig(): DashScopeDocConfig {
  const apiKey = (process.env.DASHSCOPE_API_KEY || '').trim();
  const baseUrl = (process.env.DASHSCOPE_DOC_BASE_URL || process.env.LLM_BASE_URL || DEFAULT_DASHSCOPE_BASE_URL).replace(/\/+$/, '');
  const model = (process.env.DASHSCOPE_DOC_MODEL || DEFAULT_DASHSCOPE_DOC_MODEL).trim();

  return {
    apiKey,
    baseUrl,
    model: model || DEFAULT_DASHSCOPE_DOC_MODEL,
    timeoutMs: parseNumberEnv('DASHSCOPE_DOC_TIMEOUT_MS', 180_000, 30_000, 600_000),
    retryCount: parseNumberEnv('DASHSCOPE_DOC_RETRIES', 2, 0, 5),
    maxTokens: parseNumberEnv('DASHSCOPE_DOC_MAX_TOKENS', 12_000, 512, 32_768),
    fileReadyMaxWaitMs: parseNumberEnv('DASHSCOPE_DOC_FILE_READY_MAX_WAIT_MS', 120_000, 5_000, 300_000),
    fileReadyPollIntervalMs: parseNumberEnv('DASHSCOPE_DOC_FILE_READY_POLL_MS', 1_500, 300, 10_000),
  };
}

function getExtension(fileName: string): string {
  const index = fileName.lastIndexOf('.');
  if (index <= 0) return '';
  return fileName.slice(index + 1).toLowerCase();
}

function isPlainTextExtension(extension: string): boolean {
  return ['txt', 'md', 'markdown', 'csv', 'json', 'html', 'htm'].includes(extension);
}

function normalizeText(raw: string): string {
  return raw
    .replace(/\u0000/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[ \u00A0]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitTextIntoChunks(text: string, maxChars = 240): string[] {
  const chunks: string[] = [];
  const paragraphs = text
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  const sentenceSeparator = /(?<=[。！？!?；;…\.])\s*/u;

  for (const paragraph of paragraphs) {
    if (paragraph.length <= maxChars) {
      chunks.push(paragraph);
      continue;
    }

    const sentences = paragraph
      .split(sentenceSeparator)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);

    if (sentences.length === 0) {
      for (let i = 0; i < paragraph.length; i += maxChars) {
        chunks.push(paragraph.slice(i, i + maxChars).trim());
      }
      continue;
    }

    let current = '';
    for (const sentence of sentences) {
      if (!current) {
        current = sentence;
        continue;
      }
      if (`${current} ${sentence}`.length <= maxChars) {
        current = `${current} ${sentence}`;
      } else {
        chunks.push(current.trim());
        current = sentence;
      }
    }

    if (current) {
      chunks.push(current.trim());
    }
  }

  return chunks.filter((item) => item.length > 0);
}

function buildSegmentsFromText(text: string, prefix: string): TranscriptSegment[] {
  const chunks = splitTextIntoChunks(text);
  const segments: TranscriptSegment[] = [];
  let cursor = 0;

  chunks.forEach((chunk, index) => {
    const durationMs = Math.max(3000, Math.min(18000, chunk.length * 90));
    const startMs = cursor;
    const endMs = startMs + durationMs;
    cursor = endMs + 500;

    segments.push({
      id: `${prefix}-${index + 1}`,
      text: chunk,
      startMs,
      endMs,
      confidence: 1,
      isFinal: true,
    });
  });

  return segments;
}

function getErrorMessage(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const direct = ['message', 'msg', 'errorMessage', 'detail'];
    for (const key of direct) {
      const candidate = record[key];
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }

    const errorField = record.error;
    if (typeof errorField === 'string' && errorField.trim()) {
      return errorField.trim();
    }
    if (typeof errorField === 'object' && errorField !== null) {
      const nested = getErrorMessage(errorField, '');
      if (nested) return nested;
    }
  }

  return fallback;
}

async function readJsonSafely(response: Response): Promise<unknown> {
  const raw = await response.text();
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return { raw };
  }
}

function extractChatMessageContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (typeof part === 'object' && part !== null) {
          const record = part as Record<string, unknown>;
          if (typeof record.text === 'string') return record.text;
          if (typeof record.content === 'string') return record.content;
        }
        return '';
      })
      .join('\n')
      .trim();
  }

  if (typeof content === 'object' && content !== null) {
    const record = content as Record<string, unknown>;
    if (typeof record.text === 'string') return record.text;
  }

  return '';
}

function extractDashScopeCompletionText(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null) {
    return '';
  }

  const choices = (payload as DashScopeChatCompletionResponse).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return '';
  }

  return extractChatMessageContent(choices[0]?.message?.content);
}

function stripMarkdownCodeFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:markdown|md)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`请求超时（>${timeoutMs}ms）`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRetryableDashScopeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(429|500|502|503|504|timeout|timed out|processing|not ready|rate limit|temporarily)/i.test(message);
}

function getDashScopeAuthHeaders(apiKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey}`,
  };
}

async function uploadFileToDashScope(file: File, config: DashScopeDocConfig): Promise<string> {
  const form = new FormData();
  form.append('purpose', 'file-extract');
  form.append('file', file, file.name);

  const response = await fetchWithTimeout(
    `${config.baseUrl}/files`,
    {
      method: 'POST',
      headers: getDashScopeAuthHeaders(config.apiKey),
      body: form,
    },
    config.timeoutMs
  );

  const payload = await readJsonSafely(response);
  if (!response.ok) {
    throw new Error(`上传文件到 DashScope 失败（HTTP ${response.status}）：${getErrorMessage(payload, '未知错误')}`);
  }

  const fileId = (payload as DashScopeFileUploadResponse | null)?.id;
  if (!fileId || typeof fileId !== 'string') {
    throw new Error('上传文件到 DashScope 失败：未返回 file_id');
  }

  return fileId;
}

async function waitForDashScopeFileReady(fileId: string, config: DashScopeDocConfig): Promise<void> {
  const deadline = Date.now() + config.fileReadyMaxWaitMs;

  while (Date.now() < deadline) {
    const response = await fetchWithTimeout(
      `${config.baseUrl}/files/${encodeURIComponent(fileId)}`,
      {
        method: 'GET',
        headers: getDashScopeAuthHeaders(config.apiKey),
      },
      config.timeoutMs
    );

    const payload = await readJsonSafely(response);
    if (!response.ok) {
      // 兼容部分环境不开放文件详情查询接口，直接进入推理阶段。
      return;
    }

    const status = (payload as DashScopeFileUploadResponse | null)?.status?.toLowerCase?.() || '';
    if (!status || ['processed', 'success', 'succeeded', 'ready'].includes(status)) {
      return;
    }
    if (['failed', 'error', 'cancelled'].includes(status)) {
      throw new Error(`DashScope 文件处理失败，状态：${status}`);
    }

    await sleep(config.fileReadyPollIntervalMs);
  }

  throw new Error(`等待 DashScope 文件就绪超时（>${config.fileReadyMaxWaitMs}ms）`);
}

async function parseFileByDashScope(fileId: string, config: DashScopeDocConfig): Promise<string> {
  const prompt = [
    '请将文档完整解析为 Markdown，要求如下：',
    '1. 按原文顺序输出，不要总结，不要改写，不要省略。',
    '2. 保留标题层级、段落、列表、表格结构。',
    '3. 图片或图表请转为可读说明；若可识别图表数据，尽量转成 Markdown 表格。',
    '4. 仅输出 Markdown 正文，不要附加解释。',
  ].join('\n');

  const response = await fetchWithTimeout(
    `${config.baseUrl}/chat/completions`,
    {
      method: 'POST',
      headers: {
        ...getDashScopeAuthHeaders(config.apiKey),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.1,
        max_tokens: config.maxTokens,
        messages: [
          {
            role: 'system',
            content: `fileid://${fileId}`,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    },
    config.timeoutMs
  );

  const payload = await readJsonSafely(response);
  if (!response.ok) {
    throw new Error(`DashScope 文档解析请求失败（HTTP ${response.status}）：${getErrorMessage(payload, '未知错误')}`);
  }

  const content = extractDashScopeCompletionText(payload);
  if (!content.trim()) {
    throw new Error('DashScope 文档解析返回为空');
  }

  return stripMarkdownCodeFence(content);
}

async function deleteDashScopeFile(fileId: string, config: DashScopeDocConfig): Promise<void> {
  await fetchWithTimeout(
    `${config.baseUrl}/files/${encodeURIComponent(fileId)}`,
    {
      method: 'DELETE',
      headers: getDashScopeAuthHeaders(config.apiKey),
    },
    config.timeoutMs
  ).catch(() => {
    // 清理失败不影响主流程。
  });
}

async function parseDocumentWithDashScope(file: File): Promise<string> {
  const config = getDashScopeDocConfig();
  if (!config.apiKey) {
    throw new Error('未配置 DASHSCOPE_API_KEY，无法使用大模型文档解析');
  }

  let fileId = '';
  try {
    fileId = await uploadFileToDashScope(file, config);
    await waitForDashScopeFileReady(fileId, config);

    let lastError: unknown = null;
    for (let attempt = 0; attempt <= config.retryCount; attempt += 1) {
      try {
        return await parseFileByDashScope(fileId, config);
      } catch (error) {
        lastError = error;
        if (attempt >= config.retryCount || !isRetryableDashScopeError(error)) {
          throw error;
        }
        const backoffMs = Math.min(5000, 700 * 2 ** attempt);
        await sleep(backoffMs);
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  } finally {
    if (fileId) {
      await deleteDashScopeFile(fileId, config);
    }
  }
}

async function extractPlainText(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const decoder = new TextDecoder('utf-8');
  return decoder.decode(bytes);
}

async function extractDocxWithMammoth(file: File): Promise<string> {
  const bytes = Buffer.from(await file.arrayBuffer());
  const parsed = await mammoth.extractRawText({ buffer: bytes });
  return parsed.value || '';
}

async function extractDocumentText(file: File, extension: string): Promise<string> {
  if (isPlainTextExtension(extension)) {
    return extractPlainText(file);
  }

  if (extension === 'pdf' || extension === 'docx') {
    try {
      return await parseDocumentWithDashScope(file);
    } catch (error) {
      if (extension === 'docx') {
        const fallbackText = await extractDocxWithMammoth(file);
        if (normalizeText(fallbackText)) {
          return fallbackText;
        }
      }
      throw error;
    }
  }

  return '';
}

function jsonError(message: string, status = 400, code?: string) {
  return NextResponse.json({ success: false, error: message, code }, { status });
}

function jsonSuccess(params: {
  kind: SourceKind;
  title: string;
  fileType?: string;
  text: string;
}) {
  const normalized = normalizeText(params.text);
  if (!normalized) {
    return jsonError('未提取到可用文本内容', 422, 'EMPTY_TEXT');
  }

  const segments = buildSegmentsFromText(normalized, `${params.kind}-${Date.now()}`);
  return NextResponse.json({
    success: true,
    kind: params.kind,
    title: params.title,
    fileType: params.fileType || params.kind,
    characterCount: normalized.length,
    segments,
  });
}

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const body = (await request.json()) as { text?: unknown; title?: unknown };
      const text = typeof body.text === 'string' ? body.text : '';
      const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : '粘贴文本';
      return jsonSuccess({ kind: 'text', title, text });
    }

    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return jsonError('未检测到上传文件', 400, 'FILE_MISSING');
    }

    if (file.size <= 0) {
      return jsonError('上传文件为空', 400, 'FILE_EMPTY');
    }
    if (file.size > MAX_FILE_BYTES) {
      return jsonError('文件过大，最大支持 20MB', 413, 'FILE_TOO_LARGE');
    }

    const extension = getExtension(file.name);
    if (!extension || !SUPPORTED_EXTENSIONS.has(extension)) {
      return jsonError('暂不支持该文档类型，请使用 txt/md/csv/json/html/pdf/docx', 400, 'FILE_UNSUPPORTED');
    }

    const text = await extractDocumentText(file, extension);
    const title = file.name.replace(/\.[^.]+$/, '').trim() || '导入文档';
    return jsonSuccess({
      kind: isPlainTextExtension(extension) ? 'text' : 'document',
      title,
      fileType: extension,
      text,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError(`文档导入失败: ${message}`, 500, 'INGEST_INTERNAL_ERROR');
  }
}
