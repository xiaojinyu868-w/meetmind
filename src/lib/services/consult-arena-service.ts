import type { UIMessage } from 'ai';
import { evaluatePercyFlagshipCase, hasPercyFlagshipPrompt, type ArenaCaseScore } from '@/lib/consult/arena';
import { prisma } from '@/lib/prisma';

export interface ConsultArenaOverview {
  summary: {
    total: number;
    passed: number;
    failed: number;
    needsRun: number;
  };
  cases: Array<ArenaCaseScore & {
    lastRunAt?: string;
    sessionId?: string;
    studentKey?: string;
  }>;
}

export async function getConsultArenaOverview(orgId: string): Promise<ConsultArenaOverview> {
  const sessions = await prisma.consultSession.findMany({
    where: { orgId },
    orderBy: { updatedAt: 'desc' },
    take: 50,
    select: {
      id: true,
      studentKey: true,
      messagesJson: true,
      updatedAt: true,
    },
  });

  const hit = sessions
    .map((session) => ({ session, messages: safeMessages(session.messagesJson) }))
    .find(({ messages }) => hasPercyFlagshipPrompt(messages));

  let flagship: ConsultArenaOverview['cases'][number];
  if (hit) {
    const student = await prisma.consultStudent.findUnique({
      where: { orgId_studentKey: { orgId, studentKey: hit.session.studentKey } },
      select: { profileJson: true },
    });
    flagship = {
      ...evaluatePercyFlagshipCase(hit.messages, safeObject(student?.profileJson ?? '{}')),
      lastRunAt: hit.session.updatedAt.toISOString(),
      sessionId: hit.session.id,
      studentKey: hit.session.studentKey,
    };
  } else {
    flagship = {
      caseId: 'flagship-stanford-percy',
      title: 'Stanford NLP / Percy Liang 旗舰体验',
      prompt: '我想申请 Stanford NLP，帮我看看怎么联系 Percy Liang',
      status: 'needs-run',
      score: 0,
      maxScore: 5,
      criteria: [
        { id: 'intent-first', label: '先判断意图，而不是先塞 workflow', severity: 'critical', passed: false, evidence: '等待真实 session' },
        { id: 'advisor-discovery', label: '导师摇摆期使用探索工作台', severity: 'critical', passed: false, evidence: '等待真实 session' },
        { id: 'grounded-search', label: '查到真实来源再谈导师近况', severity: 'major', passed: false, evidence: '等待真实 session' },
        { id: 'profile-not-locked', label: '不把 Percy 试探性兴趣锁死进画像', severity: 'critical', passed: false, evidence: '等待真实 session' },
        { id: 'no-premature-cta', label: '首轮探索不急着留资', severity: 'major', passed: false, evidence: '等待真实 session' },
      ],
    };
  }

  const cases = [flagship];
  return {
    summary: {
      total: cases.length,
      passed: cases.filter((c) => c.status === 'passed').length,
      failed: cases.filter((c) => c.status === 'failed').length,
      needsRun: cases.filter((c) => c.status === 'needs-run').length,
    },
    cases,
  };
}

function safeMessages(raw: string): UIMessage[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as UIMessage[]) : [];
  } catch {
    return [];
  }
}

function safeObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
