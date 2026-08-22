#!/usr/bin/env npx tsx
/**
 * repair-xiaoyuzhou-capture.ts —— 修复被降级链损坏的播客收集（一次性数据修复）
 *
 * 背景：早期版本有三重截断/回刷 bug（enrich 500 段上限、客户端轻量回刷把
 * 分段表删成 1 条整段兜底、normalizedText 被摘要片段覆盖）。代码已修复，
 * 本脚本对既有受害收集重跑导入管线，把全量分段/全文/标题补回来。
 *
 * 用法：
 *   npx tsx scripts/repair-xiaoyuzhou-capture.ts <sourceKey> <episodeUrl>
 *
 * 注意：
 *   - 内部走 triggerVideoImportPipeline → HTTP 调本机 /api/video/import，
 *     未带用户身份，积分走匿名影子流水，不会对绑定用户重复结算。
 *   - 不触发微信客服推送（finalize 不在此路径上）。
 */
import 'dotenv/config';
import { triggerVideoImportPipeline } from '@/lib/services/wechat-video-enrich-service';
import prisma from '@/lib/prisma';

async function main() {
  const [sourceKey, episodeUrl] = process.argv.slice(2);
  if (!sourceKey || !episodeUrl) {
    console.error('Usage: npx tsx scripts/repair-xiaoyuzhou-capture.ts <sourceKey> <episodeUrl>');
    process.exit(1);
  }

  const before = await prisma.workspaceCapture.findUnique({ where: { sourceKey } });
  if (!before) {
    console.error(`capture not found: ${sourceKey}`);
    process.exit(1);
  }
  const beforeSegments = await prisma.workspaceTranscriptSegment.count({ where: { captureId: before.id } });
  console.log('[repair] before:', {
    id: before.id,
    title: before.title,
    normalizedTextLen: before.normalizedText?.length ?? 0,
    tableSegments: beforeSegments,
  });

  const result = await triggerVideoImportPipeline(`repair-${Date.now()}`, episodeUrl, sourceKey);
  console.log('[repair] pipeline result:', result);
  if (!result.ok) process.exit(2);

  const after = await prisma.workspaceCapture.findUnique({ where: { sourceKey } });
  const afterSegments = await prisma.workspaceTranscriptSegment.count({ where: { captureId: before.id } });
  const lastSegment = await prisma.workspaceTranscriptSegment.findFirst({
    where: { captureId: before.id },
    orderBy: { position: 'desc' },
    select: { endMs: true },
  });
  console.log('[repair] after:', {
    title: after?.title,
    normalizedTextLen: after?.normalizedText?.length ?? 0,
    tableSegments: afterSegments,
    lastSegmentEndMs: lastSegment?.endMs,
  });
}

main().finally(() => prisma.$disconnect());
