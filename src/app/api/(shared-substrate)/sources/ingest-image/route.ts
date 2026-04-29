import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { LLMConfig } from '@/lib/config';
import { chat, isMultimodalModel } from '@/lib/services/llm-service';
import {
  isToolNotFoundError,
  resolveFfmpegPath,
  runCommand,
  safeUnlink,
} from '@/lib/services/media-tooling';
import type { TranscriptSegment } from '@/types';

export const runtime = 'nodejs';
export const maxDuration = 180;

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const TEMP_DIR = path.join(os.tmpdir(), 'meetmind-image-ingest');
const SUPPORTED_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'heic', 'heif']);

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

function stripMarkdownCodeFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:markdown|md|text)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

function simplifyMarkdownText(raw: string): string {
  return raw
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/^\s*>\s+/gm, '')
    .replace(/\|/g, ' ')
    .replace(/`{1,3}/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitTextIntoChunks(text: string, maxChars = 240): string[] {
  const chunks: string[] = [];
  const paragraphs = text
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  const sentenceSeparator = /(?<=[。！？；.!?])\s*/u;

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

  return chunks.filter(Boolean);
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

function jsonError(message: string, status = 400, code?: string) {
  return NextResponse.json({ success: false, error: message, code }, { status });
}

function jsonSuccess(title: string, text: string) {
  const normalized = normalizeText(simplifyMarkdownText(stripMarkdownCodeFence(text)));
  if (!normalized) {
    return jsonError('没有从图片里识别到可用内容', 422, 'EMPTY_TEXT');
  }

  const segments = buildSegmentsFromText(normalized, `image-${Date.now()}`);
  return NextResponse.json({
    success: true,
    kind: 'document',
    title,
    fileType: 'image',
    characterCount: normalized.length,
    segments,
  });
}

async function ensureTempDir(): Promise<void> {
  await fs.mkdir(TEMP_DIR, { recursive: true });
}

async function writeIncomingImage(file: File): Promise<string> {
  await ensureTempDir();
  const extension = getExtension(file.name) || 'png';
  const filePath = path.join(TEMP_DIR, `${randomUUID()}.${extension}`);
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(filePath, buffer);
  return filePath;
}

async function normalizeImagePath(sourcePath: string): Promise<string> {
  const ffmpegPath = resolveFfmpegPath();
  const outputPath = path.join(TEMP_DIR, `${randomUUID()}.png`);
  try {
    await runCommand(
      ffmpegPath,
      ['-y', '-i', sourcePath, '-frames:v', '1', outputPath],
      { toolName: 'ffmpeg' }
    );
    return outputPath;
  } catch (error) {
    safeUnlink(outputPath);
    if (isToolNotFoundError(error, 'ffmpeg')) {
      return sourcePath;
    }
    throw error;
  }
}

async function imagePathToDataUrl(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

async function extractImageText(file: File): Promise<string> {
  const modelId = LLMConfig.defaultVisionModel;
  if (!modelId || !isMultimodalModel(modelId)) {
    throw new Error('当前没有可用的多模态模型来解析图片');
  }

  const sourcePath = await writeIncomingImage(file);
  let normalizedPath = sourcePath;
  try {
    normalizedPath = await normalizeImagePath(sourcePath);
    const dataUrl = await imagePathToDataUrl(normalizedPath);
    const response = await chat(
      [
        {
          role: 'system',
          content:
            '你是学习资料 OCR 助手。请先尽可能准确提取图片中的文字，再整理成适合阅读的纯文本。不要输出 Markdown 标题、列表符号、分隔线、代码块，也不要额外解释。看不清的地方直接写“[图片不清晰]”。',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: '请识别这张图片中的文字内容，并整理成干净的纯文本。' },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
      modelId,
      { temperature: 0.1, maxTokens: 2400 }
    );

    return response.content || '';
  } finally {
    safeUnlink(sourcePath);
    if (normalizedPath !== sourcePath) {
      safeUnlink(normalizedPath);
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return jsonError('没有检测到上传图片', 400, 'FILE_MISSING');
    }

    if (file.size <= 0) {
      return jsonError('上传图片为空', 400, 'FILE_EMPTY');
    }

    if (file.size > MAX_FILE_BYTES) {
      return jsonError('图片过大，当前最多支持 20MB', 413, 'FILE_TOO_LARGE');
    }

    const extension = getExtension(file.name);
    const isImageMime = file.type.startsWith('image/');
    if ((!extension || !SUPPORTED_EXTENSIONS.has(extension)) && !isImageMime) {
      return jsonError('当前只支持 png/jpg/jpeg/webp/gif/bmp/heic/heif 图片', 400, 'FILE_UNSUPPORTED');
    }

    const text = await extractImageText(file);
    const title = file.name.replace(/\.[^.]+$/, '').trim() || '图片材料';
    return jsonSuccess(title, text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError(`图片解析失败: ${message}`, 500, 'INGEST_IMAGE_INTERNAL_ERROR');
  }
}
