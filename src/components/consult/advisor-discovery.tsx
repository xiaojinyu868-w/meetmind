'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, MessageCircle, PenLine, Search, Star, Upload, Mic } from 'lucide-react';
import { PixelAgentStatus } from './pixel-agent-status';
import { BlockStreamingSkeleton } from './skeletons';

export interface AdvisorDiscoveryInput {
  title: string;
  read: string;
  mode?: 'explore' | 'compare' | 'shortlist' | 'handoff';
  question?: string;
  candidates?: Array<{
    name: string;
    affiliation?: string;
    area?: string;
    status?: 'mentioned' | 'exploring' | 'shortlisted' | 'risky' | 'unknown';
    fit?: number;
    confidence?: 'high' | 'medium' | 'low' | 'unknown';
    why: string;
    evidence?: string;
    next?: string;
  }>;
  searchPlan?: Array<{
    label: string;
    query?: string;
    reason?: string;
  }>;
  signals?: Array<{ label: string; value: string }>;
  actions?: Array<{
    id: string;
    label: string;
    intent?: 'ask' | 'search' | 'shortlist' | 'draft' | 'upload' | 'voice' | 'route' | 'other';
  }>;
}

interface AdvisorDiscoveryBlockProps {
  toolCallId?: string;
  state?: 'input-streaming' | 'input-available' | 'output-available' | 'output-error';
  input?: AdvisorDiscoveryInput;
  output?: unknown;
  pendingFollowup?: boolean;
  readOnly?: boolean;
  addToolResult?: (args: { tool: string; toolCallId: string; output: unknown }) => void;
}

const MODE_LABEL = {
  explore: '探索中',
  compare: '比较中',
  shortlist: '短名单',
  handoff: '适合接力',
} as const;

const STATUS_LABEL = {
  mentioned: '提到过',
  exploring: '在看',
  shortlisted: '可短名单',
  risky: '有风险',
  unknown: '待查证',
} as const;

const CONFIDENCE_LABEL = {
  high: '高可信',
  medium: '中可信',
  low: '低可信',
  unknown: '未确认',
} as const;

const INTENT_ICON = {
  ask: MessageCircle,
  search: Search,
  shortlist: Star,
  draft: PenLine,
  upload: Upload,
  voice: Mic,
  route: ArrowRight,
  other: ArrowRight,
} as const;

function intentForAction(action: NonNullable<AdvisorDiscoveryInput['actions']>[number]) {
  if (action.intent) return action.intent;
  const text = `${action.id} ${action.label}`;
  if (/问|clarify|ask/.test(text)) return 'ask';
  if (/搜|查|search|论文|导师|实验室/.test(text)) return 'search';
  if (/短名单|保留|star|shortlist/.test(text)) return 'shortlist';
  if (/写|草稿|draft|邮件|套磁/.test(text)) return 'draft';
  if (/上传|CV|材料|upload/.test(text)) return 'upload';
  if (/语音|聊|voice|call/.test(text)) return 'voice';
  return 'route';
}

function PendingDiscovery({ label }: { label?: string }) {
  return (
    <div className="mt-3 flex items-center gap-3 rounded-lg border border-divider bg-canvas px-3 py-2">
      <PixelAgentStatus state="thinking" size="sm" label="继续探索" />
      <div className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-ink-secondary">
        {label ? `正在按「${label}」往下收窄。` : '正在把导师探索接上下一步。'}
      </div>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ink/50 consult-dot-pulse" />
    </div>
  );
}

export function AdvisorDiscoveryBlock(props: AdvisorDiscoveryBlockProps) {
  const { input } = props;
  if (!input || !input.title || !input.read) {
    return <BlockStreamingSkeleton kind="advisorDiscovery" />;
  }
  return <AdvisorDiscoveryContent {...props} input={input} />;
}

