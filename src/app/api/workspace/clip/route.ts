/**
 * POST /api/workspace/clip — 口袋剪藏：任何应用里选中的一段 → 一条有根、格式不丢的收集
 *
 * 桌面壳（也可以是浏览器扩展 / 口袋窗的粘贴）送原料：
 *   { text?, html?, source?: { app, windowTitle, url, pageTitle }, occurredAt?, clientId? }
 * 服务端做转换（HTML → Markdown，KaTeX 原始 TeX、代码块语言、UI 渣清理）、来源命名、分组键，
 * 写一条 sourceType='desktop-clip' 的 capture。返回给回执用的最小信息；撤销走 DELETE /api/workspace/captures。
 *
 * clientId 幂等：离线队列补传同一条不会落两次（sourceKey = clip-<clientId>，upsert 语义）。
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authService } from '@/lib/services/auth-service';
import { createPocketClip } from '@/lib/services/pocket-clip-service';
import { createLogger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('workspace/clip');

const BodySchema = z.object({
  text: z.string().max(60_000).optional(),
  html: z.string().max(400_000).optional(),
  source: z.object({
    app: z.string().max(120).optional(),
    windowTitle: z.string().max(400).optional(),
    url: z.string().max(2_000).optional(),
    pageTitle: z.string().max(400).optional(),
  }).optional(),
  occurredAt: z.string().max(40).optional(),
  clientId: z.string().max(80).optional(),
}).refine((body) => Boolean(body.text?.trim() || body.html?.trim()), { message: 'text 或 html 至少一个' });

function getAuthPayload(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  return authService.verifyToken(authHeader.slice(7));
}

export async function POST(request: NextRequest) {
  try {
    const payload = getAuthPayload(request);
    if (!payload) {
      return NextResponse.json({ success: false, error: '未授权' }, { status: 401 });
    }
    const parsed = BodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: '剪藏内容不完整' }, { status: 400 });
    }

    const created = await createPocketClip(payload.sub, parsed.data);
    if (!created) {
      // HTML 只有按钮 / 图标、纯文本也为空：没有可收的东西，诚实告诉客户端
      return NextResponse.json({ success: false, error: 'EMPTY_CLIP' }, { status: 422 });
    }

    return NextResponse.json({
      success: true,
      capture: {
        id: created.capture.id,
        sourceKey: created.capture.sourceKey,
        title: created.capture.title,
        previewText: created.capture.previewText,
        occurredAt: created.capture.occurredAt,
        sourceLabel: created.draft.sourceLabel,
        hasMath: created.draft.hasMath,
        charCount: created.draft.plainText.length,
      },
    });
  } catch (error) {
    log.error('pocket clip failed', error);
    return NextResponse.json({ success: false, error: '这次没收进来' }, { status: 500 });
  }
}
