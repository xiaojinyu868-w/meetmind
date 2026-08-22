import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * GET /api/board/hanzi/[char] —— hanzi-writer 笔画数据自托管。
 *
 * 原链路走 jsDelivr CDN，实测每字 1~3s（国内更差），逐字笔顺动画每个新字
 * 都要等网络，是板书书写卡顿/段间停顿的最大来源。改为读本地
 * node_modules/hanzi-writer-data（47MB 静态数据包，pnpm 依赖），
 * 进程内 Map 缓存 + immutable 浏览器缓存，单次读取 ~0ms。
 *
 * 授权：数据包为 Arphic Public License（包内 ARPHICPL.TXT），允许再分发。
 */

// server.js 以仓库根为 cwd 运行；不用 require.resolve——该包 index.js 被 require 即抛错
const DATA_DIR = join(process.cwd(), 'node_modules', 'hanzi-writer-data');

// 只允许单个 CJK 统一表意文字（防目录穿越 & 无关文件读取）
const CJK_SINGLE_RE = /^[㐀-䶿一-鿿豈-﫿]$/;

const memCache = new Map<string, unknown>();

export async function GET(_request: Request, { params }: { params: Promise<{ char: string }> }) {
  const { char: raw } = await params;
  // 兼容 <char>.json 形式的尾缀（与 CDN URL 形状一致）
  const char = decodeURIComponent(raw).replace(/\.json$/, '');
  if (!CJK_SINGLE_RE.test(char)) {
    return NextResponse.json({ error: '仅支持单个 CJK 字符' }, { status: 400 });
  }

  const cached = memCache.get(char);
  if (cached) {
    return NextResponse.json(cached, {
      headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
    });
  }

  try {
    const text = await readFile(`${DATA_DIR}/${char}.json`, 'utf8');
    const data = JSON.parse(text) as unknown;
    memCache.set(char, data);
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
    });
  } catch {
    return NextResponse.json({ error: '无该字笔画数据' }, { status: 404 });
  }
}
