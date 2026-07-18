'use client';

import * as React from 'react';
import { ArrowUpRight, Braces, Cpu, LockKeyhole, SlidersHorizontal, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { COPY } from '@/lib/ui/copy';
import { cn } from '@/lib/utils';
import type { AiControlItem, AiControlKey, AiPromptPreview } from '@/types/ai-control';
import { useAdminLens } from './AdminLensProvider';

export const AI_CONTROL_CAPTURE_KEY = 'meetmind_admin_ai_control_capture';

interface AdminAiInspectorLinkProps {
  controlKey: AiControlKey;
  context: Record<string, unknown>;
  options?: Record<string, unknown>;
  query?: string;
  compact?: boolean;
}

export function AdminAiInspectorLink({ controlKey, context, options = {}, query, compact = false }: AdminAiInspectorLinkProps) {
  const { user, accessToken } = useAuth();
  const { enabled: adminLensEnabled } = useAdminLens();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [preview, setPreview] = React.useState<AiPromptPreview | null>(null);
  const [revisionLabel, setRevisionLabel] = React.useState(COPY.adminAi.baseline);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeydown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeydown);
    };
  }, [open]);

  React.useEffect(() => {
    if (!adminLensEnabled || user?.role !== 'admin') setOpen(false);
  }, [adminLensEnabled, user?.role]);

  if (user?.role !== 'admin' || !adminLensEnabled) return null;

  const captureInput = () => {
    sessionStorage.setItem(AI_CONTROL_CAPTURE_KEY, JSON.stringify({ controlKey, context, options, query, capturedAt: new Date().toISOString() }));
  };

  const loadInspector = async () => {
    captureInput();
    setOpen(true);
    setLoading(true);
    setError(false);
    try {
      const headers = {
        'content-type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      };
      const listResponse = await fetch('/api/admin/ai-control', { headers });
      const listData = await listResponse.json() as { success?: boolean; items?: AiControlItem[] };
      if (!listResponse.ok || listData.success !== true) throw new Error('CONTROL_LIST_FAILED');
      const item = listData.items?.find((candidate) => candidate.key === controlKey);
      const activeOverride = item?.activeRevision?.override ?? { enabled: false, additionalInstructions: '' };
      setRevisionLabel(item?.activeRevision ? `${COPY.adminAi.online} ${COPY.adminAi.version(item.activeRevision.version)}` : COPY.adminAi.baseline);
      const previewResponse = await fetch('/api/admin/ai-control', {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'preview', controlKey, context, options, override: activeOverride }),
      });
      const previewData = await previewResponse.json() as { success?: boolean; data?: AiPromptPreview };
      if (!previewResponse.ok || previewData.success !== true || !previewData.data) throw new Error('CONTROL_PREVIEW_FAILED');
      setPreview(previewData.data);
    } catch {
      setError(true);
      setPreview(null);
    } finally {
      setLoading(false);
    }
  };

  const openControlCenter = () => {
    captureInput();
    router.push(`/admin/ai-control?surface=${encodeURIComponent(controlKey)}&source=live`);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void loadInspector()}
        className="inline-flex h-9 items-center gap-1.5 rounded-full border border-vermilion/20 bg-vermilion/[0.04] px-3 text-[11.5px] font-medium text-vermilion transition-colors hover:border-vermilion/35 hover:bg-vermilion/[0.07]"
        aria-label={COPY.adminAi.inspectorTitle}
        title={COPY.adminAi.inspectorTitle}
      >
        <SlidersHorizontal size={13} />
        {!compact ? <span>{COPY.adminAi.inspector}</span> : null}
      </button>

      {open ? <div className="fixed inset-0 z-[120]" role="dialog" aria-modal="true" aria-label={COPY.adminAi.inspectorPanelTitle}>
        <button type="button" className="absolute inset-0 bg-ink/10 backdrop-blur-[2px]" onClick={() => setOpen(false)} aria-label={COPY.adminAi.closeInspector} />
        <aside className="absolute inset-y-0 right-0 flex w-full max-w-[520px] flex-col border-l border-divider bg-paper shadow-float">
          <header className="flex h-16 shrink-0 items-center gap-3 border-b border-divider px-5">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-vermilion/[0.06] text-vermilion"><Braces size={16} /></div>
            <div className="min-w-0 flex-1">
              <h2 className="text-[15px] font-semibold text-ink">{COPY.adminAi.inspectorPanelTitle}</h2>
              <p className="mt-0.5 truncate text-[10.5px] text-ink-muted">{controlKey} · {revisionLabel}</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-full text-ink-muted hover:bg-paper-warm hover:text-ink" aria-label={COPY.adminAi.closeInspector}><X size={16} /></button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            {loading ? <div className="flex min-h-48 items-center justify-center text-[12px] text-ink-muted">{COPY.adminAi.inspecting}</div> : null}
            {error ? <div className="rounded-xl border border-vermilion/20 bg-vermilion/[0.035] px-4 py-5 text-[12px] leading-5 text-vermilion">{COPY.adminAi.inspectorFailed}</div> : null}
            {preview && !loading ? <>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-divider bg-white px-3.5 py-3">
                  <p className="font-mono text-[9px] uppercase tracking-caps text-ink-muted">{COPY.adminAi.requestModel}</p>
                  <p className="mt-2 flex items-center gap-1.5 truncate text-[11.5px] font-medium text-ink"><Cpu size={12} className="text-pine" />{preview.modelId || COPY.adminAi.modelAuto}</p>
                </div>
                <div className="rounded-xl border border-divider bg-white px-3.5 py-3">
                  <p className="font-mono text-[9px] uppercase tracking-caps text-ink-muted">{COPY.adminAi.promptVersion}</p>
                  <p className="mt-2 truncate text-[11.5px] font-medium text-ink">{preview.promptVersion}</p>
                </div>
              </div>

              <section className="mt-6">
                <div className="flex items-center justify-between gap-3"><h3 className="text-[13px] font-semibold text-ink">{COPY.adminAi.contextReceived}</h3><span className="font-mono text-[9.5px] text-ink-muted">{preview.contextSummary.length}</span></div>
                <div className="mt-3 space-y-2">
                  {preview.contextSummary.length ? preview.contextSummary.map((field) => <div key={field.path} className="rounded-xl border border-divider bg-white px-3.5 py-3">
                    <div className="flex items-center justify-between gap-3"><code className="min-w-0 truncate text-[10px] text-pine">{field.path}</code><span className="shrink-0 text-[9px] text-ink-muted">{field.valueType} · {field.size}</span></div>
                    <p className="mt-1.5 line-clamp-3 text-[10.5px] leading-5 text-ink-secondary">{field.preview}</p>
                  </div>) : <p className="rounded-xl border border-dashed border-divider px-4 py-6 text-center text-[11px] text-ink-muted">{COPY.adminAi.noContextReceived}</p>}
                </div>
              </section>

              <details className="mt-6 rounded-xl border border-divider bg-white px-4 py-3">
                <summary className="cursor-pointer text-[12px] font-medium text-ink-secondary">{COPY.adminAi.finalInput} · {COPY.adminAi.characterCount(preview.characterCount)}</summary>
                <pre className="mt-3 max-h-[420px] overflow-auto whitespace-pre-wrap border-t border-divider pt-3 font-mono text-[9.5px] leading-5 text-ink-secondary">{preview.finalPrompt}</pre>
              </details>
              <div className="mt-3 flex items-start gap-2 rounded-xl bg-paper-warm/70 px-3.5 py-3 text-[10px] leading-5 text-ink-muted"><LockKeyhole size={12} className="mt-1 shrink-0 text-pine" /><span>{COPY.adminAi.inspectorPrivacy}</span></div>
            </> : null}
          </div>

          <footer className="shrink-0 border-t border-divider bg-paper px-5 py-4">
            <button type="button" onClick={openControlCenter} className={cn('inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-pine px-5 text-[12px] font-medium text-white hover:bg-pine/90', loading && 'pointer-events-none opacity-50')}>
              {COPY.adminAi.tuneThisRun}<ArrowUpRight size={13} />
            </button>
          </footer>
        </aside>
      </div> : null}
    </>
  );
}
