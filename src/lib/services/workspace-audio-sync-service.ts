/**
 * Workspace 录音文件与课堂 capture 的服务端绑定。
 *
 * 上传接口只知道 userId + sessionId，不依赖前端还记得 capture sourceKey。
 * 这样刷新、断网恢复或下次登录重试时，成功上传的原声仍能自动接回那节课。
 */

import prisma from '@/lib/prisma';

function parseMetadata(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export async function attachUploadedAudioToWorkspaceCapture(params: {
  userId: string;
  sessionId: string;
  mediaUrl: string;
}): Promise<{ captureId: string } | null> {
  const { userId, sessionId, mediaUrl } = params;
  const candidates = await prisma.workspaceCapture.findMany({
    where: {
      userId,
      status: { not: 'deleted' },
      metadataJson: { contains: sessionId },
    },
    select: { id: true, metadataJson: true },
    orderBy: { updatedAt: 'desc' },
    take: 10,
  });

  const capture = candidates.find((candidate) => {
    const metadata = parseMetadata(candidate.metadataJson);
    return metadata.sessionId === sessionId || metadata.localSessionId === sessionId;
  });
  if (!capture) return null;

  const metadata = parseMetadata(capture.metadataJson);
  await prisma.workspaceCapture.update({
    where: { id: capture.id },
    data: {
      mediaUrl,
      metadataJson: JSON.stringify({
        ...metadata,
        sessionId,
        audioUploaded: true,
        audioSyncedAt: new Date().toISOString(),
      }),
    },
  });

  return { captureId: capture.id };
}
