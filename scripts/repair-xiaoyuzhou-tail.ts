#!/usr/bin/env npx tsx
/**
 * repair-xiaoyuzhou-tail.ts —— 按时间覆盖度修复播客分段表（一次性）
 *
 * repair-xiaoyuzhou-capture.ts 走全量替换，受「单调递增护栏」段数比较约束；
 * ASR 每轮分段粒度有随机性（1235 → 1184），段数少但覆盖更全的结果会被护栏拦下。
 * 本脚本改为按「覆盖时长」比较：新结果覆盖更久才整表替换。
 *
 * 用法：npx tsx scripts/repair-xiaoyuzhou-tail.ts <sourceKey> <episodeUrl>
 */
import 'dotenv/config';
import prisma from '@/lib/prisma';

async function main() {
  const [sourceKey, episodeUrl] = process.argv.slice(2);
  if (!sourceKey || !episodeUrl) {
    console.error('Usage: npx tsx scripts/repair-xiaoyuzhou-tail.ts <sourceKey> <episodeUrl>');
    process.exit(1);
  }

  const capture = await prisma.workspaceCapture.findUnique({ where: { sourceKey } });
  if (!capture) throw new Error(`capture not found: ${sourceKey}`);
  const meta = capture.metadataJson ? JSON.parse(capture.metadataJson) : {};
  const sessionId = meta.sessionId as string;
  if (!sessionId) throw new Error('capture metadata has no sessionId');

  const currentMax = await prisma.workspaceTranscriptSegment.aggregate({
    where: { captureId: capture.id },
    _max: { endMs: true },
    _count: true,
  });
  console.log('[tail] current:', { count: currentMax._count, maxEndMs: currentMax._max.endMs });

  const baseUrl = (process.env.WECHAT_MP_PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || '3002'}`).replace(/\/+$/, '');
  const response = await fetch(`${baseUrl}/api/video/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: episodeUrl, mode: 'turbo', language: 'zh' }),
  });
  const payload = await response.json() as {
    success?: boolean;
    error?: string;
    text?: string;
    segments?: Array<{ id?: string; text?: string; startMs?: number; endMs?: number }>;
  };
  if (!response.ok || !payload.success || !payload.segments?.length) {
    throw new Error(`import failed: ${payload.error || response.status}`);
  }

  const segments = payload.segments
    .filter((s) => typeof s.text === 'string' && s.text.trim())
    .map((s, position) => ({
      captureId: capture.id,
      sessionId,
      segmentKey: `${s.id || 'seg'}:${position}`,
      position,
      startMs: Math.max(0, Math.round(s.startMs || 0)),
      endMs: Math.max(Math.round(s.startMs || 0), Math.round(s.endMs || 0)),
      text: s.text!.trim(),
      isFinal: true,
    }));
  const newMaxEndMs = segments[segments.length - 1].endMs;
  console.log('[tail] new:', { count: segments.length, maxEndMs: newMaxEndMs });

  if (newMaxEndMs <= (currentMax._max.endMs || 0)) {
    console.log('[tail] new coverage not better, keep existing table');
    return;
  }

  await prisma.$transaction([
    prisma.workspaceTranscriptSegment.deleteMany({ where: { captureId: capture.id } }),
    prisma.workspaceTranscriptSegment.createMany({ data: segments }),
  ]);
  await prisma.workspaceCapture.update({
    where: { id: capture.id },
    data: {
      normalizedText: (payload.text || segments.map((s) => s.text).join('')).slice(0, 200000),
      metadataJson: JSON.stringify({ ...meta, segmentCount: segments.length }),
    },
  });
  console.log('[tail] replaced:', { count: segments.length, maxEndMs: newMaxEndMs });
}

main().finally(() => prisma.$disconnect());
