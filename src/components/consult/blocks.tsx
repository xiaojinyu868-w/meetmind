'use client';

import { useState } from 'react';
import { Button } from '@/components/academic/primitives';
import { BlockStreamingSkeleton } from './skeletons';
import { ConsultMarkdown } from './consult-markdown';
import { InlineVoiceCallBlock } from './inline-voice-call';
import { OutreachWorkspaceBlock, type OutreachWorkspaceInput } from './outreach-workspace';
import { CvDiagnosisArtifactBlock, type CvDiagnosisDraftInput } from './cv-diagnosis-artifact';

type BlockProps<Input> = {
  toolCallId: string;
  state: 'input-streaming' | 'input-available' | 'output-available' | 'output-error';
  input?: Input;
  output?: unknown;
  pendingFollowup?: boolean;
  addToolResult: (args: { tool: string; toolCallId: string; output: unknown }) => void;
};

export function AskOptionsBlock(props: BlockProps<{
  prompt: string;
  multi?: boolean;
  choices: { id: string; label: string; description?: string }[];
}>) {
  const { input, state, output, pendingFollowup, addToolResult, toolCallId } = props;
  const [picked, setPicked] = useState<string[]>([]);
  const done = state === 'output-available';

  if (!input || !Array.isArray(input.choices)) return <BlockStreamingSkeleton kind="askOptions" />;

  const selected: string[] = done
    ? Array.isArray((output as { selected?: string[] })?.selected)
      ? ((output as { selected: string[] }).selected as string[])
      : []
    : picked;
  const selectedLabels = selected
    .map((id) => input.choices.find((c) => c.id === id)?.label ?? id)
    .filter(Boolean);

  const toggle = (id: string) => {
    if (done) return;
    if (input.multi) setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
    else setPicked([id]);
  };

  const submit = () => {
    if (done || picked.length === 0) return;
    addToolResult({
      tool: 'askOptions',
      toolCallId,
      output: {
        selected: picked,
        labels: picked.map((id) => input.choices.find((c) => c.id === id)?.label ?? id),
      },
    });
  };

  if (done && selectedLabels.length > 0) {
    return (
      <div className="consult-reveal rounded-xl border border-divider bg-card px-4 py-3">
        <div className="text-[11px] text-ink-muted">已选择</div>
        <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="break-words text-[13px] font-medium leading-relaxed text-ink">{selectedLabels.join('、')}</div>
          {pendingFollowup && (
            <div className="flex items-center gap-1.5 pt-0.5 text-[11px] text-ink-muted sm:shrink-0">
              <span className="h-1.5 w-1.5 rounded-full bg-ink/50 consult-dot-pulse" />
              AI 正在接着处理…
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="consult-reveal rounded-xl border border-divider bg-card p-4">
      <div className="mb-3 text-[13px] leading-relaxed text-ink">{input.prompt}</div>
      <div className="space-y-1.5">
        {input.choices.map((c) => {
          const isSel = selected.includes(c.id);
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => toggle(c.id)}
              disabled={done}
              className={
                'group block w-full rounded-lg border px-3.5 py-2.5 text-left transition ' +
                (isSel
                  ? 'border-ink/70 bg-hover/60'
                  : 'border-divider bg-card hover:border-ink/30 disabled:opacity-50 disabled:cursor-not-allowed')
              }
            >
              <div className="flex items-center gap-2">
                <span
                  className={
                    'inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border transition ' +
                    (isSel ? 'border-ink bg-ink' : 'border-ink/30 group-hover:border-ink/60')
                  }
                >
                  {isSel && <span className="h-1.5 w-1.5 rounded-full bg-canvas" />}
                </span>
                <span className="text-[13px] font-medium text-ink">{c.label}</span>
              </div>
              {c.description && (
                <div className="mt-0.5 pl-5 text-[11px] leading-relaxed text-ink-muted">{c.description}</div>
              )}
            </button>
          );
        })}
      </div>
      {!done && (
        <div className="mt-3 flex items-center gap-2">
          <Button onClick={submit} disabled={picked.length === 0} size="sm">
            确认
          </Button>
          <span className="text-[11px] text-ink-muted">
            {input.multi ? '可多选' : '选一个就行'}
          </span>
        </div>
      )}
      {done && selectedLabels.length > 0 && (
        <div className="mt-2 text-[11px] text-ink-muted">
          已选：{selectedLabels.join('、')}
        </div>
      )}
    </div>
  );
}

export function ShowDraftBlock(props: BlockProps<{
  kind: string;
  title: string;
  body: string;
  annotations?: { note: string; quote: string }[];
  actions?: { id: string; label: string }[];
}> & { artifactState?: 'current' | 'superseded' }) {
  const { input, state, output, addToolResult, toolCallId } = props;
  const [showAnno, setShowAnno] = useState(true);
  const done = state === 'output-available';
  const pickedAction = done ? (output as { actionId?: string })?.actionId : null;

  if (!input || typeof input.body !== 'string') return <BlockStreamingSkeleton kind="showDraft" />;
  if (input.kind === 'cv-diagnosis') {
    return <CvDiagnosisArtifactBlock {...props} input={input as CvDiagnosisDraftInput} />;
  }

  const onAction = (id: string) => {
    if (done) return;
    if (id === 'export-md') {
      const blob = new Blob([input.body], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${input.title.replace(/\s+/g, '-')}.md`;
      a.click();
      URL.revokeObjectURL(url);
      addToolResult({ tool: 'showDraft', toolCallId, output: { actionId: id, note: '学生已导出 markdown' } });
      return;
    }
    addToolResult({
      tool: 'showDraft',
      toolCallId,
      output: { actionId: id, label: input.actions?.find((a) => a.id === id)?.label ?? id },
    });
  };

  return (
    <div className="consult-reveal overflow-hidden rounded-xl border border-divider bg-card">
      <div className="flex items-start justify-between gap-3 border-l-2 border-ink bg-hover/40 px-4 py-3">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-ink-muted">{kindLabel(input.kind)}</div>
          <div className="mt-0.5 text-[14px] font-medium leading-snug text-ink">{input.title}</div>
        </div>
        {input.annotations && input.annotations.length > 0 && (
          <button
            type="button"
            onClick={() => setShowAnno((v) => !v)}
            className="shrink-0 text-[11px] text-ink-muted hover:text-ink"
          >
            {showAnno ? '隐藏批注' : `批注 · ${input.annotations.length}`}
          </button>
        )}
      </div>

      <div className="px-5 py-4">
        <ConsultMarkdown content={input.body} density="draft" />
      </div>

      {showAnno && input.annotations && input.annotations.length > 0 && (
        <div className="border-t border-divider bg-sand/30 px-5 py-3">
          <div className="mb-2 text-[10px] uppercase tracking-wider text-ink-muted">机构批注</div>
          <ul className="space-y-2">
            {input.annotations.map((a, i) => (
              <li key={i} className="text-[11.5px] leading-relaxed">
                <div className="text-ink-muted">「{a.quote}」</div>
                <div className="mt-0.5 text-ink">→ {a.note}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {input.actions && input.actions.length > 0 && !done && (
        <div className="flex flex-wrap gap-1.5 border-t border-divider px-4 py-3">
          {input.actions.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => onAction(a.id)}
              className="rounded-lg border border-divider bg-card px-3 py-1.5 text-[11.5px] text-ink transition hover:border-ink/40 hover:bg-hover"
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
      {done && pickedAction && (
        <div className="border-t border-divider px-4 py-2 text-[11px] text-ink-muted">
          已点击：{input.actions?.find((a) => a.id === pickedAction)?.label ?? pickedAction}
        </div>
      )}
    </div>
  );
}

function kindLabel(kind: string): string {
  switch (kind) {
    case 'cold-email-draft': return '套磁草稿';
    case 'cv-diagnosis': return 'CV 诊断';
    case 'program-shortlist': return '项目短名单';
    case 'advisor-card': return '导师卡片';
    case 'interview-feedback': return '面试反馈';
    case 'application-plan': return '申请计划';
    case 'statement-draft': return '文书草稿';
    case 'recommendation-plan': return '推荐信策略';
    default: return kind;
  }
}

export function ShowOutreachWorkspaceBlock(props: BlockProps<OutreachWorkspaceInput>) {
  const { input, state, output, pendingFollowup, addToolResult, toolCallId } = props;
  return (
    <OutreachWorkspaceBlock
      toolCallId={toolCallId}
      state={state}
      input={input}
      output={output}
      pendingFollowup={pendingFollowup}
      addToolResult={addToolResult}
    />
  );
}

export function CtaWechatBlock({
  input,
  orgSlug,
  studentKey,
  scenarioName,
}: {
  input?: { headline?: string; reason?: string; consultantHint?: string };
  orgSlug: string;
  studentKey: string;
  scenarioName?: string;
}) {
  const [wechat, setWechat] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ leadId: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (!input || !input.headline) return <BlockStreamingSkeleton kind="ctaWechat" />;

  const submit = async () => {
    if (busy) return;
    if (!wechat.trim() && !phone.trim()) {
      setErr('请至少填写一个联系方式');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/consult/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgSlug, studentKey, scenarioName,
          reason: input.reason ?? '',
          headline: input.headline,
          consultantHint: input.consultantHint,
          wechat: wechat.trim() || undefined,
          phone: phone.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`);
      setDone({ leadId: json.data.leadId });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="consult-reveal consult-sheen overflow-hidden rounded-xl border p-5"
      style={{
        borderColor: '#E6D38A',
        background: 'linear-gradient(180deg, #FEFAEB 0%, #FDF3C0 100%)',
      }}
    >
      <div className="mb-1 text-[10px] uppercase tracking-wider" style={{ color: '#A68400' }}>
        顾问对接
      </div>
      <div className="text-[15px] font-medium leading-snug text-ink">{input.headline}</div>
      {input.reason && (
        <div className="mt-2 text-[12.5px] leading-[1.7] text-ink-secondary">{input.reason}</div>
      )}
      {input.consultantHint && (
        <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-card/80 px-2.5 py-1 text-[11px] text-ink">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#A68400' }} />
          {input.consultantHint}
        </div>
      )}

      {!done && (
        <div className="mt-4 space-y-2.5">
          <div className="flex gap-2">
            <input
              type="text"
              value={wechat}
              onChange={(e) => setWechat(e.target.value)}
              placeholder="微信号（推荐）"
              disabled={busy}
              className="flex-1 rounded-lg border border-divider bg-card px-3 py-2 text-[13px] focus:border-ink focus:outline-none disabled:opacity-60"
            />
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="手机号（可选）"
              disabled={busy}
              className="flex-1 rounded-lg border border-divider bg-card px-3 py-2 text-[13px] focus:border-ink focus:outline-none disabled:opacity-60"
            />
          </div>
          {err && <div className="text-[11px] text-rose-dark">{err}</div>}
          <div className="flex items-center gap-3">
            <Button onClick={submit} disabled={busy || (!wechat.trim() && !phone.trim())} size="sm">
              {busy ? '提交中…' : '让顾问联系我'}
            </Button>
            <span className="text-[11px] text-ink-muted">顾问一般 30 分钟内触达</span>
          </div>
        </div>
      )}
      {done && (
        <div className="mt-4 rounded-lg border border-mint-400/40 bg-mint-50 px-3 py-2.5 text-[12px]">
          <div className="font-medium text-ink">已收到你的联系方式。</div>
          <div className="mt-0.5 text-[11px] text-ink-muted">稍后顾问会主动联系你。ID：{done.leadId.slice(-8)}</div>
        </div>
      )}
    </div>
  );
}

export function StartVoiceCallBlock(props: BlockProps<{
  reason: string;
  openingLine: string;
  focus: string[];
  voice?: 'Ethan' | 'Cherry';
}> & { orgSlug: string; studentKey: string; isLatestVoiceCall?: boolean }) {
  const { input, state, output, addToolResult, toolCallId, orgSlug, studentKey, isLatestVoiceCall = true } = props;

  if (!input || !input.openingLine) return <BlockStreamingSkeleton kind="ctaWechat" />;

  return (
    <InlineVoiceCallBlock
      toolCallId={toolCallId}
      state={state}
      input={input}
      output={output}
      orgSlug={orgSlug}
      studentKey={studentKey}
      addToolResult={addToolResult}
      isLatestVoiceCall={isLatestVoiceCall}
    />
  );
}

export function FileUploadBlock(props: BlockProps<{
  prompt: string;
  accept?: string[];
  profileKey?: string;
  maxSizeMb?: number;
}>) {
  const { input, state, output, addToolResult, toolCallId } = props;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  if (!input || typeof input.prompt !== 'string') return <BlockStreamingSkeleton kind="fileUpload" />;

  const done = state === 'output-available';
  const completedData = done ? (output as { fileName?: string; charCount?: number }) : null;

  const onChoose = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const f = ev.target.files?.[0];
    if (!f) return;
    setBusy(true); setErr(null); setFileName(f.name);
    try {
      const form = new FormData();
      form.append('file', f);
      if (input.profileKey) form.append('profileKey', input.profileKey);
      const res = await fetch('/api/consult/upload', { method: 'POST', body: form });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`);
      const data = json.data as {
        fileName: string; extension: string; kind: string; charCount: number; text: string; profileKey?: string;
      };
      addToolResult({
        tool: 'fileUpload', toolCallId,
        output: {
          fileName: data.fileName, extension: data.extension, charCount: data.charCount,
          text: data.text.slice(0, 12000),
          truncated: data.text.length > 12000,
          profileKey: data.profileKey,
        },
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const acceptAttr = input.accept && input.accept.length > 0
    ? input.accept.join(',')
    : '.pdf,.docx,.ppt,.pptx,.txt,.md,.csv,.json,.html';

  return (
    <div className="consult-reveal rounded-xl border border-divider bg-card p-4">
      <div className="mb-3 text-[13px] leading-relaxed text-ink">{input.prompt}</div>
      {!done && (
        <>
          <label
            className={
              'flex cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed px-4 py-5 transition ' +
              (busy
                ? 'pointer-events-none border-ink/40 bg-ink/[0.02]'
                : 'border-divider bg-canvas/50 hover:border-ink/40 hover:bg-ink/[0.02]')
            }
          >
            <input type="file" hidden accept={acceptAttr} onChange={onChoose} disabled={busy} />
            <UploadIcon busy={busy} />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium text-ink">
                {busy ? `正在解析「${fileName}」…` : fileName ? `已选：${fileName}（点击重选）` : '点击选择文件'}
              </div>
              <div className="mt-0.5 truncate text-[11px] text-ink-muted">
                支持 {acceptAttr.replace(/\./g, '').split(',').join(' · ')} · ≤{input.maxSizeMb ?? 20}MB
              </div>
            </div>
          </label>
          {err && <div className="mt-2 text-[11px] text-rose-dark">{err}</div>}
        </>
      )}
      {done && completedData && (
        <div className="flex items-center gap-2 rounded-lg border border-mint-400/40 bg-mint-50 px-3 py-2 text-[12px]">
          <span className="h-1.5 w-1.5 rounded-full bg-mint-400" />
          <span className="text-ink">已上传 {completedData.fileName}</span>
          <span className="text-ink-muted">· {completedData.charCount} 字</span>
        </div>
      )}
    </div>
  );
}

function UploadIcon({ busy }: { busy: boolean }) {
  return (
    <div
      className={
        'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border ' +
        (busy ? 'border-ink/30 bg-ink/5' : 'border-divider bg-hover')
      }
    >
      {busy ? (
        <span className="h-2 w-2 rounded-full bg-ink/60 consult-dot-pulse" />
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="text-ink-secondary">
          <path d="M12 16V4M6 10l6-6 6 6" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M4 20h16" strokeLinecap="round" />
        </svg>
      )}
    </div>
  );
}
