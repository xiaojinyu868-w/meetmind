'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, Download, FileText, Mic, PenLine, Search } from 'lucide-react';
import { ConsultMarkdown } from './consult-markdown';
import { PixelAgentStatus } from './pixel-agent-status';
import { BlockStreamingSkeleton } from './skeletons';

type ToolState = 'input-streaming' | 'input-available' | 'output-available' | 'output-error';
type ArtifactState = 'current' | 'superseded';

interface DraftAction {
  id: string;
  label: string;
}

interface DraftAnnotation {
  note: string;
  quote: string;
}

export interface CvDiagnosisDraftInput {
  kind: string;
  title: string;
  body: string;
  annotations?: DraftAnnotation[];
  actions?: DraftAction[];
}

interface CvDiagnosisArtifactBlockProps {
  toolCallId: string;
  state: ToolState;
  input?: CvDiagnosisDraftInput;
  output?: unknown;
  artifactState?: ArtifactState;
  pendingFollowup?: boolean;
  addToolResult: (args: { tool: string; toolCallId: string; output: unknown }) => void;
}

interface CvDiagnosisSummary {
  score: string | null;
  dimensions: Array<{ label: string; score: number; note: string }>;
  highlight: string;
  risk: string;
  nextStep: string;
}

const ACTION_ICON = {
  search: Search,
  draft: PenLine,
  voice: Mic,
  export: Download,
  route: ArrowRight,
  plan: FileText,
} as const;

export function CvDiagnosisArtifactBlock(props: CvDiagnosisArtifactBlockProps) {
  const { input } = props;
  if (!input || typeof input.body !== 'string') return <BlockStreamingSkeleton kind="showDraft" />;
  return <CvDiagnosisArtifactContent {...props} input={input} />;
}

