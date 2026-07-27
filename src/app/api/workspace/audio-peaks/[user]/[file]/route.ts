/**
 * GET /api/workspace/audio-peaks/{user}/{file}
 *
 * 返回录音的预生成波形峰值（800 点 + 时长），前端 wavesurfer 拿到后跳过整段解码。
 * 未生成时返回 404 并后台补生成（下次访问命中）。
 *
 * 访问控制与 /api/workspace/audio 同级：路径含不可猜 userId(cuid)+sessionId。
 */

import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { ensureAudioPeaks } from '@/lib/services/audio-peaks-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BASE_DIR = path.join(process.cwd(), 'public', 'uploads', 'audio');

function safeSegment(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 120);
}

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
  if (!filePath.startsWith(BASE_DIR)) {
    return NextResponse.json({ error: '无效路径' }, { status: 400 });
  }

  try {
    if (!fs.statSync(filePath).isFile()) throw new Error('not a file');
  } catch {
    return NextResponse.json({ error: '音频不存在' }, { status: 404 });
  }

  const peaks = ensureAudioPeaks(filePath);
  if (!peaks) {
    return NextResponse.json({ error: '波形尚未准备好' }, { status: 404 });
  }

  return NextResponse.json(peaks, {
    headers: { 'Cache-Control': 'private, max-age=3600' },
  });
}
