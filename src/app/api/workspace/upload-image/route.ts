/**
 * POST /api/workspace/upload-image
 *
 * 全端采集层：把截图 / 关键帧图片持久化到服务端，返回真实可访问 URL。
 *
 * 与 /api/sources/ingest-image（只 OCR 成文本、丢弃原图）不同：
 *   - 需要登录（Bearer）
 *   - 持久化存储原图（桌面热键截图、录课关键帧都要可回看）
 *   - 返回 /api/workspace/images/... 真实 URL，可写进 capture.mediaUrl
 *     或 WorkspaceCaptureArtifact(kind='screenshot' | 'keyframe') 的 payload
 *
 * 存储：public/uploads/images/{userId}/{imageKey}.{ext}。
 * 隐私：路径含不可猜的 userId(cuid)+imageKey；读取走动态 API 路由（运行时上传
 * 的文件 Next.js 静态服务会 404，与 upload-audio 同构）。
 */

import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { authService } from '@/lib/services/auth-service';
import { createLogger } from '@/lib/logger';

const log = createLogger('workspace/upload-image');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const BASE_DIR = path.join(process.cwd(), 'public', 'uploads', 'images');

const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']);

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
    const imageFile = formData.get('image') as File | null;
    const rawKey = formData.get('imageKey');
    const imageKey = typeof rawKey === 'string' && rawKey ? safeSegment(rawKey) : randomUUID();

    if (!imageFile) {
      return NextResponse.json({ success: false, error: '未提供图片文件' }, { status: 400 });
    }
    if (imageFile.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { success: false, error: `图片过大，最大支持 ${MAX_FILE_SIZE / 1024 / 1024}MB` },
        { status: 400 },
      );
    }

    let ext = path.extname(imageFile.name || '').toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      const byMime: Record<string, string> = {
        'image/png': '.png',
        'image/jpeg': '.jpg',
        'image/webp': '.webp',
        'image/gif': '.gif',
        'image/bmp': '.bmp',
      };
      ext = byMime[imageFile.type] || '.png';
    }

    const userDir = path.join(BASE_DIR, safeSegment(payload.sub));
    fs.mkdirSync(userDir, { recursive: true });

    const fileName = `${imageKey}${ext}`;
    const filePath = path.join(userDir, fileName);
    const buffer = Buffer.from(await imageFile.arrayBuffer());
    fs.writeFileSync(filePath, buffer);

    const relUrl = `/api/workspace/images/${safeSegment(payload.sub)}/${fileName}`;
    const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
    const protocol = request.headers.get('x-forwarded-proto') || 'https';
    const absoluteUrl = host ? `${protocol}://${host}${relUrl}` : relUrl;

    return NextResponse.json({
      success: true,
      mediaUrl: relUrl,
      absoluteUrl,
      size: buffer.length,
    });
  } catch (error) {
    log.error('workspace upload-image error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '上传失败' },
      { status: 500 },
    );
  }
}
