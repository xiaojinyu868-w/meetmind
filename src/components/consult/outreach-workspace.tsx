'use client';

import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, FileText, Mic, PenLine, Search, Upload } from 'lucide-react';
import { PixelAgentStatus } from './pixel-agent-status';
import { BlockStreamingSkeleton } from './skeletons';

export interface OutreachWorkspaceInput {
  title: string;
  advisor: {
    name: string;
    affiliation?: string;
    role?: string;
    lab?: string;
    summary: string;
  };
  judgment?: {
    verdict: string;
    confidence?: 'high' | 'medium' | 'low' | 'unknown';
    nextMove: string;
  };
  citations?: Array<{
    index?: number;
    title: string;
    url?: string;
    site?: string;
    note?: string;
  }>;
  fitMap?: Array<{
    studentAnchor: string;
    advisorSignal: string;
    outreachUse: string;
    strength?: 'strong' | 'medium' | 'weak' | 'unknown';
  }>;
  outreachPlan: {
    openingHook: string;
    studentProof: string;
    ask: string;
    risk: string;
  };
  missingEvidence?: string[];
  actions?: Array<{
    id: string;
    label: string;
    kind?: 'search' | 'draft' | 'upload' | 'voice' | 'handoff' | 'other';
    priority?: 'primary' | 'secondary';
  }>;
}

type OutreachAction = NonNullable<OutreachWorkspaceInput['actions']>[number];
type Confidence = 'high' | 'medium' | 'low' | 'unknown';
type SourceTier = 'strong' | 'reference' | 'weak';

interface OutreachWorkspaceBlockProps {
  toolCallId?: string;
  state?: 'input-streaming' | 'input-available' | 'output-available' | 'output-error';
  input?: OutreachWorkspaceInput;
  output?: unknown;
  pendingFollowup?: boolean;
  readOnly?: boolean;
  addToolResult?: (args: { tool: string; toolCallId: string; output: unknown }) => void;
}

const DEFAULT_ACTIONS = [
  { id: 'draft-from-plan', label: '按这个策略写草稿', kind: 'draft', priority: 'primary' },
  { id: 'upload-cv', label: '补一个 CV 项目', kind: 'upload', priority: 'secondary' },
  { id: 'voice-discuss', label: '语音定开头', kind: 'voice', priority: 'secondary' },
] satisfies OutreachAction[];

const CONFIDENCE_LABEL = {
  high: '高信心',
  medium: '中信心',
  low: '低信心',
  unknown: '待判断',
} as const;

const ACTION_PENDING_COPY: Record<NonNullable<OutreachAction['kind']>, string> = {
  search: '小墨正在补证据，把开头钩子查实。',
  draft: '小墨正在把策略变成一封可发的邮件。',
  upload: '等你补材料，下一步会重新对齐 fit map。',
  voice: '小墨正在准备把这几个点讲清楚。',
  handoff: '小墨正在整理给真人顾问的交接信息。',
  other: '小墨正在按你的选择继续推进。',
};

const ACTION_ICON = {
  search: Search,
  draft: PenLine,
  upload: Upload,
  voice: Mic,
  handoff: FileText,
  other: FileText,
} as const;

const SOURCE_TIER_META: Record<SourceTier, { label: string; className: string }> = {
  strong: { label: '强来源', className: 'border-ink/20 bg-card text-ink' },
  reference: { label: '参考', className: 'border-divider bg-card text-ink-secondary' },
  weak: { label: '待核实', className: 'border-divider bg-canvas text-ink-muted' },
};

const STRONG_SOURCE_RE = /(stanford\.edu|crfm|arxiv\.org|aclanthology\.org|openreview\.net|semanticscholar\.org|scholar\.google)/i;
const WEAK_SOURCE_RE = /(baidu|百科|wikipedia|medium\.com|知乎|zhihu)/i;

function sourceTier(citation: NonNullable<OutreachWorkspaceInput['citations']>[number]): SourceTier {
  const haystack = [citation.url, citation.site, citation.title].filter(Boolean).join(' ');
  if (STRONG_SOURCE_RE.test(haystack)) return 'strong';
  if (WEAK_SOURCE_RE.test(haystack)) return 'weak';
  return 'reference';
}

