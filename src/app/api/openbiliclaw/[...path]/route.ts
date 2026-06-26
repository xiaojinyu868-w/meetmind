/**
 * OpenBiliClaw 代理 route — M15 Phase 2
 *
 * 把 /api/openbiliclaw/[...path] 代理到本地 OpenBiliClaw 后端 (localhost:8420)。
 * 这样 MeetMind 前端同源调用，无 CORS / https 混合内容问题。
 */

import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.OPENBILICLAW_API_URL || 'http://127.0.0.1:8420';

async function proxy(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: pathSegments } = await params;
  const path = pathSegments.join('/');
  const search = request.nextUrl.search;
  const url = `${BACKEND_URL}/api/${path}${search}`;

  const headers = new Headers();
  const contentType = request.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);

  const init: RequestInit = {
    method: request.method,
    headers,
  };

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = await request.text();
  }

  try {
    const response = await fetch(url, init);
    const data = await response.text();
    const respHeaders = new Headers();
    const respContentType = response.headers.get('content-type');
    if (respContentType) respHeaders.set('content-type', respContentType);
    return new NextResponse(data, { status: response.status, headers: respHeaders });
  } catch {
    return NextResponse.json(
      { ok: false, error: 'OpenBiliClaw 不可用' },
      { status: 502 },
    );
  }
}

export const GET = proxy;
export const POST = proxy;
export const DELETE = proxy;
export const PUT = proxy;
