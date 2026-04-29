'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, MessageCircle, Mic, PenLine, Search, Upload } from 'lucide-react';
import { PixelAgentStatus } from './pixel-agent-status';
import { BlockStreamingSkeleton } from './skeletons';

export interface ConsultantMoveInput {
  stance?: 'diagnose' | 'challenge' | 'clarify' | 'route' | 'reassure' | 'handoff';
  title: string;
  read: string;
  evidence?: string[];
  move: string;
  question?: string;
  actions?: Array<{
    id: string;
    label: string;
    intent?: 'ask' | 'search' | 'draft' | 'upload' | 'voice' | 'route' | 'handoff' | 'other';
  }>;
}

interface ConsultantMoveBlockProps {
  toolCallId?: string;
  state?: 'input-streaming' | 'input-available' | 'output-available' | 'output-error';
  input?: ConsultantMoveInput;
  output?: unknown;
  pendingFollowup?: boolean;
  readOnly?: boolean;
  addToolResult?: (args: { tool: string; toolCallId: string; output: unknown }) => void;
}

const STANCE_LABEL = {
  diagnose: '我先判断',
  challenge: '我会直说',
  clarify: '我只问关键点',
  route: '我带你往前走',
  reassure: '先稳住',
  handoff: '适合真人接力',
} as const;

const INTENT_ICON = {
  ask: MessageCircle,
  search: Search,
  draft: PenLine,
  upload: Upload,
  voice: Mic,
  route: ArrowRight,
  handoff: ArrowRight,
  other: ArrowRight,
} as const;

function intentForAction(action: NonNullable<ConsultantMoveInput['actions']>[number]) {
  if (action.intent) return action.intent;
  const text = `${action.id} ${action.label}`;
  if (/问|clarify|ask/.test(text)) return 'ask';
  if (/搜|查|search|论文|导师/.test(text)) return 'search';
  if (/写|草稿|draft|邮件|文书/.test(text)) return 'draft';
  if (/上传|CV|材料|upload/.test(text)) return 'upload';
  if (/语音|聊|voice|call/.test(text)) return 'voice';
  if (/顾问|微信|handoff|真人/.test(text)) return 'handoff';
  return 'route';
}

function PendingMove({ label }: { label?: string }) {
  return (
    <div className="mt-3 flex items-center gap-3 rounded-lg border border-divider bg-canvas px-3 py-2">
      <PixelAgentStatus state="thinking" size="sm" label="我接着处理" />
      <div className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-ink-secondary">
        {label ? `正在按「${label}」继续推进。` : '正在接上你的选择。'}
      </div>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ink/50 consult-dot-pulse" />
    </div>
  );
}

export function ConsultantMoveBlock({
  toolCallId,
  state = 'input-available',
  input,
  output,
  pendingFollowup = false,
  readOnly = false,
  addToolResult,
}: ConsultantMoveBlockProps) {
  if (!input || !input.title || !input.read || !input.move) {
    return <BlockStreamingSkeleton kind="consultantMove" />;
  }

  return (
    <ConsultantMoveContent
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

function ConsultantMoveContent({
  toolCallId,
  state,
  input,
  output,
  pendingFollowup,
  readOnly,
  addToolResult,
}: Omit<ConsultantMoveBlockProps, 'input'> & { input: ConsultantMoveInput }) {
  const [localAction, setLocalAction] = useState<{ id: string; label: string; intent?: string } | null>(null);
  const done = state === 'output-available';
  const pickedAction = done ? (output as { actionId?: string; label?: string }) : null;
  const stance = input.stance ?? 'diagnose';
  const actions = input.actions ?? [];
  const selectedLabel = pickedAction?.label ?? localAction?.label;
  const [showEvidence, setShowEvidence] = useState(false);
  const evidence = input.evidence?.slice(0, 4) ?? [];

  useEffect(() => {
    if (!localAction || done || pendingFollowup) return;
    const timer = window.setTimeout(() => setLocalAction(null), 9000);
    return () => window.clearTimeout(timer);
  }, [done, localAction, pendingFollowup]);

  const onAction = (action: NonNullable<ConsultantMoveInput['actions']>[number]) => {
    if (readOnly || done || pendingFollowup || !toolCallId || !addToolResult) return;
    const intent = intentForAction(action);
    setLocalAction({ ...action, intent });
    addToolResult({
      tool: 'showConsultantMove',
      toolCallId,
      output: {
        actionId: action.id,
        label: action.label,
        intent,
        move: input.move,
        question: input.question,
      },
    });
  };

  return (
    <div className="consult-reveal overflow-hidden rounded-xl border border-[var(--consult-border)] bg-[var(--consult-surface)]">
      <div className="px-4 py-3.5">
        <div className="flex items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2 text-[10.5px] uppercase tracking-wider text-[var(--consult-muted)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--consult-primary)]" />
            {STANCE_LABEL[stance]}
          </div>
          <PixelAgentStatus state={pendingFollowup ? 'thinking' : 'done'} size="sm" label="顾问判断" className="shrink-0" />
        </div>

        <div className="mt-3 text-[16px] font-medium leading-snug text-[var(--consult-text)]">{input.title}</div>
        <p className="mt-2 text-[12.5px] leading-[1.75] text-[var(--consult-secondary)]">{input.read}</p>

        <div className="mt-3 border-l border-[var(--consult-primary)] pl-3">
          <div className="text-[10.5px] text-[var(--consult-muted)]">下一步动作</div>
          <div className="mt-0.5 text-[13px] leading-relaxed text-[var(--consult-text)]">{input.move}</div>
        </div>

        {input.question && (
          <div className="mt-3 rounded-lg bg-[var(--consult-primary-soft)] px-3 py-2 text-[12.5px] leading-relaxed text-[var(--consult-text)]">
            {input.question}
          </div>
        )}

        {evidence.length > 0 && (
          <div className="mt-3 border-t border-[var(--consult-border)] pt-2">
            <button
              type="button"
              onClick={() => setShowEvidence((v) => !v)}
              className="flex w-full items-center justify-between gap-3 text-left text-[11.5px] text-[var(--consult-muted)] transition hover:text-[var(--consult-primary)]"
            >
              <span>判断依据 · {evidence.length} 项</span>
              <span>{showEvidence ? '收起' : '展开'}</span>
            </button>
            {showEvidence && (
              <ul className="mt-2 space-y-1.5 text-[11.5px] leading-relaxed text-[var(--consult-secondary)]">
                {evidence.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[var(--consult-muted)]" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {!readOnly && actions.length > 0 && !done && (
        <div className="border-t border-[var(--consult-border)] bg-[var(--consult-bg)] px-4 py-3">
          {pendingFollowup || localAction ? (
            <PendingMove label={selectedLabel} />
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {actions.map((action, idx) => {
                const intent = intentForAction(action);
                const Icon = INTENT_ICON[intent];
                const primary = idx === 0;
                return (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => onAction(action)}
                    className={
                      'inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[11.5px] font-medium transition ' +
                      (primary
                        ? 'consult-primary-action'
                        : 'consult-secondary-action')
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
        <div className="border-t border-[var(--consult-border)] bg-[var(--consult-bg)] px-4 py-2.5 text-[11px] text-[var(--consult-muted)]">
          已选择：{pickedAction.label ?? pickedAction.actionId}
        </div>
      )}
    </div>
  );
}
