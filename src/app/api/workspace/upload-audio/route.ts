/**
 * POST /api/workspace/upload-audio
 *
 * 档位2（跨设备带走音频）：把录音 blob 持久化到服务端，返回真实可访问 URL。
 *
 * 与 /api/upload-audio（转写用临时目录，1h 清理）不同：
 *   - 需要登录（Bearer）
 *   - 持久化存储，不清理（按 userId/sessionId 命名，重传幂等覆盖）
 *   - 返回 /uploads/audio/... 真实 URL，写进 capture.mediaUrl → 任何设备登录都能播放
 *
 * 这补上「音频只在原设备浏览器本地 blob」的后台盲区：
 * 上传后后台能看到音频、能兜底转写、高价值录音有真备份。
 *
 * 存储：public/uploads/audio/{userId}/{sessionId}.{ext}（Next.js 静态服务）。
 * 隐私：路径含不可猜的 userId(cuid)+sessionId；后续可迁移到对象存储 + 鉴权代理。
 */

import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { authService } from '@/lib/services/auth-service';
import { createLogger } from '@/lib/logger';

const log = createLogger('workspace/upload-audio');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB
const BASE_DIR = path.join(process.cwd(), 'public', 'uploads', 'audio');

function getAuthPayload(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  return authService.verifyToken(authHeader.slice(7));
}

/** 安全化片段：只留字母数字/下划线/连字符，防路径遍历 */
function safeSegment(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
}

export async function POST(request: NextRequest) {
  try {
    const payload = getAuthPayload(request);
    if (!payload) {
      return NextResponse.json({ success: false, error: '未授权' }, { status: 401 });
    }

    const formData = await request.formData();
    const audioFile = formData.get('audio') as File | null;
    const rawSessionId = formData.get('sessionId');
    const sessionId = typeof rawSessionId === 'string' ? safeSegment(rawSessionId) : '';

    if (!audioFile) {
      return NextResponse.json({ success: false, error: '未提供音频文件' }, { status: 400 });
    }
    if (!sessionId) {
      return NextResponse.json({ success: false, error: '缺少 sessionId' }, { status: 400 });
    }
    if (audioFile.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { success: false, error: `文件过大，最大支持 ${MAX_FILE_SIZE / 1024 / 1024}MB` },
        { status: 400 },
      );
    }

    const userDir = path.join(BASE_DIR, safeSegment(payload.sub));
    fs.mkdirSync(userDir, { recursive: true });

    const ext = (path.extname(audioFile.name) || '.webm').replace(/[^.a-zA-Z0-9]/g, '') || '.webm';
    const fileName = `${sessionId}${ext}`;
    const filePath = path.join(userDir, fileName);

    const buffer = Buffer.from(await audioFile.arrayBuffer());
    fs.writeFileSync(filePath, buffer);

    // 注意：必须走 API 流式路由，不能用 /uploads/... 静态 URL——
    // Next.js `next start` 只服务进程启动时已存在的 public 文件，
    // 运行时上传的文件静态访问会 404，必须由动态 API 路由读盘流式返回。
    const relUrl = `/api/workspace/audio/${safeSegment(payload.sub)}/${fileName}`;
    const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
    const protocol = request.headers.get('x-forwarded-proto') || 'https';
    const absoluteUrl = host ? `${protocol}://${host}${relUrl}` : relUrl;

    return NextResponse.json({
      success: true,
      mediaUrl: relUrl,
      absoluteUrl,
      size: buffer.length,
    });
    // 注意：absoluteUrl 是公网可访问的绝对 URL，用于 DashScope Fun-ASR 说话人分离
  } catch (error) {
    log.error('workspace upload-audio error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '上传失败' },
      { status: 500 },
    );
  }
}