function inferActionKind(action: OutreachAction): NonNullable<OutreachAction['kind']> {
  if (action.kind) return action.kind;
  const text = `${action.id} ${action.label}`;
  if (/搜|查|search|paper|论文|来源/.test(text)) return 'search';
  if (/写|草稿|draft|邮件|起草/.test(text)) return 'draft';
  if (/上传|CV|材料|upload|补/.test(text)) return 'upload';
  if (/语音|聊|voice|call/.test(text)) return 'voice';
  if (/顾问|交接|微信|handoff/.test(text)) return 'handoff';
  return 'other';
}

function actionIsPrimary(action: OutreachAction, idx: number, weakEvidence: boolean): boolean {
  if (action.priority) return action.priority === 'primary';
  const kind = inferActionKind(action);
  if (weakEvidence) return kind === 'search' || idx === 0;
  return kind === 'draft' || idx === 0;
}

function confidenceFromWorkspace(input: OutreachWorkspaceInput): Confidence {
  if (input.judgment?.confidence) return input.judgment.confidence;
  const citations = input.citations ?? [];
  const hasStrongSource = citations.some((citation) => sourceTier(citation) === 'strong');
  const strongFitCount = (input.fitMap ?? []).filter((item) => item.strength === 'strong').length;
  if (hasStrongSource && strongFitCount >= 1 && (input.missingEvidence?.length ?? 0) <= 1) return 'high';
  if (citations.length > 0 && (input.fitMap?.length ?? 0) > 0) return 'medium';
  return 'low';
}

function defaultVerdict(input: OutreachWorkspaceInput): string {
  const confidence = confidenceFromWorkspace(input);
  if (confidence === 'high') {
    return `${input.advisor.name} 值得联系；现在可以写一封具体、克制的第一封邮件。`;
  }
  if (confidence === 'medium') {
    return `${input.advisor.name} 方向相关，但邮件开头还需要再补一条更硬的来源。`;
  }
  return `${input.advisor.name} 可能相关；先别泛泛套磁，补证据后再写会更稳。`;
}

function defaultNextMove(input: OutreachWorkspaceInput): string {
  const confidence = confidenceFromWorkspace(input);
  if (confidence === 'high') return '先起草邮件，再用 CV 里的具体项目收紧第二段。';
  if (confidence === 'medium') return '先确认一篇近期论文或实验室动态，再把它变成开头钩子。';
  return '先补 CV / 项目材料，或让 agent 再搜一次官方与论文来源。';
}

function strengthLabel(strength?: NonNullable<OutreachWorkspaceInput['fitMap']>[number]['strength']): string {
  if (strength === 'strong') return '强匹配';
  if (strength === 'medium') return '可尝试';
  if (strength === 'weak') return '偏弱';
  return '待证实';
}

function strengthClass(strength?: NonNullable<OutreachWorkspaceInput['fitMap']>[number]['strength']): string {
  if (strength === 'strong') return 'border-ink bg-ink text-card';
  if (strength === 'medium') return 'border-ink/20 bg-card text-ink';
  if (strength === 'weak') return 'border-divider bg-canvas text-ink-secondary';
  return 'border-divider bg-canvas text-ink-muted';
}

function SectionTitle({ children, aside }: { children: string; aside?: string }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3">
      <div className="text-[10px] uppercase tracking-wider text-ink-muted">{children}</div>
      {aside && <div className="text-[10px] text-ink-muted">{aside}</div>}
    </div>
  );
}

