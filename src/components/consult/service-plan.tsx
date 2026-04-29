'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, FileText, Mic, PenLine, Search, Upload } from 'lucide-react';
import { PixelAgentStatus } from './pixel-agent-status';
import { BlockStreamingSkeleton } from './skeletons';

export interface ServicePlanInput {
  phase: 'pre-service' | 'in-service' | 'post-service';
  title: string;
  consultantRead: string;
  objective: string;
  painPoints?: string[];
  modules?: Array<{
    id: string;
    label: string;
    status?: 'ready' | 'needs-input' | 'in-progress' | 'done';
    value: string;
    next?: string;
  }>;
  advisorMatches?: Array<{
    name: string;
    affiliation?: string;
    fitScore?: number;
    fitReason: string;
    nextAction?: string;
  }>;
  artifacts?: Array<{
    kind: 'cold-email' | 'cv' | 'research-plan' | 'interview-report' | 'timeline' | 'other';
    title: string;
    status?: 'draft' | 'ready' | 'needs-input';
    note?: string;
  }>;
  evaluation?: {
    overallScore?: number;
    dimensions?: Array<{ label: string; score: number }>;
    strengths?: string[];
    improvements?: string[];
  };
  actions?: Array<{
    id: string;
    label: string;
    intent?: 'ask' | 'search' | 'draft' | 'upload' | 'voice' | 'route' | 'handoff' | 'other';
  }>;
}

interface ServicePlanBlockProps {
  toolCallId?: string;
  state?: 'input-streaming' | 'input-available' | 'output-available' | 'output-error';
  input?: ServicePlanInput;
  output?: unknown;
  pendingFollowup?: boolean;
  readOnly?: boolean;
  addToolResult?: (args: { tool: string; toolCallId: string; output: unknown }) => void;
}

const PHASE_LABEL = {
  'pre-service': '服务前',
  'in-service': '服务中',
  'post-service': '服务后',
} as const;

const STATUS_LABEL = {
  ready: '可推进',
  'needs-input': '缺信息',
  'in-progress': '进行中',
  done: '已完成',
  draft: '草稿',
} as const;

const INTENT_ICON = {
  ask: ArrowRight,
  search: Search,
  draft: PenLine,
  upload: Upload,
  voice: Mic,
  route: ArrowRight,
  handoff: FileText,
  other: ArrowRight,
} as const;

function statusLabel(status?: string) {
  if (!status) return '待推进';
  return STATUS_LABEL[status as keyof typeof STATUS_LABEL] ?? status;
}

function intentForAction(action: NonNullable<ServicePlanInput['actions']>[number]) {
  if (action.intent) return action.intent;
  const text = `${action.id} ${action.label}`;
  if (/搜|查|search|导师/.test(text)) return 'search';
  if (/写|草稿|draft|邮件|计划/.test(text)) return 'draft';
  if (/上传|CV|upload|材料/.test(text)) return 'upload';
  if (/语音|面试|voice|call|模拟/.test(text)) return 'voice';
  if (/顾问|预约|微信|handoff/.test(text)) return 'handoff';
  return 'route';
}

function PendingPlan({ label }: { label?: string }) {
  return (
    <div className="mt-3 flex items-center gap-3 rounded-lg border border-divider bg-canvas px-3 py-2">
      <PixelAgentStatus state="thinking" size="sm" label="我在接上动作" />
      <div className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-ink-secondary">
        {label ? `正在按「${label}」继续推进。` : '正在推进服务方案。'}
      </div>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ink/50 consult-dot-pulse" />
    </div>
  );
}

export function ServicePlanBlock(props: ServicePlanBlockProps) {
  const { input } = props;
  if (!input || !input.title || !input.consultantRead || !input.objective) {
    return <BlockStreamingSkeleton kind="servicePlan" />;
  }
  return <ServicePlanContent {...props} input={input} />;
}

