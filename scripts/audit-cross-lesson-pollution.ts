/**
 * 跨课污染对账（只读审计，不做任何删除/修改）。
 *
 * 背景：A1 修复前，useTranscriptIngest 会把上一次导入新建的会话音频并入
 * 当前课，产生「资料 A 的转写出现在课程 B」的污染。本脚本按 capture 对账：
 *
 * 启发式（命中即可疑，需人工复核后决定清理）：
 * 1. 同一 capture 的 transcriptSegments 出现 >1 个 distinct sessionId
 *    （导入护栏修复前，新 capture 会拼接上一会话的段）；
 * 2. capture.metadata.from === 'transcript-ingest' 且 metadata.sessionId
 *    与该 capture 段的主导 sessionId 不一致；
 * 3. 命中 1 的会话：列出每个 sessionId 贡献的段数与文本量，供判断哪部分
 *    是外来的。
 *
 * 用法：npx tsx scripts/audit-cross-lesson-pollution.ts
 * 产出：stdout 表格 + out/audit/cross-lesson-pollution.json
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { prisma } from '../src/lib/prisma';

interface SessionSplit {
  sessionId: string;
  segments: number;
  chars: number;
}

interface FlaggedCapture {
  captureId: string;
  title: string;
  userId: string | null;
  role: string;
  from: string | null;
  metadataSessionId: string | null;
  createdAt: string;
  reason: string;
  sessionSplits: SessionSplit[];
}

async function main() {
  const captures = await prisma.workspaceCapture.findMany({
    where: { status: 'active' },
    select: {
      id: true,
      title: true,
      userId: true,
      role: true,
      metadataJson: true,
      createdAt: true,
    },
  });

  const flagged: FlaggedCapture[] = [];

  for (const capture of captures) {
    let metadata: Record<string, unknown> = {};
    try {
      metadata = capture.metadataJson ? JSON.parse(capture.metadataJson) : {};
    } catch {
      continue;
    }
    const from = typeof metadata.from === 'string' ? metadata.from : null;
    const metadataSessionId =
      typeof metadata.sessionId === 'string' ? metadata.sessionId : null;

    // 只看导入类 capture（课堂实录不在本次污染面内）
    if (from !== 'transcript-ingest') continue;

    const segments = await prisma.workspaceTranscriptSegment.findMany({
      where: { captureId: capture.id },
      select: { sessionId: true, text: true, position: true },
      orderBy: { position: 'asc' },
    });
    if (segments.length === 0) continue;

    const bySession = new Map<string, { segments: number; chars: number }>();
    for (const seg of segments) {
      const bucket = bySession.get(seg.sessionId) ?? { segments: 0, chars: 0 };
      bucket.segments += 1;
      bucket.chars += seg.text.length;
      bySession.set(seg.sessionId, bucket);
    }

    const sessionSplits: SessionSplit[] = [...bySession.entries()]
      .map(([sessionId, v]) => ({ sessionId, ...v }))
      .sort((a, b) => b.segments - a.segments);

    const dominantSessionId = sessionSplits[0].sessionId;
    const reasons: string[] = [];

    if (bySession.size > 1) {
      reasons.push(`段跨 ${bySession.size} 个会话（主导=${dominantSessionId}）`);
    }
    if (metadataSessionId && metadataSessionId !== dominantSessionId) {
      reasons.push(`metadata.sessionId(${metadataSessionId}) ≠ 主导会话`);
    }

    if (reasons.length === 0) continue;

    flagged.push({
      captureId: capture.id,
      title: capture.title,
      userId: capture.userId,
      role: capture.role,
      from,
      metadataSessionId,
      createdAt: capture.createdAt.toISOString(),
      reason: reasons.join('；'),
      sessionSplits,
    });
  }

  mkdirSync(path.resolve(process.cwd(), 'out/audit'), { recursive: true });
  const outPath = path.resolve(process.cwd(), 'out/audit/cross-lesson-pollution.json');
  writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), flagged }, null, 2));

  console.log(`审计完成：${flagged.length} 个可疑 capture（只读，未做任何修改）`);
  for (const f of flagged) {
    console.log(`\n[${f.captureId}] ${f.title}`);
    console.log(`  用户=${f.userId ?? '(匿名)'}  创建=${f.createdAt}`);
    console.log(`  原因：${f.reason}`);
    for (const s of f.sessionSplits) {
      console.log(`    - 会话 ${s.sessionId}: ${s.segments} 段 / ${s.chars} 字`);
    }
  }
  console.log(`\n明细已写入 ${outPath}`);
}

main()
  .catch((e) => {
    console.error('审计失败：', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
