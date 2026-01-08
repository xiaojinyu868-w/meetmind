/**
 * 音频文件上传 API
 * 
 * POST /api/upload-audio
 * 上传音频文件到临时目录，返回可访问的 URL
 * 用于 qwen3-asr-flash-filetrans 异步转录
 */

import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

// 最大文件大小 500MB
const MAX_FILE_SIZE = 500 * 1024 * 1024;

// 临时文件目录（使用 public 目录使其可通过 HTTP 访问）
const UPLOAD_DIR = path.join(process.cwd(), 'public', 'temp-audio');

// 确保上传目录存在
function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

// 清理过期文件（超过1小时）
function cleanupOldFiles() {
  try {
    if (!fs.existsSync(UPLOAD_DIR)) return;
    
    const files = fs.readdirSync(UPLOAD_DIR);
    const now = Date.now();
    const maxAge = 60 * 60 * 1000; // 1小时
    
    for (const file of files) {
      const filePath = path.join(UPLOAD_DIR, file);
      const stats = fs.statSync(filePath);
      if (now - stats.mtimeMs > maxAge) {
        fs.unlinkSync(filePath);
        console.log('[Upload] Cleaned up old file:', file);
      }
    }
  } catch (e) {
    console.warn('[Upload] Cleanup error:', e);
  }
}

// 获取 ffmpeg 路径
function getFfmpegPath(): string {
  const possiblePaths = [
    path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg.exe'),
    path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg'),
  ];
  
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ffmpegStatic = require('ffmpeg-static');
    if (ffmpegStatic && fs.existsSync(ffmpegStatic)) {
      return ffmpegStatic;
    }
  } catch (e) {
    // ignore
  }
  
  return 'ffmpeg';
}

export async function POST(request: NextRequest) {
  console.log('[Upload API] ===== Request received =====');
  
  try {
    ensureUploadDir();
    cleanupOldFiles();
    
    // 解析 multipart/form-data
    const formData = await request.formData();
    const audioFile = formData.get('audio') as File | null;
    const convertToMp3 = formData.get('convert') === 'true';
    
    if (!audioFile) {
      return NextResponse.json(
        { error: '未提供音频文件' },
        { status: 400 }
      );
    }
    
    // 检查文件大小
    if (audioFile.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `文件过大，最大支持 ${MAX_FILE_SIZE / 1024 / 1024}MB` },
        { status: 400 }
      );
    }
    
    console.log('[Upload API] Received audio:', {
      name: audioFile.name,
      type: audioFile.type,
      size: audioFile.size,
    });
    
    // 生成唯一文件名
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 8);
    const originalExt = path.extname(audioFile.name) || '.webm';
    
    // 保存原始文件
    const arrayBuffer = await audioFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    let finalFileName: string;
    let finalFilePath: string;
    
    if (convertToMp3) {
      // 转换为 MP3 格式（更小，兼容性更好）
      const tempInputPath = path.join(os.tmpdir(), `input_${timestamp}${originalExt}`);
      const mp3FileName = `audio_${timestamp}_${randomId}.mp3`;
      finalFilePath = path.join(UPLOAD_DIR, mp3FileName);
      finalFileName = mp3FileName;
      
      // 保存临时输入文件
      fs.writeFileSync(tempInputPath, buffer);
      
      // 使用 ffmpeg 转换
      const ffmpegPath = getFfmpegPath();
      const cmd = `"${ffmpegPath}" -y -i "${tempInputPath}" -ar 16000 -ac 1 -b:a 64k "${finalFilePath}"`;
      console.log('[Upload API] Converting to MP3:', cmd);
      
      try {
        execSync(cmd, { stdio: 'pipe' });
        console.log('[Upload API] Conversion successful');
      } finally {
        // 清理临时文件
        try {
          if (fs.existsSync(tempInputPath)) fs.unlinkSync(tempInputPath);
        } catch (e) {
          // ignore
        }
      }
    } else {
      // 直接保存原始格式
      finalFileName = `audio_${timestamp}_${randomId}${originalExt}`;
      finalFilePath = path.join(UPLOAD_DIR, finalFileName);
      fs.writeFileSync(finalFilePath, buffer);
    }
    
    // 获取文件大小
    const stats = fs.statSync(finalFilePath);
    console.log('[Upload API] Saved file:', finalFilePath, 'size:', stats.size);
    
    // 构建可访问的 URL
    // 注意：这是本地开发 URL，生产环境需要使用公网 URL
    const host = request.headers.get('host') || 'localhost:3001';
    const protocol = request.headers.get('x-forwarded-proto') || 'http';
    const fileUrl = `${protocol}://${host}/temp-audio/${finalFileName}`;
    
    console.log('[Upload API] File URL:', fileUrl);
    
    return NextResponse.json({
      success: true,
      fileName: finalFileName,
      fileUrl: fileUrl,
      size: stats.size,
      // 提示：本地 URL 无法被百炼访问，需要使用公网 URL
      warning: '本地 URL 仅供开发测试。生产环境请使用 OSS 或其他公网存储。',
    });
    
  } catch (error) {
    console.error('[Upload API] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '上传失败' },
      { status: 500 }
    );
  }
}

// 删除临时文件
export async function DELETE(request: NextRequest) {
  const fileName = request.nextUrl.searchParams.get('fileName');
  
  if (!fileName) {
    return NextResponse.json(
      { error: '未提供文件名' },
      { status: 400 }
    );
  }
  
  // 安全检查：防止路径遍历
  if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
    return NextResponse.json(
      { error: '无效的文件名' },
      { status: 400 }
    );
  }
  
  const filePath = path.join(UPLOAD_DIR, fileName);
  
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log('[Upload API] Deleted file:', fileName);
    }
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Upload API] Delete error:', error);
    return NextResponse.json(
      { error: '删除失败' },
      { status: 500 }
    );
  }
}
