/**
 * GET /api/infographic/image/{file}
 *
 * 流式返回持久化的信息图图片。
 *
 * 为什么用 API 路由而非 /uploads/... 静态：
 *   Next.js `next start` 只服务进程启动时已存在的 public 文件，运行时新生成的
 *   文件静态访问会 404。动态 API 路由每次读盘，运行时生成即可访问。
 *
 * 长缓存：文件名含 requestId + 时间戳，唯一不可变，可永久缓存。
 */
import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BASE_DIR = path.join(process.cwd(), 'public', 'uploads', 'infographic');

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

export async function GET(_req: NextRequest, { params }: { params: { file: string } }) {
  const { file } = params;
  // 防路径穿越：只取 basename，去非法字符
  const safe = path.basename(file).replace(/[^a-zA-Z0-9._-]/g, '');
  if (!safe) return new NextResponse('not found', { status: 404 });

  const filePath = path.join(BASE_DIR, safe);
  try {
    const buf = await fs.promises.readFile(filePath);
    const ext = path.extname(safe).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch {
    return new NextResponse('not found', { status: 404 });
  }
}
