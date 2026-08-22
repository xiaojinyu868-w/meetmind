// 清小搭产物文件托管 — GET /api/compat/v1/files/[name]
//
// 服务 rehearsal-artifacts.ts 生成的讲稿产物（docx 附件 + 在线上场包页）。
// 免 Bearer：清小搭前端渲染附件卡片 / 用户点开链接都是直接 GET，不带凭证；
// 访问控制靠 32 位 hex 不可猜文件名（与仓库 /api/workspace/audio/* 档位2 同策略，
// 见 ../DOMAIN.md 取舍说明）。文件 24h 后由写入侧懒清理，过期自然 404。
// name 严格校验 ^[a-f0-9]{32}\.(docx|html)$ 防路径穿越。

import { promises as fsp } from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';
import { XIAODA_FILES_DIR, XIAODA_FILE_NAME_RE } from '../../rehearsal-artifacts';

export const runtime = 'nodejs';

function notFound(): Response {
  return new Response(JSON.stringify({ error: { type: 'not_found', message: 'file not found or expired' } }), {
    status: 404,
    headers: { 'content-type': 'application/json' },
  });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { name: string } },
): Promise<Response> {
  const name = params.name;
  if (!XIAODA_FILE_NAME_RE.test(name)) return notFound();

  let data: Buffer;
  try {
    data = await fsp.readFile(path.join(XIAODA_FILES_DIR, name));
  } catch {
    return notFound();
  }

  if (name.endsWith('.docx')) {
    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent('试讲讲稿.docx')}`,
        'content-length': String(data.length),
      },
    });
  }
  return new Response(new Uint8Array(data), {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-length': String(data.length),
    },
  });
}
