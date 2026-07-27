/**
 * GET /api/workspace/images/{user}/{file}
 *
 * 流式返回持久化的截图 / 关键帧图片。
 *
 * 为什么用 API 路由而非 /uploads/... 静态：
 *   Next.js `next start` 只服务进程启动时已存在的 public 文件，运行时上传的
 *   新文件静态访问会 404。动态 API 路由每次读盘，运行时上传即可访问。
 *
 * 访问控制：路径含不可猜的 userId(cuid)+imageKey 文件名（与 workspace/audio 同级别）。
 */

import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BASE_DIR = path.join(process.cwd(), 'public', 'uploads', 'images');

function safeSegment(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 120);
}

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
};

export async function GET(
  _request: NextRequest,
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
    return NextResponse.json({ error: '图片不存在' }, { status: 404 });
  }

  const ext = path.extname(safeFile).toLowerCase();
  const contentType = MIME_BY_EXT[ext] || 'application/octet-stream';

  const stream = fs.createReadStream(filePath);
  return new NextResponse(stream as unknown as ReadableStream, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(stat.size),
      'Cache-Control': 'private, max-age=86400',
    },
  });
}
