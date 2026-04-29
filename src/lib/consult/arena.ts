import type { UIMessage } from 'ai';

export type ArenaSeverity = 'critical' | 'major' | 'minor';

export interface ArenaCriterion {
  id: string;
  label: string;
  severity: ArenaSeverity;
  passed: boolean;
  evidence: string;
}

export interface ArenaCaseScore {
  caseId: string;
  title: string;
  prompt: string;
  status: 'passed' | 'failed' | 'needs-run';
  score: number;
  maxScore: number;
  criteria: ArenaCriterion[];
}

interface ToolTrace {
  name: string;
  index: number;
  input?: unknown;
  output?: unknown;
  state?: string;
}

const PERCY_PROMPT = '我想申请 Stanford NLP，帮我看看怎么联系 Percy Liang';

export function evaluatePercyFlagshipCase(
  messages: UIMessage[],
  profile: Record<string, unknown> = {},
): ArenaCaseScore {
  const tools = extractToolTrace(messages);
  const criteria: ArenaCriterion[] = [
    evaluateIntentFirst(tools),
    evaluateAdvisorDiscovery(tools),
    evaluateGroundedSearch(tools),
    evaluateProfileNotLocked(tools, profile),
    evaluateNoPrematureCta(tools),
  ];
  const score = criteria.filter((c) => c.passed).length;
  return {
    caseId: 'flagship-stanford-percy',
    title: 'Stanford NLP / Percy Liang 旗舰体验',
    prompt: PERCY_PROMPT,
    status: criteria.every((c) => c.passed) ? 'passed' : 'failed',
    score,
    maxScore: criteria.length,
    criteria,
  };
}

export function hasPercyFlagshipPrompt(messages: UIMessage[]): boolean {
  const text = messages
    .filter((m) => m.role === 'user')
    .flatMap((m) => m.parts ?? [])
    .map((part) => (part.type === 'text' ? (part as { text?: string }).text ?? '' : ''))
    .join('\n')
    .toLowerCase();
  return text.includes('stanford') && text.includes('percy liang');
}

function extractToolTrace(messages: UIMessage[]): ToolTrace[] {
  const trace: ToolTrace[] = [];
  let index = 0;
  for (const message of messages) {
    for (const part of message.parts ?? []) {
      if (typeof part.type !== 'string' || !part.type.startsWith('tool-')) continue;
      const tool = part as { type: string; input?: unknown; output?: unknown; state?: string };
      trace.push({
        name: tool.type.slice('tool-'.length),
        index,
        input: tool.input,
        output: tool.output,
        state: tool.state,
      });
      index += 1;
    }
  }
  return trace;
}

function findTool(tools: ToolTrace[], name: string): ToolTrace | undefined {
  return tools.find((tool) => tool.name === name);
}

function evaluateIntentFirst(tools: ToolTrace[]): ArenaCriterion {
  const firstVisible = tools.find((tool) =>
    !['readProfile', 'writeProfile', 'webSearch', 'searchProgramRequirements', 'useSkill'].includes(tool.name),
  );
  const passed = firstVisible?.name === 'showConsultantMove' || firstVisible?.name === 'showAdvisorDiscovery';
  return {
    id: 'intent-first',
    label: '先判断意图，而不是先塞 workflow',
    severity: 'critical',
    passed,
    evidence: firstVisible ? `第一个可见 UI：${firstVisible.name}` : '没有可见 UI block',
  };
}

function evaluateAdvisorDiscovery(tools: ToolTrace[]): ArenaCriterion {
  const discovery = findTool(tools, 'showAdvisorDiscovery');
  const outreach = findTool(tools, 'showOutreachWorkspace');
  const draft = findTool(tools, 'showDraft');
  const passed = Boolean(discovery) && (!outreach || discovery!.index < outreach.index) && (!draft || discovery!.index < draft.index);
  return {
    id: 'advisor-discovery',
    label: '导师摇摆期使用探索工作台',
    severity: 'critical',
    passed,
    evidence: discovery
      ? `showAdvisorDiscovery 在第 ${discovery.index + 1} 个 tool`
      : '没有调用 showAdvisorDiscovery',
  };
}

function evaluateGroundedSearch(tools: ToolTrace[]): ArenaCriterion {
  const searches = tools.filter((tool) => tool.name === 'webSearch');
  const hit = searches.find((tool) => {
    const query = stringField(tool.input, 'query').toLowerCase();
    return query.includes('percy liang') && query.includes('stanford');
  });
  const citations = Array.isArray((hit?.output as { citations?: unknown[] } | undefined)?.citations)
    ? ((hit?.output as { citations?: unknown[] }).citations ?? [])
    : [];
  const passed = Boolean(hit) && citations.length > 0;
  return {
    id: 'grounded-search',
    label: '查到真实来源再谈导师近况',
    severity: 'major',
    passed,
    evidence: hit
      ? `query="${stringField(hit.input, 'query').slice(0, 96)}"，citations=${citations.length}`
      : '没有 Percy Liang + Stanford 的精准检索',
  };
}

function evaluateProfileNotLocked(tools: ToolTrace[], profile: Record<string, unknown>): ArenaCriterion {
  const lockFromWrite = tools.some((tool) => {
    if (tool.name !== 'writeProfile') return false;
    return advisorCandidates(valueAt(tool.input, ['patch', 'advisor_candidates'])).some(isLockedPercy);
  });
  const lockFromProfile = advisorCandidates(profile.advisor_candidates).some(isLockedPercy);
  const mentioned = advisorCandidates(profile.advisor_candidates).some((candidate) =>
    String(candidate.name ?? '').toLowerCase().includes('percy liang'),
  );
  return {
    id: 'profile-not-locked',
    label: '不把 Percy 试探性兴趣锁死进画像',
    severity: 'critical',
    passed: !lockFromWrite && !lockFromProfile,
    evidence: lockFromWrite || lockFromProfile
      ? '发现 Percy 被写成 shortlisted/starred/locked'
      : mentioned
        ? 'Percy 仅作为提及/探索候选保留'
        : '未把 Percy 写成长期候选',
  };
}

function evaluateNoPrematureCta(tools: ToolTrace[]): ArenaCriterion {
  const cta = findTool(tools, 'ctaWechat');
  return {
    id: 'no-premature-cta',
    label: '首轮探索不急着留资',
    severity: 'major',
    passed: !cta,
    evidence: cta ? `ctaWechat 出现在第 ${cta.index + 1} 个 tool` : '没有过早 CTA',
  };
}

function stringField(input: unknown, key: string): string {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return '';
  const value = (input as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : '';
}

function valueAt(input: unknown, path: string[]): unknown {
  let cursor = input;
  for (const key of path) {
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
}

function advisorCandidates(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item && typeof item === 'object' && !Array.isArray(item)) as Array<Record<string, unknown>>;
}

function isLockedPercy(candidate: Record<string, unknown>): boolean {
  const name = String(candidate.name ?? '').toLowerCase();
  if (!name.includes('percy liang')) return false;
  const status = String(candidate.status ?? '').toLowerCase();
  return status === 'shortlisted' || status === 'locked' || candidate.starred === true;
}
