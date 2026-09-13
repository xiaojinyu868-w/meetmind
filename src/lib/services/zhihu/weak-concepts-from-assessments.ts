/**
 * 复习页「继续看」的输入：这位学生在这节课的复习里，哪些概念没稳。
 * 从 LearningEvent(type='assessment') 里按 sessionId 取最近几次交卷，统计没稳的概念（按出现次数），最多 3 个。
 * 只读事实表，不下判断；没有交卷记录 → 空数组（页面会说"先做一套题"）。
 */

import prisma from '@/lib/prisma';

const WEAK_OUTCOMES = new Set(['wrong', 'missed', 'blind-spot', 'aware-gap', 'productive-struggle', 'uncovered']);

interface AssessmentPayload {
  sessionId?: string;
  items?: Array<{ concept?: string; outcome?: string }>;
}

export function weakConceptsFromPayloads(payloads: AssessmentPayload[], max = 3): string[] {
  const score = new Map<string, number>();
  for (const payload of payloads) {
    for (const item of payload.items ?? []) {
      const concept = (item.concept ?? '').trim();
      if (!concept || concept.length < 2) continue;
      if (WEAK_OUTCOMES.has(item.outcome ?? '')) score.set(concept, (score.get(concept) ?? 0) + 1);
    }
  }
  return [...score.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([concept]) => concept);
}

export async function weakConceptsForSession(userId: string, sessionId: string, max = 3): Promise<string[]> {
  const rows = await prisma.learningEvent.findMany({
    where: { userId, type: 'assessment', payloadJson: { contains: `"sessionId":"${sessionId}"` } },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { payloadJson: true },
  });
  const payloads: AssessmentPayload[] = [];
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.payloadJson) as AssessmentPayload;
      if (parsed?.sessionId === sessionId) payloads.push(parsed);
    } catch {
      // 坏行跳过
    }
  }
  return weakConceptsFromPayloads(payloads, max);
}
