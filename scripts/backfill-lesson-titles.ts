#!/usr/bin/env npx tsx
/**
 * backfill-lesson-titles.ts —— 给存量零信息标题（「课堂录音」「录音 14:32」「图片材料」…）
 * 重新起名。走的是产品自己的路径（lesson-title-service.backfillGenericLessonTitles），
 * 用户手动改过的标题（titleSource='user'）永远不碰。
 *
 * 背景（2026-09）：零信息判定此前在服务端不认「课堂录音」，线上 152 条课永远停在
 * 这个名字上；标题质量门用 includes 黑名单把「机器学习」整个打回并永久打标。两处都
 * 修了之后，用这个脚本把历史补齐——之后新课由 stop 路径 / 落库安全网 / 进应用时的
 * 10 条回填自然接管。
 *
 * 用法：
 *   make titles-backfill                 # 干跑：只统计每个用户有多少条候选
 *   APPLY=1 make titles-backfill         # 真写：每用户每轮最多 LIMIT 条（默认 20），循环到没有候选
 *   APPLY=1 LIMIT=10 USER_ID=<userId> make titles-backfill   # 只处理某个用户
 *   RESET_GATE_MARKS=1 APPLY=1 make titles-backfill          # 质量门改过之后：先清掉旧的"出不来主题"打标再跑
 */
import { loadEnvConfig } from '@next/env';
import { isPlaceholderLessonTitle } from '@/lib/learning/lesson-title-generic';

async function main() {
  loadEnvConfig(process.cwd());
  const { default: prisma } = await import('@/lib/prisma');
  const { backfillGenericLessonTitles } = await import('@/lib/services/lesson-title-service');

  const apply = process.env.APPLY === '1';
  const limit = Math.max(1, Number(process.env.LIMIT) || 20);
  const onlyUser = process.env.USER_ID?.trim() || process.env.USER?.trim();
  // 注意：shell 里 $USER 通常是系统用户名（root），只在显式像 userId 时才当筛选条件
  const userFilter = onlyUser && onlyUser.length >= 16 ? onlyUser : undefined;

  const captures = await prisma.workspaceCapture.findMany({
    where: {
      status: { not: 'deleted' },
      normalizedText: { not: null },
      ...(userFilter ? { userId: userFilter } : {}),
    },
    select: { id: true, userId: true, title: true, normalizedText: true, metadataJson: true },
  });

  if (apply && process.env.RESET_GATE_MARKS === '1') {
    let cleared = 0;
    for (const capture of captures) {
      const metadataJson = capture.metadataJson;
      if (!metadataJson || !metadataJson.includes('titleBackfillGateV2FailedAt')) continue;
      const metadata = JSON.parse(metadataJson) as Record<string, unknown>;
      delete metadata.titleBackfillGateV2FailedAt;
      await prisma.workspaceCapture.update({ where: { id: capture.id }, data: { metadataJson: JSON.stringify(metadata) } });
      cleared += 1;
    }
    console.log(`[titles] cleared ${cleared} gate marks`);
  }

  const byUser = new Map<string, { candidates: number; locked: number }>();
  for (const capture of captures) {
    if (!capture.userId) continue; // 匿名/影子收集没有归属用户，回填是按用户走的
    if (!isPlaceholderLessonTitle(capture.title)) continue;
    if ((capture.normalizedText || '').trim().length < 80) continue;
    let locked = false;
    try {
      locked = (JSON.parse(capture.metadataJson || '{}') as { titleSource?: string }).titleSource === 'user';
    } catch { /* ignore */ }
    const userId: string = capture.userId;
    const entry = byUser.get(userId) ?? { candidates: 0, locked: 0 };
    if (locked) entry.locked += 1; else entry.candidates += 1;
    byUser.set(userId, entry);
  }

  const totalCandidates = [...byUser.values()].reduce((sum, v) => sum + v.candidates, 0);
  console.log(`[titles] ${captures.length} captures scanned · ${totalCandidates} placeholder titles with enough text · ${byUser.size} users`);
  for (const [userId, entry] of byUser) {
    console.log(`  ${userId}  candidates=${entry.candidates}  user-locked=${entry.locked}`);
  }
  if (!apply) {
    console.log('[titles] dry run. Set APPLY=1 to retitle.');
    await prisma.$disconnect();
    return;
  }

  let totalRetitled = 0;
  for (const [userId, entry] of byUser) {
    if (entry.candidates === 0) continue;
    let rounds = 0;
    // 每轮最多 limit 条；retitled 为 0 说明剩下的都是打标/锁定/太短，停止
    while (rounds < 20) {
      rounds += 1;
      const result = await backfillGenericLessonTitles({ userId, limit, scanLimit: 5_000 });
      totalRetitled += result.retitled;
      console.log(`  ${userId} round ${rounds}: scanned=${result.scanned} retitled=${result.retitled} skipped=${result.skipped}`);
      if (result.retitled === 0) break;
    }
  }
  console.log(`[titles] done. retitled=${totalRetitled}`);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('[titles] failed:', error);
  process.exit(1);
});
