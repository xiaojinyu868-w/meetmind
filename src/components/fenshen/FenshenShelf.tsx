'use client';

/**
 * FenshenShelf — 分身架（fixed inset-0 全屏层，模式参照 IntentDialog）。
 *
 * 三个内部视图：shelf（分身卡列表 + 「请一个分身」入口）→ onboard（请分身
 * 三选一）→ chat（FenshenChatPanel，对话/蒸馏进度共用）。
 * 分身卡：名字 / 来源 / 状态（学习中=账本式进度入口，点进即看进展；就绪；
 * 失败=人可读原因）。返回分身架时重拉列表（蒸馏状态可能已在对话中翻为就绪）。
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { COPY } from '@/lib/ui/copy';
import { FenshenChatPanel } from './FenshenChatPanel';
import { FenshenOnboardFlow } from './FenshenOnboardFlow';
import { fenshenListEgos } from './fenshen-client';
import type { FenshenEgoDto } from './fenshen-events';

interface FenshenShelfProps {
  open: boolean;
  onClose: () => void;
}

type ShelfView = { kind: 'shelf' } | { kind: 'onboard' } | { kind: 'chat'; ego: FenshenEgoDto };

function EgoStatusBadge({ ego }: { ego: FenshenEgoDto }) {
  if (ego.status === 'ready') return <Badge variant="pine" dot>{COPY.fenshen.statusReady}</Badge>;
  if (ego.status === 'failed') return <Badge variant="vermilion">{COPY.fenshen.statusFailed}</Badge>;
  return <Badge variant="mute" dot>{COPY.fenshen.statusLearning}</Badge>;
}

export function FenshenShelf({ open, onClose }: FenshenShelfProps) {
  const [view, setView] = useState<ShelfView>({ kind: 'shelf' });
  const [egos, setEgos] = useState<FenshenEgoDto[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setEgos(await fenshenListEgos());
    } catch {
      // 列表失败保持现状（空态文案兜底）
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setView({ kind: 'shelf' });
    void reload();
  }, [open, reload]);

  // Esc 关闭（对话视图内先返回分身架）
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (view.kind === 'shelf') onClose();
      else setView({ kind: 'shelf' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, view.kind]);

  if (!open) return null;

  const backToShelf = () => {
    setView({ kind: 'shelf' });
    void reload(); // 对话中可能已 ego-ready / 重蒸馏
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex flex-col bg-paper"
      role="dialog"
      aria-modal="true"
      aria-label={COPY.fenshen.shelfTitle}
    >
      {view.kind === 'chat' ? (
        <FenshenChatPanel key={view.ego.id} ego={view.ego} onBack={backToShelf} />
      ) : (
        <>
          <div className="flex items-center justify-between border-b border-divider px-5 py-4">
            <div>
              <h2 className="text-[16px] font-medium text-ink">
                {view.kind === 'onboard' ? COPY.fenshen.onboardTitle : COPY.fenshen.shelfTitle}
              </h2>
              {view.kind === 'shelf' ? (
                <p className="mt-0.5 text-[12px] text-ink-muted">{COPY.fenshen.entryBody}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={view.kind === 'onboard' ? () => setView({ kind: 'shelf' }) : onClose}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-paper-warm hover:text-ink"
              aria-label={COPY.fenshen.close}
            >
              <X size={16} aria-hidden />
            </button>
          </div>

          {view.kind === 'onboard' ? (
            <FenshenOnboardFlow
              onCreated={(ego) => setView({ kind: 'chat', ego })}
              onCancel={() => setView({ kind: 'shelf' })}
            />
          ) : (
            <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-3 overflow-y-auto px-5 py-5">
              {loading && egos.length === 0 ? (
                <div className="flex flex-1 items-center justify-center text-ink-muted">
                  <Loader2 size={18} className="animate-spin" />
                </div>
              ) : egos.length === 0 ? (
                <p className="pt-16 text-center text-[13px] leading-relaxed text-ink-muted">
                  {COPY.fenshen.shelfEmpty}
                </p>
              ) : (
                egos.map((ego) => {
                  const clickable = ego.status !== 'failed';
                  return (
                    <button
                      key={ego.id}
                      type="button"
                      disabled={!clickable}
                      onClick={() => setView({ kind: 'chat', ego })}
                      className="flex w-full items-center gap-3 rounded-2xl border border-divider bg-card px-4 py-3.5 text-left shadow-soft transition hover:border-pine/40 hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:translate-y-0"
                    >
                      <span className="flex-1">
                        <span className="block text-[14px] font-medium text-ink">{ego.name}</span>
                        <span className="mt-0.5 block text-[11px] text-ink-muted">
                          {COPY.fenshen.sourceLabel(ego.sourceType)}
                          {ego.status === 'failed' && ego.failReason ? ` · ${ego.failReason}` : ''}
                        </span>
                      </span>
                      <EgoStatusBadge ego={ego} />
                    </button>
                  );
                })
              )}

              <button
                type="button"
                onClick={() => setView({ kind: 'onboard' })}
                className="mt-2 flex items-center justify-center gap-1.5 rounded-2xl border border-dashed border-pine/40 bg-pine-fog px-4 py-3.5 text-[13px] font-medium text-pine transition hover:bg-pine-mist"
              >
                <Plus size={15} aria-hidden />
                {COPY.fenshen.invite}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
