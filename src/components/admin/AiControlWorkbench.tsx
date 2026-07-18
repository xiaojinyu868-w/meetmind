'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Braces, Check, ChevronRight, Cpu, Eye, GitCompareArrows, History,
  LockKeyhole, RotateCcw, Save, Send, SlidersHorizontal,
} from 'lucide-react';
import { useAuth } from '@/lib/hooks/useAuth';
import { cn } from '@/lib/utils';
import { COPY } from '@/lib/ui/copy';
import type { AiControlComparison, AiControlItem, AiControlKey, AiPromptOverride, AiPromptPreview } from '@/types/ai-control';
import { AI_CONTROL_CAPTURE_KEY } from './AdminAiInspectorLink';

type ModelOption = { id: string; name: string; provider: string; description: string; recommended: boolean };
type Capture = { controlKey: AiControlKey; context: Record<string, unknown>; options?: Record<string, unknown>; query?: string; capturedAt: string };

const EMPTY_OVERRIDE: AiPromptOverride = { enabled: false, additionalInstructions: '' };

export function AiControlWorkbench() {
  const router = useRouter();
  const { user, accessToken, isCheckingAuth } = useAuth();
  const [items, setItems] = React.useState<AiControlItem[]>([]);
  const [models, setModels] = React.useState<ModelOption[]>([]);
  const [selectedKey, setSelectedKey] = React.useState<AiControlKey>('tutor:global');
  const [override, setOverride] = React.useState<AiPromptOverride>(EMPTY_OVERRIDE);
  const [contextJson, setContextJson] = React.useState('{}');
  const [optionsJson, setOptionsJson] = React.useState('{}');
  const [usingLiveContext, setUsingLiveContext] = React.useState(false);
  const [preview, setPreview] = React.useState<AiPromptPreview | null>(null);
  const [trialQuery, setTrialQuery] = React.useState('');
  const [comparison, setComparison] = React.useState<AiControlComparison | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState<'draft' | 'publish' | 'preview' | 'compare' | 'rollback' | null>(null);
  const [notice, setNotice] = React.useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const selected = items.find((item) => item.key === selectedKey);
  const groupedItems = React.useMemo(() => Array.from(new Set(items.map((item) => item.group))).map((group) => ({
    group,
    items: items.filter((item) => item.group === group),
  })), [items]);

  const api = React.useCallback(async (init?: RequestInit) => {
    const response = await fetch('/api/admin/ai-control', {
      ...init,
      headers: { 'content-type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...init?.headers },
    });
    const data = await response.json() as Record<string, unknown>;
    if (!response.ok || data.success !== true) throw new Error(String(data.error || response.status));
    return data;
  }, [accessToken]);

  const load = React.useCallback(async () => {
    if (!accessToken || user?.role !== 'admin') {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await api();
      setItems(data.items as AiControlItem[]);
      setModels(data.models as ModelOption[]);
    } catch {
      setNotice({ tone: 'error', text: COPY.adminAi.loadFailed });
    } finally {
      setLoading(false);
    }
  }, [accessToken, api, user?.role]);

  React.useEffect(() => { void load(); }, [load]);

  React.useEffect(() => {
    const key = new URLSearchParams(window.location.search).get('surface') as AiControlKey | null;
    if (key?.startsWith('tutor:') || key?.startsWith('understanding:') || key?.startsWith('app:')) setSelectedKey(key);
  }, []);

  React.useEffect(() => {
    if (!selected) return;
    setOverride(selected.draftRevision?.override ?? selected.activeRevision?.override ?? EMPTY_OVERRIDE);
    let capture: Capture | null = null;
    try { capture = JSON.parse(sessionStorage.getItem(AI_CONTROL_CAPTURE_KEY) || 'null') as Capture | null; } catch { capture = null; }
    const useCapture = capture?.controlKey === selected.key;
    setUsingLiveContext(useCapture);
    setContextJson(JSON.stringify(useCapture ? capture?.context : selected.sampleContext, null, 2));
    setOptionsJson(JSON.stringify(useCapture ? (capture?.options || {}) : (selected.sampleOptions || {}), null, 2));
    setTrialQuery(useCapture
      ? (capture?.query || '')
      : selected.key === 'understanding:intent'
        ? String(selected.sampleContext.query || '理解这次学习意图')
        : selected.key === 'understanding:memory'
          ? '判断这轮对话是否形成了值得长期保留的学习理解。'
          : selected.key === 'app:flashcards'
            ? '基于这份课堂证据生成一组真正能主动回忆的闪卡。'
            : selected.key === 'app:quiz'
              ? '基于这份课堂证据生成一组能检验真实理解的题目。'
            : selected.key === 'app:mindmap'
              ? '基于这节课生成一张扫一眼就能定位主线的轻量结构图。'
            : selected.key === 'app:cheatsheet'
              ? '基于这些跨课与考试范围证据生成一份可打印的考试速查表。'
            : selected.key === 'app:infographic'
              ? '基于这份课堂证据生成一张手机无需放大即可读懂的信息图。'
            : selected.key === 'app:audio-overview'
              ? '基于这份课堂证据生成通勤可听、章节可定位的双人理解型音频脚本。'
          : '请用这次上下文解释最核心的概念。');
    setPreview(null);
    setComparison(null);
  }, [selected]);

  React.useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const parseInput = () => {
    try {
      return {
        context: JSON.parse(contextJson) as Record<string, unknown>,
        options: JSON.parse(optionsJson) as Record<string, unknown>,
      };
    } catch {
      setNotice({ tone: 'error', text: COPY.adminAi.invalidJson });
      return null;
    }
  };

  const runAction = async (action: 'save-draft' | 'publish') => {
    if (!selected) return;
    if (action === 'publish' && !window.confirm(COPY.adminAi.publishConfirm)) return;
    setBusy(action === 'publish' ? 'publish' : 'draft');
    try {
      await api({ method: 'POST', body: JSON.stringify({ action, controlKey: selected.key, override }) });
      setNotice({ tone: 'success', text: action === 'publish' ? COPY.adminAi.published : COPY.adminAi.saved });
      await load();
    } catch {
      setNotice({ tone: 'error', text: COPY.adminAi.actionFailed });
    } finally { setBusy(null); }
  };

  const generatePreview = async () => {
    if (!selected) return;
    const input = parseInput();
    if (!input) return;
    setBusy('preview');
    try {
      const data = await api({ method: 'POST', body: JSON.stringify({ action: 'preview', controlKey: selected.key, ...input, override }) });
      setPreview(data.data as AiPromptPreview);
    } catch {
      setNotice({ tone: 'error', text: COPY.adminAi.actionFailed });
    } finally { setBusy(null); }
  };

  const compareAnswers = async () => {
    if (!selected || !trialQuery.trim()) {
      setNotice({ tone: 'error', text: COPY.adminAi.trialQueryRequired });
      return;
    }
    const input = parseInput();
    if (!input) return;
    setBusy('compare');
    setComparison(null);
    try {
      const data = await api({ method: 'POST', body: JSON.stringify({ action: 'compare', controlKey: selected.key, ...input, override, query: trialQuery }) });
      setComparison(data.data as AiControlComparison);
    } catch {
      setNotice({ tone: 'error', text: COPY.adminAi.compareFailed });
    } finally { setBusy(null); }
  };

  const rollback = async (revisionId: string, version: number) => {
    if (!selected || !window.confirm(COPY.adminAi.rollbackConfirm(version))) return;
    setBusy('rollback');
    try {
      await api({ method: 'POST', body: JSON.stringify({ action: 'rollback', controlKey: selected.key, revisionId }) });
      setNotice({ tone: 'success', text: COPY.adminAi.rolledBack });
      await load();
    } catch {
      setNotice({ tone: 'error', text: COPY.adminAi.actionFailed });
    } finally { setBusy(null); }
  };

  if (isCheckingAuth || loading) return <div className="flex min-h-screen items-center justify-center bg-paper text-sm text-ink-muted">{COPY.adminAi.loading}</div>;
  if (user?.role !== 'admin') return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-6">
      <div className="max-w-sm text-center"><LockKeyhole className="mx-auto text-ink-muted" size={24} /><h1 className="mt-5 text-xl font-semibold text-ink">{COPY.adminAi.accessDenied}</h1><p className="mt-2 text-sm text-ink-secondary">{COPY.adminAi.accessDeniedBody}</p></div>
    </div>
  );

  return (
    <div className="min-h-screen bg-paper text-ink">
      <header className="sticky top-0 z-20 border-b border-divider bg-paper/95 backdrop-blur-xl">
        <div className="flex h-16 items-center gap-4 px-4 sm:px-6">
          <button onClick={() => router.push('/app')} className="flex h-9 w-9 items-center justify-center rounded-full border border-divider bg-white text-ink-secondary hover:text-pine" aria-label={COPY.adminAi.back}><ArrowLeft size={15} /></button>
          <div className="min-w-0 flex-1"><h1 className="text-[16px] font-semibold">{COPY.adminAi.title}</h1><p className="hidden text-[11.5px] text-ink-muted sm:block">{COPY.adminAi.subtitle}</p></div>
          <span className="rounded-full border border-vermilion/20 bg-vermilion/[0.04] px-2.5 py-1 font-mono text-[10px] uppercase tracking-caps text-vermilion">Admin</span>
        </div>
      </header>

      {notice ? <div className={cn('fixed right-5 top-20 z-50 rounded-xl border bg-white px-4 py-2.5 text-xs shadow-float', notice.tone === 'success' ? 'border-pine/25 text-pine' : 'border-vermilion/25 text-vermilion')}>{notice.text}</div> : null}

      <div className="grid min-h-[calc(100vh-4rem)] lg:grid-cols-[250px_minmax(420px,1fr)_minmax(330px,420px)]">
        <aside className="border-b border-divider bg-paper-warm/45 p-4 lg:border-b-0 lg:border-r">
          <p className="px-2 font-mono text-[10px] font-semibold uppercase tracking-caps text-ink-muted">{COPY.adminAi.surfaces}</p>
          <nav className="mt-4 space-y-5">
            {groupedItems.map(({ group, items: groupItems }) => <section key={group}>
              <p className="px-2 text-[10px] font-medium text-ink-muted">{group}</p>
              <div className="mt-1.5 grid gap-1 sm:grid-cols-3 lg:grid-cols-1">
                {groupItems.map((item) => <button key={item.key} onClick={() => setSelectedKey(item.key)} className={cn('group flex items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors', selectedKey === item.key ? 'bg-white shadow-soft ring-1 ring-pine/10' : 'hover:bg-white/70')}><span className={cn('h-2 w-2 rounded-full', item.activeRevision?.override.enabled ? 'bg-pine' : 'bg-ink-muted/25')} /><span className="min-w-0 flex-1"><span className="block text-[13px] font-medium">{item.label}</span><span className="mt-0.5 block truncate text-[10.5px] text-ink-muted">{item.activeRevision ? `${COPY.adminAi.online} ${COPY.adminAi.version(item.activeRevision.version)}` : COPY.adminAi.baseline}</span></span><ChevronRight size={13} className="text-ink-muted/50" /></button>)}
              </div>
            </section>)}
          </nav>
        </aside>

        {selected ? <main className="min-w-0 border-b border-divider px-5 py-6 sm:px-8 lg:border-b-0 lg:border-r">
          <div className="flex items-start justify-between gap-4"><div><p className="font-mono text-[10px] uppercase tracking-caps text-pine">{selected.group} · {selected.mode}</p><h2 className="mt-2 text-2xl font-semibold tracking-tight">{selected.label}</h2><p className="mt-2 max-w-xl text-[13px] leading-6 text-ink-secondary">{selected.description}</p><div className="mt-3 flex flex-wrap gap-1.5">{selected.entryPoints.map((entry) => <span key={entry} className="rounded-full bg-paper-warm px-2 py-1 text-[9.5px] text-ink-muted">{entry}</span>)}</div></div><SlidersHorizontal className="mt-1 text-pine/50" size={20} /></div>

          <section className="mt-8 rounded-2xl border border-divider bg-white p-5 shadow-soft">
            <div><h3 className="text-[15px] font-semibold">{COPY.adminAi.editTitle}</h3><p className="mt-1 text-[12px] text-ink-muted">{COPY.adminAi.editBody}</p></div>
            <label className="mt-5 flex items-center justify-between gap-4 rounded-xl bg-paper-warm/70 px-4 py-3"><span><span className="block text-[13px] font-medium">{COPY.adminAi.enabled}</span><span className="mt-0.5 block text-[10.5px] text-ink-muted">{COPY.adminAi.enabledHint}</span></span><input type="checkbox" checked={override.enabled} onChange={(event) => setOverride((current) => ({ ...current, enabled: event.target.checked }))} className="h-4 w-4 accent-pine" /></label>
            <label className="mt-5 block"><span className="text-[12px] font-medium">{COPY.adminAi.model}</span><select value={override.modelId || ''} onChange={(event) => setOverride((current) => ({ ...current, modelId: event.target.value || undefined }))} className="mt-2 h-11 w-full rounded-xl border border-divider bg-paper px-3 text-[13px] outline-none focus:border-pine/40"><option value="">{COPY.adminAi.modelAuto}</option>{models.map((model) => <option key={model.id} value={model.id}>{model.name} · {model.provider}</option>)}</select></label>
            <label className="mt-5 block"><span className="text-[12px] font-medium">{COPY.adminAi.instructions}</span><textarea rows={10} value={override.additionalInstructions} onChange={(event) => setOverride((current) => ({ ...current, additionalInstructions: event.target.value }))} placeholder={COPY.adminAi.instructionsPlaceholder} className="mt-2 w-full resize-y rounded-xl border border-divider bg-paper px-3.5 py-3 text-[13px] leading-6 outline-none placeholder:text-ink-muted/60 focus:border-pine/40" /></label>
            <label className="mt-4 block"><span className="text-[12px] font-medium">{COPY.adminAi.note}</span><input value={override.note || ''} onChange={(event) => setOverride((current) => ({ ...current, note: event.target.value }))} placeholder={COPY.adminAi.notePlaceholder} className="mt-2 h-11 w-full rounded-xl border border-divider bg-paper px-3 text-[13px] outline-none focus:border-pine/40" /></label>
            <div className="mt-5 flex flex-wrap justify-end gap-2"><button disabled={Boolean(busy)} onClick={() => void runAction('save-draft')} className="inline-flex h-10 items-center gap-2 rounded-full border border-divider px-4 text-[12px] font-medium hover:border-pine/30 disabled:opacity-50"><Save size={13} />{busy === 'draft' ? COPY.adminAi.saving : COPY.adminAi.saveDraft}</button><button disabled={Boolean(busy)} onClick={() => void runAction('publish')} className="inline-flex h-10 items-center gap-2 rounded-full bg-pine px-5 text-[12px] font-medium text-white hover:bg-pine/90 disabled:opacity-50"><Send size={13} />{busy === 'publish' ? COPY.adminAi.publishing : COPY.adminAi.publish}</button></div>
          </section>

          <section className="mt-6"><div className="flex items-center gap-2"><Braces size={14} className="text-pine" /><h3 className="text-[14px] font-semibold">{COPY.adminAi.contextMap}</h3></div><div className="mt-3 grid gap-2 sm:grid-cols-2">{selected.contextInputs.map((input) => <div key={input.key} className="rounded-xl border border-divider bg-white px-3.5 py-3"><div className="flex items-center justify-between gap-2"><p className="text-[12.5px] font-medium">{input.label}</p>{input.sensitive ? <span className="text-[9.5px] text-vermilion">{COPY.adminAi.sensitive}</span> : null}</div><p className="mt-1.5 text-[11px] leading-5 text-ink-muted">{input.description}{input.limit ? ` · ${input.limit}` : ''}</p><code className="mt-2 block truncate text-[10px] text-pine/75">{input.key}</code></div>)}</div></section>
        </main> : null}

        {selected ? <aside className="min-w-0 px-5 py-6 sm:px-6">
          <div className="flex items-center justify-between gap-3"><div><h3 className="text-[14px] font-semibold">{COPY.adminAi.previewTitle}</h3><p className="mt-1 text-[11px] leading-5 text-ink-muted">{COPY.adminAi.previewBody}</p></div><Eye size={16} className="text-pine/60" /></div>
          <div className="mt-4 flex items-center gap-2 text-[10.5px]"><span className={cn('rounded-full px-2 py-1', usingLiveContext ? 'bg-vermilion/[0.07] text-vermilion' : 'bg-paper-warm text-ink-muted')}>{usingLiveContext ? COPY.adminAi.liveContext : COPY.adminAi.sampleContext}</span></div>
          <label className="mt-4 block"><span className="font-mono text-[10px] uppercase tracking-caps text-ink-muted">{COPY.adminAi.contextJson}</span><textarea rows={12} value={contextJson} onChange={(event) => setContextJson(event.target.value)} className="mt-2 w-full resize-y rounded-xl border border-divider bg-[#fbfaf7] px-3 py-3 font-mono text-[10.5px] leading-5 outline-none focus:border-pine/40" /></label>
          <details className="mt-3 rounded-xl border border-divider bg-white px-3 py-2.5">
            <summary className="cursor-pointer text-[10.5px] font-medium text-ink-secondary">{COPY.adminAi.optionsJson}</summary>
            <textarea rows={5} value={optionsJson} onChange={(event) => setOptionsJson(event.target.value)} className="mt-2 w-full resize-y rounded-lg border border-divider bg-[#fbfaf7] px-3 py-2.5 font-mono text-[10px] leading-5 outline-none focus:border-pine/40" />
          </details>
          <button disabled={Boolean(busy)} onClick={() => void generatePreview()} className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-full border border-pine/25 bg-pine/[0.05] text-[12px] font-medium text-pine hover:bg-pine/[0.08] disabled:opacity-50"><Eye size={13} />{busy === 'preview' ? COPY.adminAi.previewing : COPY.adminAi.preview}</button>

          <section className="mt-6 border-t border-divider pt-5"><div className="flex items-center justify-between gap-3"><h3 className="text-[13px] font-semibold">{COPY.adminAi.finalInput}</h3>{preview ? <span className="font-mono text-[9.5px] text-ink-muted">{COPY.adminAi.characterCount(preview.characterCount)}</span> : null}</div>{preview ? <><div className="mt-3 flex flex-wrap gap-2 text-[9.5px] text-ink-muted"><span className="rounded-full bg-paper-warm px-2 py-1">{preview.promptVersion}</span><span className="rounded-full bg-paper-warm px-2 py-1"><Cpu size={9} className="mr-1 inline" />{preview.modelId}</span></div><details className="mt-3 rounded-xl border border-divider bg-white px-3 py-2"><summary className="cursor-pointer text-[10.5px] font-medium text-ink-secondary">{COPY.adminAi.contextReceived} · {preview.contextSummary.length}</summary><div className="mt-2 space-y-2">{preview.contextSummary.map((field) => <div key={field.path} className="border-t border-divider/70 pt-2"><div className="flex items-center justify-between gap-2"><code className="truncate text-[9.5px] text-pine">{field.path}</code><span className="shrink-0 text-[9px] text-ink-muted">{field.valueType} · {field.size}</span></div><p className="mt-1 line-clamp-2 text-[9.5px] leading-4 text-ink-muted">{field.preview}</p></div>)}</div></details><pre className="mt-3 max-h-[420px] overflow-auto whitespace-pre-wrap rounded-xl border border-divider bg-[#fbfaf7] p-3 font-mono text-[9.5px] leading-5 text-ink-secondary">{preview.finalPrompt}</pre><details className="mt-3 rounded-xl border border-divider bg-white px-3 py-2"><summary className="cursor-pointer text-[10.5px] font-medium text-ink-secondary">{COPY.adminAi.baseline}</summary><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap font-mono text-[9px] leading-5 text-ink-muted">{preview.defaultPrompt}</pre></details><div className="mt-4 rounded-xl border border-pine/15 bg-pine/[0.035] p-3"><div className="flex items-center gap-2 text-[11px] font-medium text-pine"><LockKeyhole size={12} />{COPY.adminAi.lockedContract}</div><p className="mt-1 text-[10px] leading-5 text-ink-muted">{COPY.adminAi.lockedHint}</p><pre className="mt-2 whitespace-pre-wrap font-mono text-[9px] leading-4 text-ink-muted">{preview.lockedContract}</pre></div></> : <p className="mt-3 rounded-xl border border-dashed border-divider px-4 py-8 text-center text-[11px] leading-5 text-ink-muted">{COPY.adminAi.previewEmpty}</p>}</section>

          <section className="mt-6 border-t border-divider pt-5">
            <div className="flex items-center gap-2"><GitCompareArrows size={13} className="text-pine" /><h3 className="text-[13px] font-semibold">{COPY.adminAi.compareTitle}</h3></div>
            <p className="mt-1.5 text-[10.5px] leading-5 text-ink-muted">{COPY.adminAi.compareBody}</p>
            <label className="mt-3 block"><span className="sr-only">{COPY.adminAi.trialQuery}</span><textarea rows={3} value={trialQuery} onChange={(event) => setTrialQuery(event.target.value)} placeholder={COPY.adminAi.trialQueryPlaceholder} className="w-full resize-y rounded-xl border border-divider bg-white px-3 py-2.5 text-[11px] leading-5 outline-none placeholder:text-ink-muted/60 focus:border-pine/40" /></label>
            <button disabled={Boolean(busy) || !trialQuery.trim()} onClick={() => void compareAnswers()} className="mt-2 inline-flex h-10 w-full items-center justify-center gap-2 rounded-full border border-pine/25 bg-pine/[0.05] text-[11.5px] font-medium text-pine hover:bg-pine/[0.08] disabled:opacity-50"><GitCompareArrows size={12} />{busy === 'compare' ? COPY.adminAi.comparing : COPY.adminAi.runCompare}</button>
            {comparison ? <div className="mt-4 space-y-2.5">
              {([{ key: 'online', label: COPY.adminAi.currentOnline, result: comparison.online }, { key: 'candidate', label: COPY.adminAi.currentEdit, result: comparison.candidate }] as const).map((item) => <article key={item.key} className={cn('rounded-xl border px-3.5 py-3', item.key === 'candidate' ? 'border-pine/25 bg-pine/[0.035]' : 'border-divider bg-white')}><div className="flex items-center justify-between gap-2"><p className="text-[11px] font-semibold text-ink">{item.label}</p><span className="font-mono text-[8.5px] text-ink-muted">{item.result.modelId} · {COPY.adminAi.duration(item.result.durationMs)}</span></div><p className="mt-2 whitespace-pre-wrap text-[11px] leading-5 text-ink-secondary">{item.result.text}</p></article>)}
            </div> : <p className="mt-3 text-center text-[10px] text-ink-muted">{COPY.adminAi.compareEmpty}</p>}
          </section>

          <section className="mt-6 border-t border-divider pt-5"><div className="flex items-center gap-2"><History size={13} className="text-pine" /><h3 className="text-[13px] font-semibold">{COPY.adminAi.history}</h3></div><div className="mt-3 space-y-2">{selected.recentRevisions.length ? selected.recentRevisions.map((revision) => <div key={revision.id} className="rounded-xl border border-divider bg-white px-3 py-2.5"><div className="flex items-center gap-2"><span className="text-[11px] font-medium">{COPY.adminAi.version(revision.version)}</span><span className={cn('rounded-full px-1.5 py-0.5 text-[8.5px]', revision.status === 'published' ? 'bg-pine/10 text-pine' : 'bg-paper-warm text-ink-muted')}>{revision.status === 'published' ? COPY.adminAi.online : revision.status === 'draft' ? COPY.adminAi.draft : revision.status}</span>{revision.status === 'published' ? <Check size={10} className="ml-auto text-pine" /> : null}</div>{revision.override.note ? <p className="mt-1 truncate text-[10px] text-ink-muted">{revision.override.note}</p> : null}{revision.status !== 'draft' ? <button disabled={Boolean(busy)} onClick={() => void rollback(revision.id, revision.version)} className="mt-2 inline-flex items-center gap-1 text-[9.5px] text-ink-muted hover:text-pine"><RotateCcw size={9} />{COPY.adminAi.rollback}</button> : null}</div>) : <p className="text-[11px] text-ink-muted">{COPY.adminAi.emptyHistory}</p>}</div></section>
        </aside> : null}
      </div>
    </div>
  );
}
