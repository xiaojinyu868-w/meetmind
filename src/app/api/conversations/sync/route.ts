import { NextRequest, NextResponse } from 'next/server';
import { authService } from '@/lib/services/auth-service';
import {
  AccountConversationMutationError,
  getAccountConversationSnapshot,
  syncAccountConversationMutations,
} from '@/lib/services/account-conversation-service';
import { applyRateLimit } from '@/lib/utils/rate-limit';
import { createLogger } from '@/lib/logger';

const log = createLogger('api/conversations/sync');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getAuthPayload(request: NextRequest) {
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return null;
  return authService.verifyToken(authorization.slice(7));
}

export async function GET(request: NextRequest) {
  const rateLimit = await applyRateLimit(request, 'default');
  if (rateLimit) return rateLimit;
  const auth = getAuthPayload(request);
  if (!auth) return NextResponse.json({ success: false, error: '未授权' }, { status: 401 });
  try {
    const pinnedConversationId = request.nextUrl.searchParams.get('conversationId')?.trim();
    const snapshot = pinnedConversationId
      ? await getAccountConversationSnapshot(auth.sub, { pinnedConversationId })
      : await getAccountConversationSnapshot(auth.sub);
    return NextResponse.json({ success: true, ...snapshot });
  } catch (error) {
    log.error('account conversation snapshot failed', { error: String(error) });
    return NextResponse.json({ success: false, error: '读取账号对话失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const rateLimit = await applyRateLimit(request, 'default');
  if (rateLimit) return rateLimit;
  const auth = getAuthPayload(request);
  if (!auth) return NextResponse.json({ success: false, error: '未授权' }, { status: 401 });
  try {
    const body = await request.json().catch(() => null) as {
      conversations?: unknown;
      messages?: unknown;
    } | null;
    if (!body) return NextResponse.json({ success: false, error: '请求体格式错误' }, { status: 400 });
    const result = await syncAccountConversationMutations({
      userId: auth.sub,
      conversations: body.conversations,
      messages: body.messages,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof AccountConversationMutationError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: error.code === 'CONFLICT' ? 409 : 400 },
      );
    }
    log.error('account conversation mutation failed', { error: String(error) });
    return NextResponse.json({ success: false, error: '保存账号对话失败' }, { status: 500 });
  }
}
