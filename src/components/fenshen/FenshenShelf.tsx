'use client';

/**
 * FenshenShelf — 分身架全屏层（fixed inset-0，模式参照 IntentDialog），
 * 用于课中同桌 chip 入口。
 *
 * FenshenShelfViews — 架层内部三视图（shelf 分身卡列表 → onboard 请分身
 * → chat 分身对话），容器无关：充满父级高度。全屏层与课后应用矩阵的
 * 内联面板（FenshenEntryChip card 形态）共用同一套视图，保证两种呈现
 * 的浏览/对话体验一致。
 * 分身卡：名字 / 来源 / 状态（学习中=账本式进度入口，点进即看进展；就绪；
 * 失败=人可读原因）。返回分身架时重拉列表（蒸馏状态可能已在对话中翻为就绪）。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { COPY } from '@/lib/ui/copy';
import { useSegments } from '@/stores/capture-editor-store';
import { FenshenChatPanel } from './FenshenChatPanel';
import { FenshenOnboardFlow } from './FenshenOnboardFlow';
import { fenshenListEgos } from './fenshen-client';
import type { FenshenEgoDto, FenshenLessonSnapshot } from './fenshen-events';

interface FenshenShelfProps {
  open: boolean;
  onClose: () => void;
  /** 当前课程会话（课中入口用；分身对话按这节课物化上下文） */
  sessionId?: string;
  /** 这节课的标题（架子副标题与对话头部 chip 用） */
  lessonTitle?: string;
}

interface FenshenShelfViewsProps {
  onClose: () => void;
  /** 当前复习页课程会话（分身对话按这节课物化上下文） */
  sessionId?: string;
  /** 这节课的标题（架子副标题与对话头部 chip 用） */
  lessonTitle?: string;
}

type ShelfView = { kind: 'shelf' } | { kind: 'onboard' } | { kind: 'chat'; ego: FenshenEgoDto };

function EgoStatusBadge({ ego }: { ego: FenshenEgoDto }) {
  if (ego.status === 'ready') return <Badge variant="pine" dot>{COPY.fenshen.statusReady}</Badge>;
  if (ego.status === 'failed') return <Badge variant="vermilion">{COPY.fenshen.statusFailed}</Badge>;
  return <Badge variant="mute" dot>{COPY.fenshen.statusLearning}</Badge>;
}

/** 架内排序：就绪优先，其后学习中、失败；同状态按最近更新倒序 */
const STATUS_ORDER: Record<FenshenEgoDto['status'], number> = { ready: 0, learning: 1, failed: 2 };

function sortEgos(egos: FenshenEgoDto[]): FenshenEgoDto[] {
  return [...egos].sort((a, b) => {
    const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (byStatus !== 0) return byStatus;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

/** 同名分身集合（用于在副标题补创建日期区分） */
function duplicatedNames(egos: FenshenEgoDto[]): Set<string> {
  const counts = new Map<string, number>();
  for (const ego of egos) counts.set(ego.name, (counts.get(ego.name) ?? 0) + 1);
  return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([name]) => name));
}

export function FenshenShelfViews({ onClose, sessionId, lessonTitle }: FenshenShelfViewsProps) {
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

  // 首次加载：架上只有一位就绪分身时直接进对话（零提问原则，少一跳；
  // 对话头部有返回键可回架子换一位）。仅首进生效，用户主动返回架子不再跳。
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fenshenListEgos()
      .then((list) => {
        if (cancelled) return;
        setEgos(list);
        if (list.length === 1 && list[0].status === 'ready') {
          setView({ kind: 'chat', ego: list[0] });
        }
      })
      .catch(() => {
        // 列表失败保持架子空态
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Esc 关闭（对话视图内先返回分身架）
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (view.kind === 'shelf') onClose();
      else setView({ kind: 'shelf' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, view.kind]);

  const backToShelf = () => {
    setView({ kind: 'shelf' });
    void reload(); // 对话中可能已 ego-ready / 重蒸馏
  };

  const dupNames = duplicatedNames(egos);

  // 这节课的前端快照：guest/demo 会话未持久化到服务端 DB，服务端按 sessionId
  // 查不到课时用快照物化（而不是回落到无关的旧 capture——跨课污染护栏）
  const liveSegments = useSegments();
  const lessonSnapshot = useMemo<FenshenLessonSnapshot | undefined>(() => {
    if (!sessionId || liveSegments.length === 0) return undefined;
    return {
      segments: liveSegments.slice(0, 300).map((s) => ({
        startMs: s.startMs,
        endMs: s.endMs,
        text: s.text,
        speakerId: s.speakerId ?? null,
      })),
    };
  }, [sessionId, liveSegments]);

  return (
    <>
      {view.kind === 'chat' ? (
        <FenshenChatPanel key={view.ego.id} ego={view.ego} onBack={backToShelf} sessionId={sessionId} lessonTitle={lessonTitle} lessonSnapshot={lessonSnapshot} />
      ) : (
        <>
          <div className="flex items-center justify-between border-b border-divider px-5 py-4">
            <div>
              <h2 className="text-[16px] font-medium text-ink">
                {view.kind === 'onboard' ? COPY.fenshen.onboardTitle : COPY.fenshen.shelfTitle}
              </h2>
              {view.kind === 'shelf' ? (
                <p className="mt-0.5 text-[12px] text-ink-muted">
                  {lessonTitle ? COPY.fenshen.shelfLessonBody(lessonTitle) : COPY.fenshen.entryBody}
                </p>
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
            <div className="min-h-0 flex-1 overflow-y-auto">
              <FenshenOnboardFlow
                onCreated={(ego) => setView({ kind: 'chat', ego })}
                onCancel={() => setView({ kind: 'shelf' })}
              />
            </div>
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
                sortEgos(egos).map((ego) => {
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
                          {dupNames.has(ego.name) ? ` · ${COPY.fenshen.egoCreatedAt(ego.createdAt)}` : ''}
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
    </>
  );
}

export function FenshenShelf({ open, onClose, sessionId, lessonTitle }: FenshenShelfProps) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[80] flex flex-col bg-paper"
      role="dialog"
      aria-modal="true"
      aria-label={COPY.fenshen.shelfTitle}
    >
      <FenshenShelfViews onClose={onClose} sessionId={sessionId} lessonTitle={lessonTitle} />
    </div>
  );
}