function ServicePlanContent({
  toolCallId,
  state = 'input-available',
  input,
  output,
  pendingFollowup = false,
  readOnly = false,
  addToolResult,
}: Omit<ServicePlanBlockProps, 'input'> & { input: ServicePlanInput }) {
  const [localAction, setLocalAction] = useState<{ id: string; label: string; intent?: string } | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const done = state === 'output-available';
  const pickedAction = done ? (output as { actionId?: string; label?: string }) : null;
  const selectedLabel = pickedAction?.label ?? localAction?.label;
  const actions = input.actions ?? [];
  const modules = input.modules ?? [];
  const visibleModules = showDetails ? modules.slice(0, 6) : modules.slice(0, 3);
  const hasDetails = Boolean(
    (input.painPoints && input.painPoints.length > 0) ||
    modules.length > 3 ||
    (input.advisorMatches && input.advisorMatches.length > 0) ||
    (input.artifacts && input.artifacts.length > 0) ||
    input.evaluation,
  );

  useEffect(() => {
    if (!localAction || done || pendingFollowup) return;
    const timer = window.setTimeout(() => setLocalAction(null), 9000);
    return () => window.clearTimeout(timer);
  }, [done, localAction, pendingFollowup]);

  const onAction = (action: NonNullable<ServicePlanInput['actions']>[number]) => {
    if (readOnly || done || pendingFollowup || !toolCallId || !addToolResult) return;
    const intent = intentForAction(action);
    setLocalAction({ ...action, intent });
    addToolResult({
      tool: 'showServicePlan',
      toolCallId,
      output: {
        actionId: action.id,
        label: action.label,
        intent,
        phase: input.phase,
        objective: input.objective,
      },
    });
  };

  return (
    <div className="consult-reveal overflow-hidden rounded-xl border border-[var(--consult-border)] bg-[var(--consult-surface)]">
      <div className="px-4 py-3.5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 text-[10.5px] uppercase tracking-wider text-[var(--consult-muted)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--consult-primary)]" />
              {PHASE_LABEL[input.phase]} · 服务方案
            </div>
            <div className="mt-3 text-[16px] font-medium leading-snug text-[var(--consult-text)]">{input.title}</div>
            <div className="mt-2 text-[12.5px] leading-[1.75] text-[var(--consult-secondary)]">{input.consultantRead}</div>
          </div>
          <PixelAgentStatus state={pendingFollowup ? 'thinking' : 'done'} size="sm" label="方案已成形" className="shrink-0" />
        </div>
        <div className="mt-3 border-l border-[var(--consult-primary)] pl-3">
          <div className="text-[10.5px] text-[var(--consult-muted)]">本轮目标</div>
          <div className="mt-0.5 text-[13px] leading-relaxed text-[var(--consult-text)]">{input.objective}</div>
        </div>
      </div>

      <div className="divide-y divide-divider">
        {input.painPoints && input.painPoints.length > 0 && showDetails && (
          <section className="px-4 py-3">
            <div className="mb-2 text-[10px] uppercase tracking-wider text-ink-muted">用户痛点</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {input.painPoints.slice(0, 5).map((pain) => (
                <div key={pain} className="rounded-lg border border-divider bg-canvas px-3 py-2 text-[11.5px] leading-relaxed text-ink-secondary">
                  {pain}
                </div>
              ))}
            </div>
          </section>
        )}

        {modules.length > 0 && (
          <section className="px-4 py-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="text-[10px] uppercase tracking-wider text-ink-muted">先推进这几件事</div>
              {!showDetails && modules.length > visibleModules.length && (
                <div className="text-[10px] text-ink-muted">还有 {modules.length - visibleModules.length} 项收起</div>
              )}
            </div>
            <div className="space-y-2">
              {visibleModules.map((mod, idx) => (
                <div key={mod.id} className="rounded-lg border border-divider bg-card px-3 py-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[10px] text-ink-muted">{String(idx + 1).padStart(2, '0')}</div>
                      <div className="mt-0.5 text-[12px] font-medium text-ink">{mod.label}</div>
                    </div>
                    <div className="shrink-0 rounded-full border border-divider px-2 py-0.5 text-center text-[10px] text-ink-muted">
                      {statusLabel(mod.status)}
                    </div>
                  </div>
                  <div className="text-[11.5px] leading-relaxed text-ink-secondary">
                    {mod.value}
                    {mod.next && <div className="mt-1 text-ink-muted">下一步：{mod.next}</div>}
                  </div>
                </div>
              ))}
            </div>
            {hasDetails && (
              <button
                type="button"
                onClick={() => setShowDetails((v) => !v)}
                className="mt-3 rounded-lg border border-divider bg-card px-3 py-1.5 text-[11.5px] text-ink-secondary transition hover:border-ink/40 hover:bg-hover hover:text-ink"
              >
                {showDetails ? '收起细节' : '展开完整方案'}
              </button>
            )}
          </section>
        )}

        {input.advisorMatches && input.advisorMatches.length > 0 && showDetails && (
          <section className="px-4 py-3">
            <div className="mb-2 text-[10px] uppercase tracking-wider text-ink-muted">导师匹配</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {input.advisorMatches.slice(0, 5).map((advisor) => (
                <div key={`${advisor.name}-${advisor.affiliation ?? ''}`} className="rounded-lg border border-divider bg-card px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-[12px] font-medium text-ink">{advisor.name}</div>
                      {advisor.affiliation && <div className="mt-0.5 text-[10.5px] text-ink-muted">{advisor.affiliation}</div>}
                    </div>
                    {typeof advisor.fitScore === 'number' && (
                      <div className="rounded-full border border-divider px-2 py-0.5 text-[10px] text-ink-secondary">
                        {Math.round(advisor.fitScore)}%
                      </div>
                    )}
                  </div>
                  <div className="mt-2 text-[11.5px] leading-relaxed text-ink-secondary">{advisor.fitReason}</div>
                  {advisor.nextAction && <div className="mt-1 text-[11px] text-ink-muted">{advisor.nextAction}</div>}
                </div>
              ))}
            </div>
          </section>
        )}

        {input.artifacts && input.artifacts.length > 0 && showDetails && (
          <section className="px-4 py-3">
            <div className="mb-2 text-[10px] uppercase tracking-wider text-ink-muted">交付物</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {input.artifacts.slice(0, 5).map((artifact) => (
                <div key={`${artifact.kind}-${artifact.title}`} className="rounded-lg border border-divider bg-canvas px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[12px] font-medium text-ink">{artifact.title}</div>
                    <div className="text-[10px] text-ink-muted">{statusLabel(artifact.status)}</div>
                  </div>
                  {artifact.note && <div className="mt-1 text-[11.5px] leading-relaxed text-ink-secondary">{artifact.note}</div>}
                </div>
              ))}
            </div>
          </section>
        )}

        {input.evaluation && showDetails && (
          <section className="px-4 py-3">
            <div className="mb-2 text-[10px] uppercase tracking-wider text-ink-muted">能力评估</div>
            <div className="grid gap-2 sm:grid-cols-[8rem_1fr]">
              <div className="rounded-lg border border-divider bg-card px-3 py-2">
                <div className="text-[10px] text-ink-muted">综合分</div>
                <div className="mt-1 text-[24px] font-medium leading-none text-ink">{input.evaluation.overallScore ?? '-'}</div>
              </div>
              <div className="rounded-lg border border-divider bg-canvas px-3 py-2">
                {(input.evaluation.dimensions ?? []).slice(0, 6).map((dim) => (
                  <div key={dim.label} className="mb-1.5 last:mb-0">
                    <div className="flex justify-between text-[10.5px] text-ink-muted">
                      <span>{dim.label}</span>
                      <span>{Math.round(dim.score)}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-divider">
                      <div className="h-full bg-ink" style={{ width: `${Math.max(0, Math.min(100, dim.score))}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
      </div>

      {!readOnly && actions.length > 0 && !done && (
        <div className="border-t border-[var(--consult-border)] bg-[var(--consult-bg)] px-4 py-3">
          {pendingFollowup || localAction ? (
            <PendingPlan label={selectedLabel} />
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
    </div>
  );
}