function CvDiagnosisArtifactContent({
  toolCallId,
  state,
  input,
  output,
  artifactState = 'current',
  pendingFollowup = false,
  addToolResult,
}: CvDiagnosisArtifactBlockProps & { input: CvDiagnosisDraftInput }) {
  const [showFull, setShowFull] = useState(false);
  const [showAnno, setShowAnno] = useState(false);
  const [localAction, setLocalAction] = useState<DraftAction | null>(null);
  const done = state === 'output-available';
  const pickedAction = done ? (output as { actionId?: string; label?: string }) : null;
  const selectedLabel = pickedAction?.label ?? localAction?.label;
  const summary = summarizeCvDiagnosis(input.body);
  const actions = input.actions ?? [];
  const isArchived = artifactState === 'superseded';

  useEffect(() => {
    if (!localAction || done || pendingFollowup) return;
    const timer = window.setTimeout(() => setLocalAction(null), 9000);
    return () => window.clearTimeout(timer);
  }, [done, localAction, pendingFollowup]);

  const onAction = (action: DraftAction) => {
    if (done || pendingFollowup || isArchived) return;
    if (action.id === 'export-md') {
      const blob = new Blob([input.body], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${input.title.replace(/\s+/g, '-')}.md`;
      a.click();
      URL.revokeObjectURL(url);
      addToolResult({ tool: 'showDraft', toolCallId, output: { actionId: action.id, label: action.label, note: '学生已导出 markdown' } });
      return;
    }
    setLocalAction(action);
    addToolResult({
      tool: 'showDraft',
      toolCallId,
      output: { actionId: action.id, label: action.label, kind: input.kind },
    });
  };

  if (isArchived) {
    return (
      <div className="consult-reveal overflow-hidden rounded-xl border border-divider bg-card">
        <button
          type="button"
          onClick={() => setShowFull((v) => !v)}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-hover"
        >
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-ink-muted">CV 诊断 · 旧版本</div>
            <div className="mt-0.5 truncate text-[13px] font-medium text-ink">{input.title}</div>
          </div>
          <span className="shrink-0 rounded-lg border border-divider px-2 py-1 text-[11px] text-ink-muted">
            {showFull ? '收起' : '查看'}
          </span>
        </button>
        {showFull && (
          <div className="border-t border-divider px-5 py-4">
            <ConsultMarkdown content={input.body} density="draft" />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="consult-reveal overflow-hidden rounded-xl border border-divider bg-card">
      <div className="border-l-2 border-ink bg-hover/40 px-4 py-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-ink-muted">CV 诊断 · 当前版本</div>
            <div className="mt-1 text-[15px] font-medium leading-snug text-ink">{input.title}</div>
          </div>
          <PixelAgentStatus
            state={pendingFollowup ? 'thinking' : 'done'}
            size="sm"
            label={pendingFollowup ? '接着推进' : '判断稳定'}
            className="shrink-0"
          />
        </div>
      </div>

      <div className="divide-y divide-divider">
        <section className="grid gap-3 px-4 py-4 sm:grid-cols-[9rem_1fr]">
          <div className="rounded-lg border border-divider bg-canvas px-3 py-3">
            <div className="text-[10px] text-ink-muted">匹配度</div>
            <div className="mt-2 flex items-end gap-1">
              <span className="text-[30px] font-medium leading-none text-ink">{summary.score ?? '-'}</span>
              <span className="pb-1 text-[11px] text-ink-muted">/ 5.0</span>
            </div>
            <div className="mt-3 space-y-2">
              {summary.dimensions.slice(0, 4).map((dim) => (
                <div key={dim.label}>
                  <div className="flex justify-between gap-2 text-[10.5px] text-ink-muted">
                    <span>{dim.label}</span>
                    <span>{dim.score.toFixed(1)}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-divider">
                    <div className="h-full bg-ink" style={{ width: `${Math.max(0, Math.min(100, dim.score * 20))}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-2">
            <SignalCard label="最大机会" value={summary.highlight} />
            <SignalCard label="最大风险" value={summary.risk} />
            <SignalCard label="下一步" value={summary.nextStep} />
          </div>
        </section>

        <section className="px-4 py-3">
          <button
            type="button"
            onClick={() => setShowFull((v) => !v)}
            className="flex w-full items-center justify-between gap-3 rounded-lg border border-divider bg-card px-3 py-2 text-left transition hover:border-ink/40 hover:bg-hover"
          >
            <span className="text-[12px] font-medium text-ink">完整诊断正文</span>
            <span className="text-[11px] text-ink-muted">{showFull ? '收起' : '展开'}</span>
          </button>
          {showFull && (
            <div className="mt-3 rounded-lg border border-divider bg-card px-4 py-3">
              <ConsultMarkdown content={input.body} density="draft" />
            </div>
          )}
        </section>

        {input.annotations && input.annotations.length > 0 && (
          <section className="px-4 py-3">
            <button
              type="button"
              onClick={() => setShowAnno((v) => !v)}
              className="flex w-full items-center justify-between gap-3 text-left text-[11.5px] text-ink-secondary transition hover:text-ink"
            >
              <span>机构批注 · {input.annotations.length}</span>
              <span className="text-ink-muted">{showAnno ? '收起' : '展开'}</span>
            </button>
            {showAnno && (
              <ul className="mt-3 space-y-2">
                {input.annotations.slice(0, 5).map((annotation, index) => (
                  <li key={`${annotation.quote}-${index}`} className="rounded-lg border border-divider bg-canvas px-3 py-2 text-[11.5px] leading-relaxed">
                    <div className="text-ink-muted">「{annotation.quote}」</div>
                    <div className="mt-1 text-ink-secondary">{annotation.note}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>

      {actions.length > 0 && !done && (
        <div className="border-t border-divider px-4 py-3">
          {pendingFollowup || localAction ? (
            <div className="flex items-center gap-3 rounded-lg border border-divider bg-canvas px-3 py-2">
              <PixelAgentStatus state="thinking" size="sm" label="正在接上" />
              <div className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-ink-secondary">
                {selectedLabel ? `正在按「${selectedLabel}」继续推进。` : '正在继续推进。'}
              </div>
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ink/50 consult-dot-pulse" />
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {actions.map((action, index) => {
                const intent = actionIntent(action);
                const Icon = ACTION_ICON[intent];
                return (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => onAction(action)}
                    className={
                      'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11.5px] transition ' +
                      (index === 0 ? 'border-ink bg-ink text-card hover:bg-ink/90' : 'border-divider bg-card text-ink hover:border-ink/40 hover:bg-hover')
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
          已选择：{pickedAction.label ?? actions.find((action) => action.id === pickedAction.actionId)?.label ?? pickedAction.actionId}
        </div>
      )}
    </div>
  );
}

function SignalCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-divider bg-card px-3 py-2">
      <div className="text-[10px] text-ink-muted">{label}</div>
      <div className="mt-1 text-[12.5px] leading-relaxed text-ink">{value}</div>
    </div>
  );
}

function actionIntent(action: DraftAction): keyof typeof ACTION_ICON {
  const text = `${action.id} ${action.label}`;
  if (/导师|查|搜|search|advisor|professor/.test(text)) return 'search';
  if (/写|改|draft|套磁|计划|方案/.test(text)) return 'draft';
  if (/语音|聊|voice|call/.test(text)) return 'voice';
  if (/导出|export|markdown/.test(text)) return 'export';
  if (/方案|service|plan/.test(text)) return 'plan';
  return 'route';
}

export function summarizeCvDiagnosis(body: string): CvDiagnosisSummary {
  const score = body.match(/总分[：:]\s*([0-9](?:\.[0-9])?)\s*\/\s*5(?:\.0)?/)?.[1] ?? null;
  const dimensions = Array.from(body.matchAll(/-\s*([^：:\n]+)[：:]\s*([0-9](?:\.[0-9])?)\s*\/\s*5(?:\.0)?[（(]([^）)]*)[）)]/g))
    .map((match) => ({
      label: stripMarkdown(match[1]).slice(0, 8),
      score: Number(match[2]),
      note: stripMarkdown(match[3]),
    }))
    .filter((dim) => Number.isFinite(dim.score));

  return {
    score,
    dimensions,
    highlight: extractFirstItem(body, '3 个亮点') ?? '先看完整诊断里的第一条亮点。',
    risk: extractFirstItem(body, '3 个硬伤') ?? '先看完整诊断里的第一条硬伤。',
    nextStep: extractWeekOne(body) ?? extractFirstItem(body, '最短改进路径（接下来 4 周）') ?? '先选一个最小动作往下推进。',
  };
}

function extractSection(body: string, title: string): string {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return body.match(new RegExp(`##\\s*${escaped}\\s*([\\s\\S]*?)(?=\\n##\\s|$)`))?.[1] ?? '';
}

function extractFirstItem(body: string, title: string): string | null {
  const section = extractSection(body, title);
  const item = section.match(/^\s*(?:\d+\.\s*|-\s*)(.+)$/m)?.[1];
  if (!item) return null;
  return compactText(item);
}

function extractWeekOne(body: string): string | null {
  const section = extractSection(body, '最短改进路径（接下来 4 周）');
  const item = section.match(/第\s*1\s*周[：:]\s*(.+)$/m)?.[1];
  return item ? compactText(item) : null;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*/g, '')
    .replace(/[`*_>#-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactText(text: string): string {
  const clean = stripMarkdown(text).replace(/\s*[—-]\s*/g, ' — ');
  return clean.length > 96 ? `${clean.slice(0, 94)}…` : clean;
}
