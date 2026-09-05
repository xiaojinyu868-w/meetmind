/**
 * GET /api/podcast/audio/{file}
 *
 * 流式返回持久化的播客音频（DashScope 逐句合成 + ffmpeg 拼接产物）。
 * 用 API 路由而非 /uploads/... 静态的原因同 /api/infographic/image：
 * `next start` 只服务进程启动时已存在的 public 文件，运行时生成的必须动态读盘。
 */
import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BASE_DIR = path.join(process.cwd(), 'public', 'uploads', 'podcast');

export async function GET(_req: NextRequest, { params }: { params: { file: string } }) {
  const safe = path.basename(params.file).replace(/[^a-zA-Z0-9._-]/g, '');
  if (!safe || !safe.endsWith('.mp3')) return new NextResponse('not found', { status: 404 });

  try {
    const buf = await fs.promises.readFile(path.join(BASE_DIR, safe));
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch {
    return new NextResponse('not found', { status: 404 });
  }
}
