/**
 * GET /api/workspace/audio/{user}/{file}
 *
 * 档位2：流式返回持久化的录音音频。
 *
 * 为什么用 API 路由而非 /uploads/... 静态：
 *   Next.js `next start` 只服务进程启动时已存在的 public 文件，运行时上传的
 *   新文件静态访问会 404。动态 API 路由每次读盘，运行时上传即可访问。
 *
 * 支持 HTTP Range：<audio> 拖动进度、长音频按需加载都依赖 206 Partial Content。
 *
 * 访问控制：路径含不可猜的 userId(cuid)+sessionId 文件名（与 wechat-media 同级别）。
 * 后续可升级为带签名/鉴权代理。
 */

import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BASE_DIR = path.join(process.cwd(), 'public', 'uploads', 'audio');

function safeSegment(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 120);
}

const MIME_BY_EXT: Record<string, string> = {
  '.webm': 'audio/webm',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ user: string; file: string }> },
) {
  const { user, file } = await params;
  const safeUser = safeSegment(user);
  const safeFile = safeSegment(file);

  if (!safeUser || !safeFile || safeFile.includes('..') || safeUser.includes('..')) {
    return NextResponse.json({ error: '无效路径' }, { status: 400 });
  }

  const filePath = path.join(BASE_DIR, safeUser, safeFile);
  // 双重保险：解析后路径必须仍在 BASE_DIR 内（防遍历）
  if (!filePath.startsWith(BASE_DIR)) {
    return NextResponse.json({ error: '无效路径' }, { status: 400 });
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
    if (!stat.isFile()) throw new Error('not a file');
  } catch {
    return NextResponse.json({ error: '音频不存在' }, { status: 404 });
  }

  const ext = path.extname(safeFile).toLowerCase();
  const contentType = MIME_BY_EXT[ext] || 'application/octet-stream';
  const total = stat.size;
  const rangeHeader = request.headers.get('range');

  // Range 请求 → 206 Partial Content（支持拖动 / 分段加载）
  if (rangeHeader) {
    const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
    if (match) {
      const start = match[1] ? parseInt(match[1], 10) : 0;
      const end = match[2] ? parseInt(match[2], 10) : total - 1;
      if (start >= total || end >= total || start > end) {
        return new NextResponse(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${total}` },
        });
      }
      const chunkSize = end - start + 1;
      const stream = fs.createReadStream(filePath, { start, end });
      return new NextResponse(stream as unknown as ReadableStream, {
        status: 206,
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(chunkSize),
          'Content-Range': `bytes ${start}-${end}/${total}`,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'private, max-age=3600',
        },
      });
    }
  }

  // 全量返回
  const stream = fs.createReadStream(filePath);
  return new NextResponse(stream as unknown as ReadableStream, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(total),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
