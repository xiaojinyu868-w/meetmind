import { NextRequest, NextResponse } from 'next/server';
import { ensureWechatInboxMessageHydrated } from '@/lib/services/wechat-inbox-service';

export const runtime = 'nodejs';

function parseEchoChips(value?: string | null): string[] {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => String(item)).filter(Boolean).slice(0, 4);
  } catch {
    return [];
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const message = await ensureWechatInboxMessageHydrated(token);

  if (!message) {
    return NextResponse.json(
      { success: false, error: '没有找到这条微信收集。' },
      { status: 404 }
    );
  }

  return NextResponse.json({
    success: true,
    message: {
      linkToken: message.linkToken,
      msgType: message.msgType,
      eventType: message.eventType,
      normalizedText: message.normalizedText,
      previewText: message.previewText,
      sourceUrl: message.sourceUrl,
      mediaId: message.mediaId,
      mediaUrl: message.mediaUrl,
      title: message.title,
      reachKind: message.reachKind,
      reachChannel: message.reachChannel,
      messageAt: message.messageAt?.toISOString() || null,
      replyText: message.replyText,
      userId: message.userId,
      workspaceId: message.workspaceId,
      workspace: message.workspace
        ? {
            id: message.workspace.id,
            name: message.workspace.name,
            kind: message.workspace.kind,
            status: message.workspace.status,
          }
        : null,
      bindingStatus: message.bindingStatus,
      collectionRole: message.collectionRole,
      echoTitle: message.echoTitle,
      echoBody: message.echoBody,
      echoChips: parseEchoChips(message.echoChipsJson),
      tutorContext: message.tutorContext,
      status: message.status,
    },
  });
}