function AdvisorDiscoveryContent({
  toolCallId,
  state = 'input-available',
  input,
  output,
  pendingFollowup = false,
  readOnly = false,
  addToolResult,
}: Omit<AdvisorDiscoveryBlockProps, 'input'> & { input: AdvisorDiscoveryInput }) {
  const [localAction, setLocalAction] = useState<{ id: string; label: string; intent?: string } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [showSearchPlan, setShowSearchPlan] = useState(false);
  const done = state === 'output-available';
  const pickedAction = done ? (output as { actionId?: string; label?: string }) : null;
  const actions = input.actions ?? [];
  const candidates = input.candidates ?? [];
  const visibleCandidates = showAll ? candidates.slice(0, 6) : candidates.slice(0, 3);
  const selectedLabel = pickedAction?.label ?? localAction?.label;

  useEffect(() => {
    if (!localAction || done || pendingFollowup) return;
    const timer = window.setTimeout(() => setLocalAction(null), 9000);
    return () => window.clearTimeout(timer);
  }, [done, localAction, pendingFollowup]);

  const onAction = (action: NonNullable<AdvisorDiscoveryInput['actions']>[number]) => {
    if (readOnly || done || pendingFollowup || !toolCallId || !addToolResult) return;
    const intent = intentForAction(action);
    setLocalAction({ ...action, intent });
    addToolResult({
      tool: 'showAdvisorDiscovery',
      toolCallId,
      output: {
        actionId: action.id,
        label: action.label,
        intent,
        mode: input.mode ?? 'explore',
      },
    });
  };

  return (
    <div className="consult-reveal overflow-hidden rounded-xl border border-[var(--consult-border)] bg-[var(--consult-surface)]">
      <div className="px-4 py-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 text-[10.5px] uppercase tracking-wider text-[var(--consult-muted)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--consult-primary)]" />
              导师探索 · {MODE_LABEL[input.mode ?? 'explore']}
            </div>
            <div className="mt-3 text-[16px] font-medium leading-snug text-[var(--consult-text)]">{input.title}</div>
            <div className="mt-2 text-[12.5px] leading-[1.75] text-[var(--consult-secondary)]">{input.read}</div>
          </div>
          <PixelAgentStatus state={pendingFollowup ? 'thinking' : 'searching'} size="sm" label="在收窄" className="shrink-0" />
        </div>

        {input.signals && input.signals.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {input.signals.slice(0, 4).map((signal) => (
              <span
                key={`${signal.label}-${signal.value}`}
                className="rounded-full border border-[var(--consult-border)] bg-[var(--consult-bg)] px-2 py-1 text-[10.5px] text-[var(--consult-secondary)]"
              >
                {signal.label} · {signal.value}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="divide-y divide-divider">
        {input.question && (
          <section className="px-4 py-3">
            <div className="text-[10px] uppercase tracking-wider text-ink-muted">先确认一个关键点</div>
            <div className="mt-1 border-l border-[var(--consult-primary)] px-3 py-1.5 text-[12.5px] leading-relaxed text-[var(--consult-text)]">{input.question}</div>
          </section>
        )}

        {candidates.length > 0 && (
          <section className="px-4 py-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="text-[10px] uppercase tracking-wider text-ink-muted">候选探索</div>
              {!showAll && candidates.length > visibleCandidates.length && (
                <div className="text-[10px] text-ink-muted">还有 {candidates.length - visibleCandidates.length} 个收起</div>
              )}
            </div>
            <div className="space-y-2">
              {visibleCandidates.map((candidate) => (
                <CandidateCard key={`${candidate.name}-${candidate.affiliation ?? ''}`} candidate={candidate} />
              ))}
            </div>
            {candidates.length > 3 && (
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className="mt-3 rounded-lg border border-divider bg-card px-3 py-1.5 text-[11.5px] text-ink-secondary transition hover:border-ink/40 hover:bg-hover hover:text-ink"
              >
                {showAll ? '收起候选' : '展开全部候选'}
              </button>
            )}
          </section>
        )}

        {input.searchPlan && input.searchPlan.length > 0 && (
          <section className="px-4 py-3">
            <button
              type="button"
              onClick={() => setShowSearchPlan((v) => !v)}
              className="flex w-full items-center justify-between gap-3 text-left text-[11.5px] text-ink-secondary transition hover:text-ink"
            >
              <span>检索策略</span>
              <span className="text-ink-muted">{showSearchPlan ? '收起' : '展开'}</span>
            </button>
            {showSearchPlan && (
              <div className="mt-2 space-y-1.5">
                {input.searchPlan.slice(0, 4).map((item) => (
                  <div key={item.label} className="rounded-lg border border-divider bg-canvas px-3 py-2">
                    <div className="text-[11.5px] font-medium text-ink">{item.label}</div>
                    {item.reason && <div className="mt-0.5 text-[11px] leading-relaxed text-ink-secondary">{item.reason}</div>}
                    {item.query && <div className="mt-1 truncate font-mono text-[10px] text-ink-muted">{item.query}</div>}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      {!readOnly && actions.length > 0 && !done && (
        <div className="border-t border-[var(--consult-border)] bg-[var(--consult-bg)] px-4 py-3">
          {pendingFollowup || localAction ? (
            <PendingDiscovery label={selectedLabel} />
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {actions.map((action, idx) => {
                const intent = intentForAction(action);
                const Icon = INTENT_ICON[intent];
                return (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => onAction(action)}
                    className={
                      'inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[11.5px] font-medium transition ' +
                      (idx === 0 ? 'consult-primary-action' : 'consult-secondary-action')
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

      {done && pickedAction?.actionId && (
        <div className="border-t border-divider px-4 py-2 text-[11px] text-ink-muted">
          已选择：{pickedAction.label ?? pickedAction.actionId}
        </div>
      )}
    </div>
  );
}

function CandidateCard({ candidate }: { candidate: NonNullable<AdvisorDiscoveryInput['candidates']>[number] }) {
  const confidence = candidate.confidence ?? 'unknown';
  const status = candidate.status ?? 'unknown';
  return (
    <div className="rounded-lg border border-[var(--consult-border)] bg-[var(--consult-surface)] px-3 py-2.5 transition-colors hover:bg-[var(--consult-hover)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--consult-primary)]" />
            <div className="truncate text-[12.5px] font-medium leading-snug text-[var(--consult-text)]">{candidate.name}</div>
          </div>
          {(candidate.affiliation || candidate.area) && (
            <div className="mt-0.5 pl-3.5 text-[10.5px] leading-relaxed text-[var(--consult-muted)]">
              {[candidate.affiliation, candidate.area].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {typeof candidate.fit === 'number' && (
            <span className="rounded-full border border-[var(--consult-border)] px-2 py-0.5 text-[10px] text-[var(--consult-secondary)]">
              {Math.round(candidate.fit)}%
            </span>
          )}
          <span className="rounded-full border border-[var(--consult-border)] px-2 py-0.5 text-[10px] text-[var(--consult-muted)]">
            {STATUS_LABEL[status]}
          </span>
        </div>
      </div>
      <div className="mt-2 pl-3.5 text-[11.5px] leading-relaxed text-[var(--consult-secondary)]">{candidate.why}</div>
      <div className="mt-2 flex flex-wrap gap-1.5 pl-3.5 text-[10.5px] text-[var(--consult-muted)]">
        <span className="rounded-full border border-[var(--consult-border)] px-2 py-0.5">{CONFIDENCE_LABEL[confidence]}</span>
        {candidate.evidence && <span className="rounded-full border border-[var(--consult-border)] px-2 py-0.5">{candidate.evidence}</span>}
      </div>
      {candidate.next && <div className="mt-1.5 pl-3.5 text-[11px] leading-relaxed text-[var(--consult-muted)]">下一步：{candidate.next}</div>}
    </div>
  );
}
