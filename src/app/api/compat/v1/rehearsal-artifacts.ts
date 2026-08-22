// 清小搭讲稿产物 — marker 解析 → docx 附件 + 在线「上场包」页
//
// 模型按 rehearsal-prompts v3 约定用【讲稿开始】/【讲稿结束】包裹讲稿正文。
// 本模块从 assistant 全量输出中提取标记间文本，生成两种产物并落盘托管：
//   1. .docx 附件（docx-writer.ts 手写 ZIP，Word/WPS 可打开）
//   2. 自包含 HTML 上场包页（inline CSS，移动端可读、可打印）
// 落盘目录 data/xiaoda-files/，文件名 32 位 hex 不可猜（对齐仓库 audio/images
// 档位2 惯例），每次写入顺手懒清理 mtime 超过 24h 的旧文件。
// 对外经 /api/compat/v1/files/[name] 提供 GET（免 Bearer，见该路由注释）。
//
// 无标记 / 标记不完整 / 生成失败 → 返回 null，调用方行为与未生成产物时完全一致。

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { createLogger } from '@/lib/logger';
import { buildSpeechDraftDocx } from './docx-writer';

const log = createLogger('xiaoda-compat');

const DRAFT_START = '【讲稿开始】';
const DRAFT_END = '【讲稿结束】';

export const XIAODA_FILES_DIR = path.join(process.cwd(), 'data', 'xiaoda-files');
const FILE_TTL_MS = 24 * 60 * 60 * 1000;
export const XIAODA_FILE_NAME_RE = /^[a-f0-9]{32}\.(docx|html)$/;

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export interface XsodaAttachment {
  fileUrl: string;
  fileName: string;
  fileType: 'word';
  mimeType: string;
  fileSize: number;
  expiresAt: string; // ISO，生成时刻 +24h
}

export interface DraftArtifacts {
  /** 追加到对话尾部的提示行（含在线上场包链接）。 */
  noteLine: string;
  /** 挂到 stop 帧 / 非流式响应顶层的 x_soda 结构。 */
  xSoda: { attachments: XsodaAttachment[] };
}

/**
 * 提取【讲稿开始】...【讲稿结束】之间的讲稿正文。
 * 边界约定：取第一对完整标记（首个开始标记之后的首个结束标记）；
 * 只有开始没有结束（标记不完整）→ 视为无标记；正文 trim 后为空 → null。
 */
export function extractSpeechDraft(fullText: string): string | null {
  const start = fullText.indexOf(DRAFT_START);
  if (start < 0) return null;
  const bodyStart = start + DRAFT_START.length;
  const end = fullText.indexOf(DRAFT_END, bodyStart);
  if (end < 0) return null;
  const draft = fullText.slice(bodyStart, end).trim();
  return draft || null;
}

/** 从代理/请求头推导对外绝对地址（https 优先看 x-forwarded-proto），不写死域名。 */
export function resolveBaseUrl(headers: Headers): string {
  const host =
    headers.get('x-forwarded-host')?.split(',')[0].trim() ||
    headers.get('host')?.trim() ||
    'localhost';
  const forwardedProto = headers.get('x-forwarded-proto')?.split(',')[0].trim();
  const isLocal = host.startsWith('localhost') || host.startsWith('127.0.0.1');
  const proto = forwardedProto || (isLocal ? 'http' : 'https');
  return `${proto}://${host}`;
}

function formatLocalTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 在线「上场包」页：自包含 HTML（inline CSS，无外部资源）。
 * 场景是"上场前还在走廊里看手机"：大字号、高对比行距、移动端可读、可打印。
 */
export function buildDraftHtml(draft: string, generatedAtLabel: string): string {
  const paragraphs = draft
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('\n      ');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>试讲讲稿 · 上场包</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    background: #f7f5f2; color: #1c1a17;
    font-size: 19px; line-height: 1.9;
    padding: 28px 18px 64px;
  }
  .page { max-width: 640px; margin: 0 auto; }
  header { margin-bottom: 28px; }
  .badge {
    display: inline-block; font-size: 13px; letter-spacing: 2px;
    color: #8a6d3b; border: 1px solid #d8c9a8; border-radius: 999px;
    padding: 2px 12px; margin-bottom: 14px;
  }
  h1 { font-size: 26px; line-height: 1.4; margin-bottom: 10px; }
  .scene { font-size: 15px; color: #6b655c; margin-bottom: 4px; }
  .meta { font-size: 13px; color: #9a938a; }
  .draft p { margin: 0 0 1.1em; }
  @media print {
    body { background: #fff; font-size: 14pt; padding: 0; }
    .page { max-width: none; }
  }
</style>
</head>
<body>
  <div class="page">
    <header>
      <div class="badge">上场包</div>
      <h1>试讲讲稿</h1>
      <p class="scene">场合：__________　听众：__________　时长：__________</p>
      <p class="meta">生成于 ${escapeHtml(generatedAtLabel)} · 上场前 · MeetMind</p>
    </header>
    <main class="draft">
      ${paragraphs}
    </main>
  </div>
</body>
</html>
`;
}

/** 懒清理：删除目录里 mtime 超过 24h 的旧产物文件（逐个 try/catch，不阻塞写入）。 */
function pruneExpiredFiles(now: number): void {
  let names: string[];
  try {
    names = fs.readdirSync(XIAODA_FILES_DIR);
  } catch {
    return;
  }
  for (const name of names) {
    if (!XIAODA_FILE_NAME_RE.test(name)) continue;
    try {
      const stat = fs.statSync(path.join(XIAODA_FILES_DIR, name));
      if (now - stat.mtimeMs > FILE_TTL_MS) {
        fs.unlinkSync(path.join(XIAODA_FILES_DIR, name));
      }
    } catch {
      // 单个文件清理失败不影响主流程
    }
  }
}

/**
 * 从 assistant 全量输出构建讲稿产物（docx + 上场包页）并落盘。
 * 无标记 / 生成失败 → null（调用方零行为变化）。
 */
export async function buildDraftArtifacts(
  fullText: string,
  baseUrl: string,
): Promise<DraftArtifacts | null> {
  const draft = extractSpeechDraft(fullText);
  if (!draft) return null;

  try {
    const now = new Date();
    const timeLabel = formatLocalTime(now);
    const docx = buildSpeechDraftDocx(draft, timeLabel);
    const html = buildDraftHtml(draft, timeLabel);

    const stem = crypto.randomBytes(16).toString('hex');
    fs.mkdirSync(XIAODA_FILES_DIR, { recursive: true });
    pruneExpiredFiles(now.getTime());
    fs.writeFileSync(path.join(XIAODA_FILES_DIR, `${stem}.docx`), docx);
    fs.writeFileSync(path.join(XIAODA_FILES_DIR, `${stem}.html`), html, 'utf8');

    const fileUrl = `${baseUrl}/api/compat/v1/files/${stem}.docx`;
    const htmlUrl = `${baseUrl}/api/compat/v1/files/${stem}.html`;
    log.debug('rehearsal draft artifacts generated', {
      chars: draft.length,
      docxBytes: docx.length,
      stem,
    });
    return {
      noteLine: `\n\n📄 讲稿附件已生成，也可在线查看：${htmlUrl}`,
      xSoda: {
        attachments: [
          {
            fileUrl,
            fileName: '试讲讲稿.docx',
            fileType: 'word',
            mimeType: DOCX_MIME,
            fileSize: docx.length,
            expiresAt: new Date(now.getTime() + FILE_TTL_MS).toISOString(),
          },
        ],
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn('rehearsal draft artifacts failed', { err: message });
    return null;
  }
}