function SourceList({ citations }: { citations: OutreachWorkspaceInput['citations'] }) {
  if (!citations || citations.length === 0) {
    return (
      <div className="rounded-lg border border-divider bg-canvas px-3 py-2 text-[11.5px] text-ink-muted">
        暂无可展示来源；未查实信息应先留空。
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {citations.slice(0, 5).map((citation, idx) => {
        const label = citation.index ?? idx + 1;
        const tierMeta = SOURCE_TIER_META[sourceTier(citation)];
        return (
          <div key={`${citation.title}-${idx}`} className="rounded-lg border border-divider bg-card px-3 py-2">
            <div className="flex items-start gap-2 text-[11.5px] leading-relaxed">
              <span className="mt-0.5 shrink-0 text-ink-muted">[{label}]</span>
              <div className="min-w-0 flex-1">
                {citation.url ? (
                  <a
                    href={citation.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex max-w-full items-center gap-1 text-ink hover:underline underline-offset-2"
                  >
                    <span className="truncate">{citation.title}</span>
                    <ExternalLink size={11} strokeWidth={1.8} className="shrink-0 text-ink-muted" />
                  </a>
                ) : (
                  <span className="text-ink">{citation.title}</span>
                )}
                {(citation.site || citation.note) && (
                  <div className="mt-0.5 line-clamp-2 text-ink-muted">
                    {[citation.site, citation.note].filter(Boolean).join(' · ')}
                  </div>
                )}
              </div>
              <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${tierMeta.className}`}>
                {tierMeta.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PendingFollowup({ action }: { action: OutreachAction | null }) {
  const kind = action ? inferActionKind(action) : 'other';
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-divider bg-canvas px-3 py-2">
      <PixelAgentStatus state={kind === 'draft' ? 'drafting' : kind === 'voice' ? 'voice' : 'thinking'} size="sm" />
      <div className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-ink-secondary">
        {ACTION_PENDING_COPY[kind]}
      </div>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ink/50 consult-dot-pulse" />
    </div>
  );
}

export function OutreachWorkspaceBlock({
  toolCallId,
  state = 'input-available',
  input,
  output,
  pendingFollowup = false,
  readOnly = false,
  addToolResult,
}: OutreachWorkspaceBlockProps) {
  if (!input || !input.advisor || !input.outreachPlan) {
    return <BlockStreamingSkeleton kind="outreachWorkspace" />;
  }

  return (
    <OutreachWorkspaceContent
      toolCallId={toolCallId}
      state={state}
      input={input}
      output={output}
      pendingFollowup={pendingFollowup}
      readOnly={readOnly}
      addToolResult={addToolResult}
    />
  );
}

function OutreachWorkspaceContent({
  toolCallId,
  state,
  input,
  output,
  pendingFollowup,
  readOnly,
  addToolResult,
}: Omit<OutreachWorkspaceBlockProps, 'input'> & { input: OutreachWorkspaceInput }) {
  const [localAction, setLocalAction] = useState<OutreachAction | null>(null);
  const done = state === 'output-available';
  const pickedAction = done ? (output as { actionId?: string })?.actionId : null;
  const actions = input.actions && input.actions.length > 0 ? input.actions : DEFAULT_ACTIONS;
  const selectedAction = actions.find((action) => action.id === pickedAction) ?? localAction;
  const confidence = confidenceFromWorkspace(input);
  const verdict = input.judgment?.verdict || defaultVerdict(input);
  const nextMove = input.judgment?.nextMove || defaultNextMove(input);
  const citations = input.citations ?? [];
  const strongSourceCount = citations.filter((citation) => sourceTier(citation) === 'strong').length;
  const weakEvidence = citations.length === 0 || strongSourceCount === 0;
  const fitMap = input.fitMap ?? [];

  useEffect(() => {
    if (!localAction || done || pendingFollowup) return;
    const timer = window.setTimeout(() => setLocalAction(null), 9000);
    return () => window.clearTimeout(timer);
  }, [done, localAction, pendingFollowup]);

  const primaryActionId = useMemo(() => {
    return actions.find((action, idx) => actionIsPrimary(action, idx, weakEvidence))?.id ?? actions[0]?.id;
  }, [actions, weakEvidence]);

  const submitAction = (action: OutreachAction) => {
    if (readOnly || done || pendingFollowup || !toolCallId || !addToolResult) return;
    setLocalAction(action);
    addToolResult({
      tool: 'showOutreachWorkspace',
      toolCallId,
      output: {
        actionId: action.id,
        label: action.label,
        advisorName: input.advisor.name,
        confidence,
        nextMove,
      },
    });
  };

  return (
    <div className="consult-reveal overflow-hidden rounded-xl border border-divider bg-card">
      <div className="border-l-2 border-ink bg-hover/40 px-4 py-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-ink-muted">外联工作台</div>
            <div className="mt-1 text-[15px] font-medium leading-snug text-ink">{input.title}</div>
            <div className="mt-2 text-[12px] leading-relaxed text-ink-secondary">
              <span className="font-medium text-ink">{input.advisor.name}</span>
              {input.advisor.affiliation && <span> · {input.advisor.affiliation}</span>}
              {input.advisor.lab && <span> · {input.advisor.lab}</span>}
            </div>
            <div className="mt-1 text-[12px] leading-relaxed text-ink-secondary">{input.advisor.summary}</div>
          </div>
          <PixelAgentStatus
            state={pendingFollowup ? 'thinking' : weakEvidence ? 'searching' : 'done'}
            label={pendingFollowup ? '小墨接着推进' : weakEvidence ? '小墨在补证据' : '小墨已搭好路线'}
            size="sm"
            className="shrink-0"
          />
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-lg border border-divider bg-card px-3 py-2">
            <div className="text-[10px] text-ink-muted">当前判断</div>
            <div className="mt-0.5 text-[12.5px] leading-relaxed text-ink">{verdict}</div>
          </div>
          <div className="rounded-lg border border-divider bg-card px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[10px] text-ink-muted">下一步</div>
              <span className="rounded-full border border-divider px-2 py-0.5 text-[10px] text-ink-secondary">
                {CONFIDENCE_LABEL[confidence]}
              </span>
            </div>
            <div className="mt-0.5 text-[12.5px] leading-relaxed text-ink">{nextMove}</div>
          </div>
        </div>
      </div>

      <div className="divide-y divide-divider">
        <section className="px-4 py-3">
          <SectionTitle aside={`${strongSourceCount}/${citations.length || 0} 强来源`}>证据</SectionTitle>
          <SourceList citations={input.citations} />
        </section>

        <section className="px-4 py-3">
          <SectionTitle>匹配图</SectionTitle>
          <div className="space-y-2">
            {fitMap.slice(0, 4).map((item, idx) => (
              <div key={`${item.studentAnchor}-${idx}`} className="rounded-lg border border-divider bg-card px-3 py-2">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-[10px] text-ink-muted">匹配点 {idx + 1}</div>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] ${strengthClass(item.strength)}`}>
                    {strengthLabel(item.strength)}
                  </span>
                </div>
                <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
                  <div className="min-w-0">
                    <div className="text-[10px] text-ink-muted">你的素材</div>
                    <div className="mt-0.5 text-[12px] leading-relaxed text-ink">{item.studentAnchor}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] text-ink-muted">可以写成</div>
                    <div className="mt-0.5 text-[12px] leading-relaxed text-ink-secondary">{item.advisorSignal}</div>
                    <div className="mt-1 border-l border-divider pl-2 text-[11.5px] leading-relaxed text-ink-muted">
                      {item.outreachUse}
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {fitMap.length === 0 && (
              <div className="rounded-lg border border-divider bg-canvas px-3 py-2 text-[11.5px] text-ink-muted">
                还缺学生项目素材，先补 CV 或贴一段研究经历。
              </div>
            )}
          </div>
        </section>

        <section className="px-4 py-3">
          <SectionTitle>行动计划</SectionTitle>
          <div className="space-y-2">
            {[
              ['01', '开头钩子', input.outreachPlan.openingHook],
              ['02', '自我证明', input.outreachPlan.studentProof],
              ['03', '最小请求', input.outreachPlan.ask],
              ['04', '当前风险', input.outreachPlan.risk],
            ].map(([step, label, value]) => (
              <div key={label} className="grid gap-2 rounded-lg border border-divider bg-canvas px-3 py-2 sm:grid-cols-[2.8rem_7rem_1fr]">
                <div className="text-[11px] font-medium text-ink-muted">{step}</div>
                <div className="min-w-0">
                  <div className="text-[11px] font-medium text-ink">{label}</div>
                </div>
                <div className="text-[12px] leading-relaxed text-ink-secondary">{value}</div>
              </div>
            ))}
          </div>
        </section>

        {input.missingEvidence && input.missingEvidence.length > 0 && (
          <section className="px-4 py-3">
            <SectionTitle>待补证据</SectionTitle>
            <div className="rounded-lg border border-divider bg-canvas px-3 py-2">
              <ul className="space-y-1 text-[11.5px] leading-relaxed text-ink-secondary">
                {input.missingEvidence.slice(0, 4).map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ink-muted" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}
      </div>

      {!readOnly && actions.length > 0 && !done && (
        <div className="border-t border-divider px-4 py-3">
          {pendingFollowup || localAction ? (
            <PendingFollowup action={selectedAction} />
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {actions.map((action, idx) => {
                const kind = inferActionKind(action);
                const Icon = ACTION_ICON[kind];
                const primary = action.id === primaryActionId || actionIsPrimary(action, idx, weakEvidence);
                return (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => submitAction(action)}
                    className={
                      'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11.5px] transition ' +
                      (primary
                        ? 'border-ink bg-ink text-card hover:bg-ink/90'
                        : 'border-divider bg-card text-ink hover:border-ink/40 hover:bg-hover')
                    }
                  >
                    <Icon size={13} strokeWidth={1.8} />
                    {action.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {pickedAction && (
        <div className="border-t border-divider px-4 py-2 text-[11px] text-ink-muted">
          已选择：{selectedAction?.label ?? pickedAction}
        </div>
      )}
    </div>
  );
}
