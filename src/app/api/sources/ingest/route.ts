import { NextRequest, NextResponse } from 'next/server';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import type { TranscriptSegment } from '@/types';

export const runtime = 'nodejs';

const MAX_FILE_BYTES = 20 * 1024 * 1024;
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

function getExtension(fileName: string): string {
  const index = fileName.lastIndexOf('.');
  if (index <= 0) return '';
  return fileName.slice(index + 1).toLowerCase();
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

  const sentenceSeparator = /(?<=[。！？!?；;\.])\s*/;

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
    if (current) chunks.push(current.trim());
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

async function extractDocumentText(file: File, extension: string): Promise<string> {
  const bytes = Buffer.from(await file.arrayBuffer());

  if (['txt', 'md', 'markdown', 'csv', 'json', 'html', 'htm'].includes(extension)) {
    return bytes.toString('utf8');
  }

  if (extension === 'pdf') {
    const parser = new PDFParse({ data: bytes });
    try {
      const parsed = await parser.getText();
      return parsed.text || '';
    } finally {
      await parser.destroy();
    }
  }

  if (extension === 'docx') {
    const parsed = await mammoth.extractRawText({ buffer: bytes });
    return parsed.value || '';
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
      return jsonError('暂不支持该文档类型，请使用 txt/md/csv/json/pdf/docx', 400, 'FILE_UNSUPPORTED');
    }

    const text = await extractDocumentText(file, extension);
    const title = file.name.replace(/\.[^.]+$/, '').trim() || '导入文档';
    return jsonSuccess({
      kind: extension === 'txt' || extension === 'md' ? 'text' : 'document',
      title,
      fileType: extension,
      text,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError(`文档导入失败: ${message}`, 500, 'INGEST_INTERNAL_ERROR');
  }
}
